// Détail de la dernière photo Qualys (actifs, vulnérabilités, inventaires) et filtres
// appliqués à toute la page. Calculs faits dans le navigateur, sur les données de la nuit.

import { FLAGS, type AssetType } from "@/lib/qualys";

export interface DAsset {
  host_id: number; asset_id: number | null; name: string | null; ip: string | null; os: string | null; asset_type: AssetType;
  tracking: string | null; trurisk: number | null; criticality: number | null; last_scan: string | null; last_activity: string | null;
  public_ip: boolean; tags: string[];
  d5: number; d4: number; d3: number; overdue: number; ignored: number; reopened: number; qds_max: number;
  kev: number; ransomware: number; armed: number; eol: number; qids: number[];
}

export interface DCatalog {
  qid: number; severity: number | null; title: string; category: string | null; cvss3: number | null; cves: string[]; flags: number;
  products: [string, string][]; published: string | null; hosts: number; servers: number; overdue: number; first_found: string | null;
}

export interface AssetsPayload { available: boolean; date: string | null; assets: DAsset[]; catalog: DCatalog[] }

export interface Detection {
  qid: number; severity: number; firstFound: string | null; lastFound: string | null; status: string; qds: number; ignored: boolean; overdue: boolean;
  port: number | null; title: string | null; category: string | null; cvss3: number | null; cves: string[]; flags: number;
  products: [string, string][]; solution: string | null; patchPublished: string | null;
}

export interface CsamAsset {
  asset_id: number; host_id: number | null; name: string | null; ip: string | null; os: string | null; asset_type: AssetType;
  has_agent: boolean; has_scanner: boolean; agent_last_checkin: string | null; lifecycle_stage: string | null; eos: string | null; eol: string | null;
  created: string | null; last_seen: string | null; sources: string | null; hardware: string | null; criticality: number | null; tags: string[];
}

export interface WasApp { app_id: number; name: string | null; url: string | null; tags: string[]; created: string | null; last_scan: string | null; attrs: Record<string, string> }
export interface WasFinding {
  finding_id: number; app_id: number | null; app_name: string | null; qid: number | null; title: string | null; severity: number | null; status: string | null;
  owasp: string | null; url: string | null; first_detected: string | null; last_detected: string | null; last_tested: string | null; fixed_date: string | null;
  times_detected: number | null; potential: boolean; ignored: boolean; overdue: boolean; attrs: Record<string, string>;
}

export const ARMED_FLAGS = FLAGS.kev | FLAGS.ransomware | FLAGS.activeAttacks | FLAGS.exploitPublic;
const DAY = 86_400_000;
export const RECENT_SCAN_DAYS = 30;

// ---------------------------------------------------------------------------
// Catégories dérivées
// ---------------------------------------------------------------------------

export type TruTier = "critical" | "high" | "medium" | "low" | "none";
export const TIER_LABELS: Record<TruTier, string> = { critical: "Critique (≥ 850)", high: "Élevé (700-849)", medium: "Moyen (500-699)", low: "Faible (< 500)", none: "Sans score" };
export const truTier = (s: number | null): TruTier => (s === null ? "none" : s >= 850 ? "critical" : s >= 700 ? "high" : s >= 500 ? "medium" : "low");

/** Famille de système : nom et version majeure (« Windows Server 2019 », « Debian Linux 13 »). */
export function osFamily(os: string | null): string {
  const s = (os ?? "").trim();
  if (!s) return "Inconnu";
  const m = /^(.*?\d+)/.exec(s);
  if (m && m[1].length <= 40) return m[1].trim();
  return s.split(/\s+/).slice(0, 3).join(" ");
}

export type ScanState = "recent" | "stale" | "never";
export const SCAN_LABELS: Record<ScanState, string> = { recent: `Analysé depuis moins de ${RECENT_SCAN_DAYS} j`, stale: `Pas analysé depuis plus de ${RECENT_SCAN_DAYS} j`, never: "Jamais analysé" };
export function scanState(a: Pick<DAsset, "last_scan">, now = Date.now()): ScanState {
  if (!a.last_scan) return "never";
  return now - Date.parse(a.last_scan) <= RECENT_SCAN_DAYS * DAY ? "recent" : "stale";
}

export const hasAgent = (a: Pick<DAsset, "tracking">) => /agent/i.test(a.tracking ?? "");

/** Produit en fin de vie (titres Qualys « EOL/Obsolete … »). */
export const isEolTitle = (t: string | null | undefined) => /^\s*EOL\s*\/\s*Obsolete/i.test(t ?? "");

