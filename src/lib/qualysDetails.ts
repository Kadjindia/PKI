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
export function truTier(s: number | null): TruTier {
  if (s === null) return "none";
  if (s >= 850) return "critical";
  if (s >= 700) return "high";
  if (s >= 500) return "medium";
  return "low";
}

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

/** Compteur de vulnérabilités de l'actif correspondant à une menace. */
const THREAT_COUNT: Record<Threat, (a: DAsset) => number> = { kev: (a) => a.kev, ransomware: (a) => a.ransomware, armed: (a) => a.armed };

/** Un filtre de la page : vrai si l'actif le satisfait (ou si le filtre n'est pas posé). */
type AssetCheck = (a: DAsset, f: QFilters, idx: CatalogIndex, now: number) => boolean;
const inList = <T,>(list: T[] | undefined, v: T) => !list?.length || list.includes(v);
const ASSET_CHECKS: AssetCheck[] = [
  (a, f) => inList(f.type, a.asset_type),
  (a, f) => inList(f.tier, truTier(a.trurisk)),
  (a, f) => inList(f.criticality, a.criticality ?? 0),
  (a, f) => !f.tag?.length || f.tag.some((t) => a.tags.includes(t)),
  (a, f) => inList(f.os, osFamily(a.os)),
  (a, f, _i, now) => !f.scan || scanState(a, now) === f.scan,
  (a, f) => f.agent === undefined || hasAgent(a) === f.agent,
  (a, f) => f.publicIp === undefined || a.public_ip === f.publicIp,
  (a, f) => !f.threat || THREAT_COUNT[f.threat](a) > 0,
  (a, f) => !f.eol || a.eol > 0,
  (a, f) => !f.overdue || a.overdue > 0,
  (a, f) => !f.sev5 || a.d5 > 0,
  (a, f) => f.qid === undefined || a.qids.includes(f.qid),
  (a, f, idx) => !f.product || a.qids.some((q) => idx.product.get(q) === f.product),
  (a, f) => !f.search || matchText(a, f.search),
];

export const assetMatches = (a: DAsset, f: QFilters, idx: CatalogIndex, now = Date.now()): boolean =>
  ASSET_CHECKS.every((check) => check(a, f, idx, now));

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

/** Pastilles des filtres à choix multiple. */
function listChips(f: QFilters, typeLabels: Record<AssetType, string>): Chip[] {
  return [
    ...(f.type ?? []).map((t) => ({ key: "type" as const, value: t, label: typeLabels[t] })),
    ...(f.tier ?? []).map((t) => ({ key: "tier" as const, value: t, label: `TruRisk ${TIER_LABELS[t].toLowerCase()}` })),
    ...(f.criticality ?? []).map((c) => ({ key: "criticality" as const, value: c, label: c ? `Criticité ${c}/5` : "Criticité non renseignée" })),
    ...(f.tag ?? []).map((t) => ({ key: "tag" as const, value: t, label: `Tag : ${t}` })),
    ...(f.os ?? []).map((o) => ({ key: "os" as const, value: o, label: o })),
  ];
}

/** Libellé d'un filtre oui / non (undefined s'il n'est pas posé). */
function yesNoLabel(v: boolean | undefined, yes: string, no: string): string | undefined {
  if (v === undefined) return undefined;
  return v ? yes : no;
}

/** Libellé de chaque filtre simple posé (undefined si le filtre n'est pas posé). */
const SIMPLE_CHIPS: [keyof QFilters, (f: QFilters, catalog?: CatalogIndex) => string | undefined][] = [
  ["scan", (f) => f.scan && SCAN_LABELS[f.scan]],
  ["agent", (f) => yesNoLabel(f.agent, "Avec agent Qualys", "Sans agent Qualys")],
  ["publicIp", (f) => yesNoLabel(f.publicIp, "Exposés sur Internet", "Non exposés sur Internet")],
  ["threat", (f) => f.threat && THREAT_LABELS[f.threat]],
  ["eol", (f) => (f.eol ? "Produit en fin de support" : undefined)],
  ["overdue", (f) => (f.overdue ? "Vulnérabilités hors délai" : undefined)],
  ["sev5", (f) => (f.sev5 ? "Vulnérabilités critiques" : undefined)],
  ["qid", (f, catalog) => (f.qid === undefined ? undefined : `${catalog?.byQid.get(f.qid)?.title?.slice(0, 50) || "QID"} (${f.qid})`)],
  ["product", (f) => f.product && `Produit : ${f.product}`],
  ["search", (f) => f.search && `« ${f.search} »`],
];

