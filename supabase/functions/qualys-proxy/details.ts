import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lecture du détail de la dernière photo (écran : inventaires, fiches, listes filtrables).
// Tout passe par la clé service_role ; l'utilisateur est authentifié par index.ts.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
/** Client Supabase avec la clé de service (base non typée). */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, "public", any>;

const PAGE = 1000;

/** Toutes les lignes d'une requête (PostgREST renvoie au plus 1000 lignes par appel). */
async function selectAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Dernière photo terminée dont le détail est disponible. */
export async function detailSnapshot(admin: Admin): Promise<{ id: string; date: string } | null> {
  const { data } = await admin.from("qualys_snapshots").select("id, started_at, finished_at").eq("status", "done")
    .order("started_at", { ascending: false }).limit(5);
  for (const s of data ?? []) {
    const { count } = await admin.from("qualys_assets").select("host_id", { count: "exact", head: true }).eq("snapshot_id", s.id);
    if (count) return { id: s.id, date: s.finished_at ?? s.started_at };
  }
  return null;
}

const ASSET_COLS = "host_id, asset_id, name, ip, os, asset_type, tracking, trurisk, criticality, last_scan, last_activity, public_ip, tags";
const VULN_COLS = "host_id, d5, d4, d3, overdue, ignored, reopened, qds_max, kev, ransomware, armed, eol, qids";
const KB_LIGHT = "qid, severity, title, category, cvss3, cves, flags, products, published";

/**
 * Inventaire des actifs avec leurs compteurs de vulnérabilités et la liste de leurs QID ouverts,
 * plus le catalogue des vulnérabilités présentes : l'écran filtre et recalcule tout localement.
 */
export async function handleAssets(admin: Admin) {
  const snap = await detailSnapshot(admin);
  if (!snap) return { available: false, date: null, assets: [], catalog: [] };
  const [assets, vulns, index] = await Promise.all([
    selectAll((a, b) => admin.from("qualys_assets").select(ASSET_COLS).eq("snapshot_id", snap.id).order("host_id").range(a, b)),
    selectAll((a, b) => admin.from("qualys_asset_vulns").select(VULN_COLS).eq("snapshot_id", snap.id).order("host_id").range(a, b)),
    selectAll((a, b) => admin.from("qualys_vulns").select("qid, hosts, servers, overdue, first_found").eq("snapshot_id", snap.id).order("qid").range(a, b)),
  ]);
  const byHost = new Map(vulns.map((v) => [v.host_id, v]));
  const qids = index.map((r) => r.qid);
  const kb = new Map<number, Row>();
  for (let i = 0; i < qids.length; i += 500) {
    const { data, error } = await admin.from("qualys_kb").select(KB_LIGHT).in("qid", qids.slice(i, i + 500));
    if (error) throw new Error(error.message);
    for (const k of data ?? []) kb.set(Number(k.qid), k);
  }
  const empty = { d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0, qds_max: 0, kev: 0, ransomware: 0, armed: 0, eol: 0, qids: [] };
  return {
    available: true,
    date: snap.date,
    assets: assets.map((a) => {
      const { host_id: _h, ...v } = byHost.get(a.host_id) ?? { host_id: a.host_id, ...empty };
      return { ...a, ...v, qids: (v.qids ?? []).map(Number) };
    }),
    catalog: index.map((r) => ({ ...(kb.get(Number(r.qid)) ?? { qid: r.qid, title: "", flags: 0, cves: [], products: [] }), qid: Number(r.qid), hosts: r.hosts, servers: r.servers, overdue: r.overdue, first_found: r.first_found })),
  };
}