/**
 * Produit à corriger auquel se rattache une vulnérabilité : produit déclaré par Qualys (éditeur + produit),
 * à défaut le titre sans les références (GHSA, CVE…). Regroupe les dizaines de QID d'un même composant
 * (ex. jackson-databind) en une seule ligne.
 */
export function productKey(c: Pick<DCatalog, "products" | "title">): string {
  const p = c.products?.find((x) => x[1]);
  if (p) {
    const vendor = p[0] && !/^(none|unknown|n\/a)$/i.test(p[0]) ? p[0] : "";
    const name = p[1].replace(/_/g, " ");
    return (vendor && !name.toLowerCase().startsWith(vendor.toLowerCase()) ? `${vendor} ${name}` : name).replace(/\b\w/g, (x) => x.toUpperCase());
  }
  return (c.title || "Sans titre").replace(/\((?:GHSA|CVE|MS|KB|APSB|RHSA|DSA|USN)[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Filtres appliqués à toute la page
// ---------------------------------------------------------------------------

export type Threat = "kev" | "ransomware" | "armed";
export const THREAT_LABELS: Record<Threat, string> = { kev: "Exploitées activement (CISA KEV)", ransomware: "Utilisées par des ransomwares", armed: "Exploitables" };

export interface QFilters {
  type?: AssetType[];
  tier?: TruTier[];
  criticality?: number[];
  tag?: string[];
  os?: string[];
  scan?: ScanState;
  agent?: boolean;
  publicIp?: boolean;
  threat?: Threat;
  eol?: boolean;
  overdue?: boolean;
  sev5?: boolean;
  qid?: number;
  product?: string;
  search?: string;
}

/** Recherche libre : nom, IP, système, tag. */
export const matchText = (a: DAsset, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [a.name, a.ip, a.os, ...a.tags].some((x) => (x ?? "").toLowerCase().includes(s));
};

export interface CatalogIndex { byQid: Map<number, DCatalog>; product: Map<number, string> }
export function indexCatalog(catalog: DCatalog[]): CatalogIndex {
  return { byQid: new Map(catalog.map((c) => [c.qid, c])), product: new Map(catalog.map((c) => [c.qid, productKey(c)])) };
}

export function assetMatches(a: DAsset, f: QFilters, idx: CatalogIndex, now = Date.now()): boolean {
  if (f.type?.length && !f.type.includes(a.asset_type)) return false;
  if (f.tier?.length && !f.tier.includes(truTier(a.trurisk))) return false;
  if (f.criticality?.length && !f.criticality.includes(a.criticality ?? 0)) return false;
  if (f.tag?.length && !f.tag.some((t) => a.tags.includes(t))) return false;
  if (f.os?.length && !f.os.includes(osFamily(a.os))) return false;
  if (f.scan && scanState(a, now) !== f.scan) return false;
  if (f.agent !== undefined && hasAgent(a) !== f.agent) return false;
  if (f.publicIp !== undefined && a.public_ip !== f.publicIp) return false;
  if (f.threat && !(f.threat === "kev" ? a.kev : f.threat === "ransomware" ? a.ransomware : a.armed)) return false;
  if (f.eol && !a.eol) return false;
  if (f.overdue && !a.overdue) return false;
  if (f.sev5 && !a.d5) return false;
  if (f.qid !== undefined && !a.qids.includes(f.qid)) return false;
  if (f.product && !a.qids.some((q) => idx.product.get(q) === f.product)) return false;
  if (f.search && !matchText(a, f.search)) return false;
  return true;
}

export const filterAssets = (assets: DAsset[], f: QFilters, idx: CatalogIndex, now = Date.now()) => assets.filter((a) => assetMatches(a, f, idx, now));

export const isFiltered = (f: QFilters) => Object.values(f).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== "");

/** Ajoute ou retire une valeur d'un filtre à choix multiple ; bascule un filtre simple. */
export function toggle<K extends keyof QFilters>(f: QFilters, key: K, value: NonNullable<QFilters[K]> extends (infer U)[] ? U : NonNullable<QFilters[K]>): QFilters {
  const cur = f[key];
  if (Array.isArray(cur) || ["type", "tier", "criticality", "tag", "os"].includes(key as string)) {
    const list = (cur as unknown[] | undefined) ?? [];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    return { ...f, [key]: next.length ? next : undefined };
  }
  return { ...f, [key]: cur === value ? undefined : value };
}

export interface Chip { key: keyof QFilters; value?: unknown; label: string }

export function chips(f: QFilters, typeLabels: Record<AssetType, string>, catalog?: CatalogIndex): Chip[] {
  const out: Chip[] = [];
  for (const t of f.type ?? []) out.push({ key: "type", value: t, label: typeLabels[t] });
  for (const t of f.tier ?? []) out.push({ key: "tier", value: t, label: `TruRisk ${TIER_LABELS[t].toLowerCase()}` });
  for (const c of f.criticality ?? []) out.push({ key: "criticality", value: c, label: c ? `Criticité ${c}/5` : "Criticité non renseignée" });
  for (const t of f.tag ?? []) out.push({ key: "tag", value: t, label: `Tag : ${t}` });
  for (const o of f.os ?? []) out.push({ key: "os", value: o, label: o });
  if (f.scan) out.push({ key: "scan", label: SCAN_LABELS[f.scan] });
  if (f.agent !== undefined) out.push({ key: "agent", label: f.agent ? "Avec agent Qualys" : "Sans agent Qualys" });
  if (f.publicIp !== undefined) out.push({ key: "publicIp", label: f.publicIp ? "Exposés sur Internet" : "Non exposés sur Internet" });
  if (f.threat) out.push({ key: "threat", label: THREAT_LABELS[f.threat] });
  if (f.eol) out.push({ key: "eol", label: "Produit en fin de support" });
  if (f.overdue) out.push({ key: "overdue", label: "Vulnérabilités hors délai" });
  if (f.sev5) out.push({ key: "sev5", label: "Vulnérabilités critiques" });
  if (f.qid !== undefined) out.push({ key: "qid", label: `${catalog?.byQid.get(f.qid)?.title?.slice(0, 50) || "QID"} (${f.qid})` });
  if (f.product) out.push({ key: "product", label: `Produit : ${f.product}` });
  if (f.search) out.push({ key: "search", label: `« ${f.search} »` });
  return out;
}

export function removeChip(f: QFilters, c: Chip): QFilters {
  const cur = f[c.key];
  if (Array.isArray(cur)) {
    const next = (cur as unknown[]).filter((x) => x !== c.value);
    return { ...f, [c.key]: next.length ? next : undefined };
  }
  return { ...f, [c.key]: undefined };
}

// ---------------------------------------------------------------------------
// Chiffres recalculés sur la sélection
// ---------------------------------------------------------------------------

export function summarize(assets: DAsset[], now = Date.now()) {
  const s = {
    total: assets.length, agent: 0, recent: 0, stale: 0, never: 0, publicIp: 0,
    byType: { server: 0, workstation: 0, other: 0 } as Record<AssetType, number>,
    recentByType: { server: 0, workstation: 0, other: 0 } as Record<AssetType, number>,
    tiers: { critical: 0, high: 0, medium: 0, low: 0, none: 0 } as Record<TruTier, number>,
    truriskSum: 0, truriskN: 0,
    d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0,
    withVulns: 0, withSev5: 0, withOverdue: 0, kevAssets: 0, ransomwareAssets: 0, armedAssets: 0, eolAssets: 0,
    armedServers: 0,
  };
  for (const a of assets) {
    if (hasAgent(a)) s.agent++;
    const st = scanState(a, now);
    s[st]++;
    if (st === "recent") s.recentByType[a.asset_type]++;
    if (a.public_ip) s.publicIp++;
    s.byType[a.asset_type]++;
    s.tiers[truTier(a.trurisk)]++;
    if (a.trurisk !== null) { s.truriskSum += a.trurisk; s.truriskN++; }
    s.d5 += a.d5; s.d4 += a.d4; s.d3 += a.d3; s.overdue += a.overdue; s.ignored += a.ignored; s.reopened += a.reopened;
    if (a.d5 + a.d4 + a.d3) s.withVulns++;
    if (a.d5) s.withSev5++;
    if (a.overdue) s.withOverdue++;
    if (a.kev) s.kevAssets++;
    if (a.ransomware) s.ransomwareAssets++;
    if (a.armed) { s.armedAssets++; if (a.asset_type === "server") s.armedServers++; }
    if (a.eol) s.eolAssets++;
  }
  return { ...s, truriskAvg: s.truriskN ? Math.round(s.truriskSum / s.truriskN) : null };
}
export type Summary = ReturnType<typeof summarize>;

/** Actifs touchés par chaque vulnérabilité, dans la sélection. */
export function qidHosts(assets: DAsset[]): Map<number, { hosts: number; servers: number }> {
  const m = new Map<number, { hosts: number; servers: number }>();
  for (const a of assets) for (const q of a.qids) {
    const c = m.get(q) ?? { hosts: 0, servers: 0 };
    c.hosts++;
    if (a.asset_type === "server") c.servers++;
    m.set(q, c);
  }
  return m;
}

export interface ProductGroup {
  key: string; qids: number[]; hosts: number; servers: number; publicHosts: number; maxSeverity: number; maxCvss: number | null;
  flags: number; armedQids: number; kevQids: number; detections: number; categories: string[];
}

/**
 * Vulnérabilités regroupées par produit à corriger, sur la sélection : nombre d'actifs distincts touchés,
 * menaces, sévérité maximale. Une ligne = un chantier de remédiation.
 */
export function productGroups(assets: DAsset[], idx: CatalogIndex): ProductGroup[] {
  const groups = new Map<string, ProductGroup & { qidSet: Set<number> }>();
  for (const a of assets) {
    const seen = new Set<string>();
    for (const q of a.qids) {
      const c = idx.byQid.get(q);
      const key = idx.product.get(q) ?? `QID ${q}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, qids: [], qidSet: new Set(), hosts: 0, servers: 0, publicHosts: 0, maxSeverity: 0, maxCvss: null, flags: 0, armedQids: 0, kevQids: 0, detections: 0, categories: [] };
        groups.set(key, g);
      }
      g.detections++;
      if (!g.qidSet.has(q)) {
        g.qidSet.add(q);
        if (c) {
          g.maxSeverity = Math.max(g.maxSeverity, c.severity ?? 0);
          if (c.cvss3 !== null) g.maxCvss = Math.max(g.maxCvss ?? 0, Number(c.cvss3));
          g.flags |= c.flags;
          if (c.flags & ARMED_FLAGS) g.armedQids++;
          if (c.flags & FLAGS.kev) g.kevQids++;
          if (c.category && !g.categories.includes(c.category)) g.categories.push(c.category);
        }
      }
      if (!seen.has(key)) {
        seen.add(key);
        g.hosts++;
        if (a.asset_type === "server") g.servers++;
        if (a.public_ip) g.publicHosts++;
      }
    }
  }
  return [...groups.values()].map(({ qidSet, ...g }) => ({ ...g, qids: [...qidSet] }));
}

/** Priorité d'un chantier : menaces réelles d'abord, puis étendue et sévérité. */
export const groupPriority = (g: ProductGroup) =>
  (g.flags & FLAGS.kev ? 4e6 : 0) + (g.flags & FLAGS.ransomware ? 2e6 : 0) + (g.flags & ARMED_FLAGS ? 1e6 : 0) + g.maxSeverity * 1e5 + g.servers * 10 + g.hosts;

/** Produits en fin de support présents dans la sélection. */
export function eolProducts(assets: DAsset[], idx: CatalogIndex) {
  const counts = qidHosts(assets);
  const out: { qid: number; title: string; os: boolean; hosts: number; servers: number }[] = [];
  for (const [qid, c] of counts) {
    const k = idx.byQid.get(qid);
    if (!k || !isEolTitle(k.title)) continue;
    out.push({ qid, title: k.title.replace(/^\s*EOL\s*\/\s*Obsolete\s*(Software|Operating System)?\s*:?\s*/i, ""), os: /operating system/i.test(k.title), hosts: c.hosts, servers: c.servers });
  }
  return out.sort((a, b) => b.hosts - a.hosts);
}

/** Valeurs proposées dans les filtres, avec leur nombre d'actifs. */
export function facetCounts(assets: DAsset[]) {
  const tags = new Map<string, number>(), os = new Map<string, number>(), crit = new Map<number, number>();
  for (const a of assets) {
    for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    const o = osFamily(a.os);
    os.set(o, (os.get(o) ?? 0) + 1);
    crit.set(a.criticality ?? 0, (crit.get(a.criticality ?? 0) ?? 0) + 1);
  }
  const sorted = <T,>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { tags: sorted(tags), os: sorted(os), criticality: [...crit.entries()].sort((a, b) => b[0] - a[0]) };
}

// ---------------------------------------------------------------------------
// Libellés et export
// ---------------------------------------------------------------------------

export const DETECTION_STATUS: Record<string, string> = { N: "Nouvelle", A: "Active", R: "Réouverte", I: "Dérogation" };
export const WAS_STATUS: Record<string, string> = { NEW: "Nouvelle", ACTIVE: "Active", REOPENED: "Réouverte", FIXED: "Corrigée", PROTECTED: "Protégée (WAF)" };
export const wasStatusLabel = (s: string | null) => (s ? WAS_STATUS[s.toUpperCase()] ?? s : "—");
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns.map((c) => cell(c.label)).join(";"), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(";"))].join("\r\n");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