export function chips(f: QFilters, typeLabels: Record<AssetType, string>, catalog?: CatalogIndex): Chip[] {
  const simple = SIMPLE_CHIPS.map(([key, label]) => ({ key, label: label(f, catalog) })).filter((c): c is Chip => Boolean(c.label));
  return [...listChips(f, typeLabels), ...simple];
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

const emptySummary = (total: number) => ({
  total, agent: 0, recent: 0, stale: 0, never: 0, publicIp: 0,
  byType: { server: 0, workstation: 0, other: 0 } as Record<AssetType, number>,
  recentByType: { server: 0, workstation: 0, other: 0 } as Record<AssetType, number>,
  tiers: { critical: 0, high: 0, medium: 0, low: 0, none: 0 } as Record<TruTier, number>,
  truriskSum: 0, truriskN: 0,
  d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0,
  withVulns: 0, withSev5: 0, withOverdue: 0, kevAssets: 0, ransomwareAssets: 0, armedAssets: 0, eolAssets: 0,
  armedServers: 0,
});
type SummaryCounts = ReturnType<typeof emptySummary>;

/** Couverture d'un actif : agent, dernier scan, exposition, type, score. */
function addCoverage(s: SummaryCounts, a: DAsset, now: number) {
  if (hasAgent(a)) s.agent++;
  const st = scanState(a, now);
  s[st]++;
  if (st === "recent") s.recentByType[a.asset_type]++;
  if (a.public_ip) s.publicIp++;
  s.byType[a.asset_type]++;
  s.tiers[truTier(a.trurisk)]++;
  if (a.trurisk !== null) { s.truriskSum += a.trurisk; s.truriskN++; }
}

/** Vulnérabilités et menaces d'un actif. */
function addExposure(s: SummaryCounts, a: DAsset) {
  s.d5 += a.d5; s.d4 += a.d4; s.d3 += a.d3; s.overdue += a.overdue; s.ignored += a.ignored; s.reopened += a.reopened;
  const count = (cond: number | boolean) => (cond ? 1 : 0);
  s.withVulns += count(a.d5 + a.d4 + a.d3);
  s.withSev5 += count(a.d5);
  s.withOverdue += count(a.overdue);
  s.kevAssets += count(a.kev);
  s.ransomwareAssets += count(a.ransomware);
  s.armedAssets += count(a.armed);
  s.armedServers += count(a.armed && a.asset_type === "server");
  s.eolAssets += count(a.eol);
}

export function summarize(assets: DAsset[], now = Date.now()) {
  const s = emptySummary(assets.length);
  for (const a of assets) {
    addCoverage(s, a, now);
    addExposure(s, a);
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
type GroupAcc = ProductGroup & { qidSet: Set<number> };
const newGroup = (key: string): GroupAcc =>
  ({ key, qids: [], qidSet: new Set(), hosts: 0, servers: 0, publicHosts: 0, maxSeverity: 0, maxCvss: null, flags: 0, armedQids: 0, kevQids: 0, detections: 0, categories: [] });

/** Première rencontre d'une vulnérabilité dans un chantier : sévérité, CVSS, menaces, catégorie. */
function addVulnToGroup(g: GroupAcc, c: DCatalog) {
  g.maxSeverity = Math.max(g.maxSeverity, c.severity ?? 0);
  if (c.cvss3 !== null) g.maxCvss = Math.max(g.maxCvss ?? 0, Number(c.cvss3));
  g.flags |= c.flags;
  if (c.flags & ARMED_FLAGS) g.armedQids++;
  if (c.flags & FLAGS.kev) g.kevQids++;
  if (c.category && !g.categories.includes(c.category)) g.categories.push(c.category);
}

/** Un actif compté une seule fois par chantier. */
function addAssetToGroup(g: GroupAcc, a: DAsset) {
  g.hosts++;
  if (a.asset_type === "server") g.servers++;
  if (a.public_ip) g.publicHosts++;
}

/**
 * Vulnérabilités regroupées par produit à corriger, sur la sélection : nombre d'actifs distincts touchés,
 * menaces, sévérité maximale. Une ligne = un chantier de remédiation.
 */
export function productGroups(assets: DAsset[], idx: CatalogIndex): ProductGroup[] {
  const groups = new Map<string, GroupAcc>();
  for (const a of assets) {
    const seen = new Set<string>();
    for (const q of a.qids) {
      const key = idx.product.get(q) ?? `QID ${q}`;
      const g = groups.get(key) ?? newGroup(key);
      groups.set(key, g);
      g.detections++;
      const c = idx.byQid.get(q);
      if (!g.qidSet.has(q)) {
        g.qidSet.add(q);
        if (c) addVulnToGroup(g, c);
      }
      if (!seen.has(key)) { seen.add(key); addAssetToGroup(g, a); }
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
  // Élément d'une liste : comme Array#join (sous-liste « a,b », vide pour null)
  const item = (x: unknown): string => {
    if (x === null || x === undefined) return "";
    if (Array.isArray(x)) return x.map(item).join(",");
    return typeof x === "object" ? JSON.stringify(x) : String(x as string | number | boolean);
  };
  const text = (v: unknown) => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.map(item).join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v as string | number | boolean);
  };
  const cell = (v: unknown) => {
    const s = text(v);
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