/** Fiche complète d'un actif : attributs, vulnérabilités détaillées, inventaire CSAM correspondant. */
export async function handleAsset(admin: Admin, hostId: unknown) {
  const id = Number(hostId);
  if (!Number.isFinite(id)) return { error: "Actif inconnu" };
  const snap = await detailSnapshot(admin);
  if (!snap) return { error: "Détail non disponible" };
  const { data: asset } = await admin.from("qualys_assets").select("*").eq("snapshot_id", snap.id).eq("host_id", id).maybeSingle();
  if (!asset) return { error: "Actif introuvable dans la dernière photo" };
  const { data: vulns } = await admin.from("qualys_asset_vulns").select("*").eq("snapshot_id", snap.id).eq("host_id", id).maybeSingle();
  const detections: Row[] = (vulns?.detections ?? []) as Row[];
  const qids = [...new Set(detections.map((d) => Number(d[0])))];
  const kb = new Map<number, Row>();
  for (let i = 0; i < qids.length; i += 500) {
    const { data } = await admin.from("qualys_kb").select("qid, severity, title, category, cvss3, cves, flags, products, solution, patch_published").in("qid", qids.slice(i, i + 500));
    for (const k of data ?? []) kb.set(Number(k.qid), k);
  }
  let csam: Row | null = null;
  if (asset.asset_id) {
    const { data } = await admin.from("qualys_csam_assets").select("*").eq("snapshot_id", snap.id).eq("asset_id", asset.asset_id).maybeSingle();
    csam = data;
  }
  if (!csam) {
    const { data } = await admin.from("qualys_csam_assets").select("*").eq("snapshot_id", snap.id).eq("host_id", id).limit(1).maybeSingle();
    csam = data;
  }
  const { snapshot_id: _s, detections: _d, qids: _q, ...counts } = vulns ?? {};
  return {
    date: snap.date,
    asset: { ...asset, snapshot_id: undefined },
    counts,
    detections: detections.map((d) => {
      const k = kb.get(Number(d[0]));
      return {
        qid: Number(d[0]), severity: d[1], firstFound: d[2], lastFound: d[3], status: d[4], qds: d[5], ignored: d[6] === 1, overdue: d[7] === 1, port: d[8],
        title: k?.title ?? null, category: k?.category ?? null, cvss3: k?.cvss3 ?? null, cves: k?.cves ?? [], flags: k?.flags ?? 0,
        products: k?.products ?? [], solution: k?.solution ?? null, patchPublished: k?.patch_published ?? null,
      };
    }),
    csam: csam ? { ...csam, snapshot_id: undefined } : null,
  };
}

/** Fiche complète d'une vulnérabilité et la liste des actifs touchés. */
export async function handleVuln(admin: Admin, qidRaw: unknown) {
  const qid = Number(qidRaw);
  if (!Number.isFinite(qid)) return { error: "Vulnérabilité inconnue" };
  const snap = await detailSnapshot(admin);
  if (!snap) return { error: "Détail non disponible" };
  const { data: kb } = await admin.from("qualys_kb").select("*").eq("qid", qid).maybeSingle();
  const { data: hits, error } = await admin.rpc("qualys_vuln_hosts", { snap: snap.id, vuln: qid });
  if (error) throw new Error(error.message);
  const ids = [...new Set((hits ?? []).map((h: Row) => Number(h.host_id)))] as number[];
  const assets = new Map<number, Row>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from("qualys_assets").select("host_id, name, ip, os, asset_type, trurisk, criticality, public_ip, tags, last_scan")
      .eq("snapshot_id", snap.id).in("host_id", ids.slice(i, i + 500));
    for (const a of data ?? []) assets.set(Number(a.host_id), a);
  }
  return {
    date: snap.date,
    kb,
    hosts: (hits ?? []).map((h: Row) => {
      const d = h.detection as Row;
      return { ...(assets.get(Number(h.host_id)) ?? { host_id: h.host_id }), firstFound: d[2], lastFound: d[3], status: d[4], qds: d[5], ignored: d[6] === 1, overdue: d[7] === 1, port: d[8] };
    }),
  };
}

/** Inventaire CSAM complet (sans les attributs bruts, chargés à la demande). */
export async function handleInventory(admin: Admin) {
  const snap = await detailSnapshot(admin);
  if (!snap) return { available: false, date: null, assets: [] };
  const assets = await selectAll((a, b) => admin.from("qualys_csam_assets")
    .select("asset_id, host_id, name, ip, os, asset_type, has_agent, has_scanner, agent_last_checkin, lifecycle_stage, eos, eol, created, last_seen, sources, hardware, criticality, tags")
    .eq("snapshot_id", snap.id).order("asset_id").range(a, b));
  return { available: true, date: snap.date, assets };
}

export async function handleInventoryAsset(admin: Admin, assetId: unknown) {
  const id = Number(assetId);
  const snap = await detailSnapshot(admin);
  if (!snap || !Number.isFinite(id)) return { error: "Actif inconnu" };
  const { data } = await admin.from("qualys_csam_assets").select("*").eq("snapshot_id", snap.id).eq("asset_id", id).maybeSingle();
  return data ? { asset: { ...data, snapshot_id: undefined } } : { error: "Actif introuvable" };
}

/** Applications web (inventaire complet) et toutes leurs vulnérabilités. */
export async function handleWebApps(admin: Admin) {
  const snap = await detailSnapshot(admin);
  if (!snap) return { available: false, date: null, apps: [], findings: [] };
  const [apps, findings] = await Promise.all([
    selectAll((a, b) => admin.from("qualys_was_apps").select("app_id, name, url, tags, created, last_scan, attrs").eq("snapshot_id", snap.id).order("app_id").range(a, b)),
    selectAll((a, b) => admin.from("qualys_was_findings").select("*").eq("snapshot_id", snap.id).order("finding_id").range(a, b)),
  ]);
  return { available: true, date: snap.date, apps, findings: findings.map(({ snapshot_id: _s, ...f }) => f) };
}
