// Lecture des réponses XML de Qualys et calcul des chiffres de la photo.
// Module sans dépendance : utilisé par qualys-proxy et testé avec Vitest.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Critique (5), élevée (4), modérée (3) : les trois niveaux de la politique de gestion des correctifs. */
export const SEVERITIES = [5, 4, 3] as const;
/**
 * Délais de remédiation fixés par la politique de gestion des correctifs :
 * Critique (sévérité 5) : 7 jours calendaires, traitée comme un incident de sécurité ;
 * Élevé (4) : 1 mois calendaire ; Modéré (3) : 3 mois calendaires.
 */
export const SLA: Record<number, { days?: number; months?: number; label: string }> = {
  5: { days: 7, label: "7 jours" },
  4: { months: 1, label: "1 mois" },
  3: { months: 3, label: "3 mois" },
};
/** Délai cible en jours (approché pour les mois), pour les comparaisons et l'affichage. */
export const SLA_DAYS: Record<number, number> = { 5: 7, 4: 30, 3: 91 };

/** Échéance de remédiation d'une vulnérabilité détectée à `firstFound` (ms). Mois calendaires : même jour, ramené au dernier jour du mois si besoin. */
export function deadline(firstFound: number, sev: number): number {
  const rule = SLA[sev];
  if (!rule) return Infinity;
  if (rule.days) return firstFound + rule.days * DAY;
  const d = new Date(firstFound);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (rule.months ?? 0), 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}
/** Tranches d'ancienneté (jours depuis la première détection). */
export const AGE_LIMITS = [30, 90, 180]; // < 30, 30-90, 90-180, > 180
export const RECENT_SCAN_DAYS = 30;
/** Période d'observation des vulnérabilités corrigées (respect des délais, MTTR). */
export const FIXED_WINDOW_DAYS = 90;

export const TOP = 20;
export const TOP_OS = 10;
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Lecture du XML Qualys (format connu : extraction ciblée, sans tout charger en objets)
// ---------------------------------------------------------------------------

/** Contenu d'une balise (premier niveau trouvé), CDATA retiré. */
export function tag(s: string, name: string): string | null {
  const m = s.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

/** Blocs successifs <name>...</name> (non imbriqués entre eux). */
export function* blocks(s: string, name: string): Generator<string> {
  const open = `<${name}>`, close = `</${name}>`;
  let i = 0;
  while ((i = s.indexOf(open, i)) !== -1) {
    const j = s.indexOf(close, i);
    if (j === -1) return;
    yield s.slice(i + open.length, j);
    i = j + close.length;
  }
}

/**
 * Valeurs simples d'un bloc XML (balise -> texte), pour afficher « tous les détails » d'un élément
 * sans dépendre d'une liste de champs figée. Les blocs `skip` (listes volumineuses) sont ignorés ;
 * une balise répétée garde sa première valeur.
 */
export function leaves(xml: string, skip: readonly string[] = []): Record<string, string> {
  let s = xml;
  for (const k of skip) s = s.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*?</${k}>`, "g"), "");
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*|([^<]*))<\/\1>/g)) {
    const v = (m[2] ?? m[3] ?? "").trim();
    if (v && !(m[1] in out)) out[m[1]] = v.slice(0, 500);
  }
  return out;
}

/** Date ISO, ou null si illisible. */
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
};

/** Erreur renvoyée par Qualys (SIMPLE_RETURN), sinon null. */
export function qualysError(xml: string): string | null {
  if (!xml.includes("<SIMPLE_RETURN>")) return null;
  return `${tag(xml, "TEXT") ?? "Erreur Qualys"} (code ${tag(xml, "CODE") ?? "?"})`;
}

/** Adresse de la page suivante (WARNING/URL), seulement sur le serveur Qualys configuré. */
export function nextPageUrl(xml: string, base: string): string | null {
  const warning = tag(xml, "WARNING");
  const url = warning ? tag(warning, "URL")?.replace(/&amp;/g, "&") : null;
  if (!url) return null;
  try {
    return new URL(url).origin === new URL(base).origin ? url : null;
  } catch {
    return null;
  }
}

const daysSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / DAY : null);

// ---------------------------------------------------------------------------
// Type d'actif, déduit du système d'exploitation détecté par Qualys
// (les tags de la console ne sont pas assez fiables pour découper le parc)
// ---------------------------------------------------------------------------

export type AssetType = "server" | "workstation" | "other";
export const ASSET_TYPES: AssetType[] = ["server", "workstation", "other"];

export function assetType(os: string | null | undefined): AssetType {
  const s = (os ?? "").toLowerCase();
  if (!s) return "other";
  if (/server|linux|unix|ubuntu|debian|red ?hat|rhel|centos|rocky/.test(s) || /alma|suse|oracle|aix|solaris|hp-?ux|esxi?|vmware|freebsd/.test(s)) return "server";
  if (/windows (xp|vista|7|8|8\.1|10|11)\b|\bmac ?os\b|\bos x\b|darwin/.test(s)) return "workstation";
  return "other";
}

const emptyByType = <T>(f: () => T): Record<AssetType, T> => ({ server: f(), workstation: f(), other: f() });

/** Adresse IPv4 publique (joignable depuis Internet), hors plages privées et réservées. */
export function isPublicIp(ip: string | null | undefined): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((ip ?? "").trim());
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  return true;
}

// ---------------------------------------------------------------------------
// Chiffres d'une page
// ---------------------------------------------------------------------------

/** Fiche d'un actif VMDR (table qualys_assets). */
export interface AssetRow {
  host_id: number; asset_id: number | null; name: string | null; netbios: string | null; ip: string | null; os: string | null;
  asset_type: AssetType; tracking: string | null; trurisk: number | null; criticality: number | null;
  last_scan: string | null; last_activity: string | null; public_ip: boolean; tags: string[]; attrs: Record<string, string>;
}

type TruriskBand = "critical" | "high" | "medium" | "low";
/** Tranche du score TruRisk (0-1000). */
function truriskBand(score: number): TruriskBand {
  if (score >= 850) return "critical";
  if (score >= 700) return "high";
  if (score >= 500) return "medium";
  return "low";
}

/** Score TruRisk d'un actif, s'il est renseigné. */
function truriskOf(h: string): number | null {
  const raw = tag(h, "TRURISK_SCORE");
  if (raw === null) return null;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
}

const positiveOrNull = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);
const HOST_ATTR_SKIP = ["TAGS", "DNS_DATA", "CLOUD_PROVIDER_TAGS", "METADATA", "ASSET_GROUP_IDS"];

/** Fiche d'un actif de la liste VMDR. */
function hostRow(h: string, hid: number, os: string | null, type: AssetType, last: string | null, trurisk: number | null): AssetRow {
  return {
    host_id: hid, asset_id: positiveOrNull(Number(tag(h, "ASSET_ID"))),
    name: tag(h, "DNS") || tag(h, "NETBIOS") || null, netbios: tag(h, "NETBIOS"), ip: tag(h, "IP"), os, asset_type: type,
    tracking: tag(h, "TRACKING_METHOD"), trurisk,
    criticality: positiveOrNull(Number(tag(h, "ASSET_CRITICALITY_SCORE"))),
    last_scan: isoOrNull(last), last_activity: isoOrNull(tag(h, "LAST_ACTIVITY") ?? tag(h, "LAST_BOOT")),
    public_ip: isPublicIp(tag(h, "IP")),
    tags: [...blocks(tag(h, "TAGS") ?? "", "TAG")].map((t) => tag(t, "NAME")).filter((x): x is string => Boolean(x)),
    attrs: leaves(h, HOST_ATTR_SKIP),
  };
}

/** Liste des actifs : couverture des scans, score TruRisk, fiches des actifs. */
export function hostsPage(xml: string, now: number) {
  const rows: AssetRow[] = [];
  const agg = { total: 0, agent: 0, scanned: 0, neverScanned: 0 };
  const tr: Record<TruriskBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let truriskSum = 0, truriskCount = 0;
  const byType = emptyByType(() => ({ total: 0, scanned: 0, publicIp: 0 }));
  /** Identifiants des actifs : pour partager la lecture des vulnérabilités entre deux appels simultanés. */
  const ids: number[] = [];
  for (const h of blocks(xml, "HOST")) {
    agg.total++;
    const hid = Number(tag(h, "ID"));
    const os = tag(h, "OS");
    const type = assetType(os);
    const t = byType[type];
    t.total++;
    if (isPublicIp(tag(h, "IP"))) t.publicIp++;
    if (/agent/i.test(tag(h, "TRACKING_METHOD") ?? "")) agg.agent++;
    const last = tag(h, "LAST_VULN_SCAN_DATETIME") ?? tag(h, "LAST_VM_SCANNED_DATE");
    const age = daysSince(last, now);
    if (age === null) agg.neverScanned++;
    else if (age <= RECENT_SCAN_DAYS) { agg.scanned++; t.scanned++; }
    const score = truriskOf(h);
    if (score !== null) {
      truriskSum += score;
      truriskCount++;
      tr[truriskBand(score)]++;
    }
    if (Number.isFinite(hid)) {
      ids.push(hid);
      rows.push(hostRow(h, hid, os, type, last, score));
    }
  }
  return { ...agg, trurisk: tr, truriskSum, truriskCount, byType, ids, rows };
}

/** QID -> [détections, sévérité, hors délai, plus ancienne détection (ms, 0 si inconnue), QDS max, détections QDS >= 90, détections sur serveurs]. */
type QidStat = [number, number, number, number, number, number, number];

/**
 * Vulnérabilités d'un actif (table qualys_asset_vulns). `detections` : une ligne par détection,
 * [QID, sévérité, 1re détection (AAAA-MM-JJ), dernière détection, statut (N nouvelle, A active, R réouverte),
 *  QDS, dérogation (1/0), hors délai (1/0), port].
 */
export interface AssetVulnRow {
  host_id: number; d5: number; d4: number; d3: number; overdue: number; ignored: number; reopened: number; qds_max: number;
  qids: number[]; detections: (string | number | null)[][];
}

type DetStatus = "R" | "N" | "A" | "I";
/** Une détection lue : ce qui sert aux compteurs. */
interface Det { qid: string | null; qidNum: number; sev: number; first: string | null; age: number; qds: number; late: boolean }
interface SevStat { total: number; overdue: number; ages: number[]; reopened: number; ageSum: number }

function newDetectionsAgg() {
  const bySev: Record<string, SevStat> = {};
  for (const s of SEVERITIES) bySev[s] = { total: 0, overdue: 0, ages: [0, 0, 0, 0], reopened: 0, ageSum: 0 };
  return {
    hosts: 0, hostsWithVulns: 0, bySev,
    byType: emptyByType(() => ({ total: 0, overdue: 0, sev5: 0 })),
    ignored: { total: 0, sev5: 0, ages: [0, 0, 0, 0] },
    /** Actifs portant au moins un système ou logiciel en fin de vie (EOL/Obsolete). */
    eol: emptyByType(() => 0),
    qdsCritical: 0, potential: 0,
    qids: {} as Record<string, QidStat>,
    rows: [] as AssetVulnRow[],
  };
}
type DetectionsAgg = ReturnType<typeof newDetectionsAgg>;

/** Tranche d'ancienneté : < 30 j, 30-90 j, 90-180 j, > 180 j. */
function ageBucket(age: number): number {
  const i = AGE_LIMITS.findIndex((l) => age < l);
  return i === -1 ? AGE_LIMITS.length : i;
}

function detectionStatus(status: string): DetStatus {
  if (/re-?opened/i.test(status)) return "R";
  if (/new/i.test(status)) return "N";
  return "A";
}

const dayOf = (v: string | null) => (v ? v.slice(0, 10) : null);

function readDetection(d: string, sev: number, now: number): Det {
  const first = tag(d, "FIRST_FOUND_DATETIME");
  const qid = tag(d, "QID");
  return {
    qid, qidNum: Number(qid), sev, first, age: daysSince(first, now) ?? 0, qds: Number(tag(d, "QDS") ?? 0) || 0,
    late: first ? now > deadline(Date.parse(first), sev) : false,
  };
}

function detectionRow(d: string, det: Det, st: DetStatus): (string | number | null)[] {
  const port = tag(d, "PORT");
  const ignored = st === "I";
  return [det.qidNum, det.sev, dayOf(det.first), dayOf(tag(d, "LAST_FOUND_DATETIME")), st, det.qds, ignored ? 1 : 0, !ignored && det.late ? 1 : 0, port ? Number(port) : null];
}

/** Dérogation : vulnérabilité ignorée dans la console (risque accepté), comptée à part. */
function countIgnored(acc: DetectionsAgg, row: AssetVulnRow, det: Det) {
  row.ignored++;
  acc.ignored.total++;
  if (det.sev === 5) acc.ignored.sev5++;
  acc.ignored.ages[ageBucket(det.age)]++;
}

function countOpenOnHost(row: AssetVulnRow, det: Det, st: DetStatus) {
  if (Number.isFinite(det.qidNum)) row.qids.push(det.qidNum);
  if (det.sev === 5) row.d5++;
  else if (det.sev === 4) row.d4++;
  else row.d3++;
  if (det.late) row.overdue++;
  if (st === "R") row.reopened++;
  row.qds_max = Math.max(row.qds_max, det.qds);
}

function countOpen(acc: DetectionsAgg, det: Det, st: DetStatus, type: AssetType) {
  const stat = acc.bySev[det.sev];
  stat.total++;
  stat.ageSum += det.age;
  if (det.late) stat.overdue++;
  if (st === "R") stat.reopened++;
  stat.ages[ageBucket(det.age)]++;
  const t = acc.byType[type];
  t.total++;
  if (det.late) t.overdue++;
  if (det.sev === 5) t.sev5++;
  if (det.qds >= 90) acc.qdsCritical++;
}

function countQid(qids: Record<string, QidStat>, det: Det, type: AssetType) {
  if (!det.qid) return;
  const q = (qids[det.qid] ??= [0, det.sev, 0, 0, 0, 0, 0]);
  q[0]++;
  if (det.late) q[2]++;
  if (det.first) {
    const t = Date.parse(det.first);
    q[3] = q[3] ? Math.min(q[3], t) : t;
  }
  q[4] = Math.max(q[4], det.qds);
  if (det.qds >= 90) q[5]++;
  if (type === "server") q[6]++;
}

/** Vulnérabilités ouvertes d'une page d'actifs. `eolQids` : produits en fin de vie connus. */
export function detectionsPage(xml: string, now: number, eolQids: readonly string[] = []) {
  const acc = newDetectionsAgg();
  const eolSet = new Set(eolQids);
  for (const h of blocks(xml, "HOST")) {
    acc.hosts++;
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const type = assetType(tag(head, "OS"));
    let hasEol = false;
    const row: AssetVulnRow = { host_id: Number(tag(head, "ID")), d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0, qds_max: 0, qids: [], detections: [] };
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      if (!acc.bySev[sev] || tag(d, "IS_DISABLED") === "1") continue;
      const det = readDetection(d, sev, now);
      if (tag(d, "IS_IGNORED") === "1") {
        row.detections.push(detectionRow(d, det, "I"));
        countIgnored(acc, row, det);
        continue;
      }
      if (/potential/i.test(tag(d, "TYPE") ?? "")) acc.potential++;
      const st = detectionStatus(tag(d, "STATUS") ?? "");
      row.detections.push(detectionRow(d, det, st));
      countOpenOnHost(row, det, st);
      countOpen(acc, det, st, type);
      countQid(acc.qids, det, type);
      if (det.qid && eolSet.has(det.qid)) hasEol = true;
    }
    if (hasEol) acc.eol[type]++;
    if (Number.isFinite(row.host_id) && row.detections.length) acc.rows.push(row);
    if (row.d5 + row.d4 + row.d3 > 0) acc.hostsWithVulns++;
  }
  return acc;
}

/** Répartition des délais de correction : jour -> nombre (plafonné à 365). */
type Hist = Record<string, number>;
interface FixStat { n: number; inSla: number; daysSum: number; hist: Hist }
const emptyFix = (): FixStat => ({ n: 0, inSla: 0, daysSum: 0, hist: {} });

/**
 * Partage du parc en deux moitiés d'identifiants, lues en parallèle (l'abonnement autorise
 * deux appels simultanés). Renvoie [plage 1, plage 2] ; une seule plage si le parc est petit.
 */
export function splitHosts(ids: number[]): { min?: number; max?: number }[] {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length < 200) return [{}];
  const mid = sorted[Math.floor(sorted.length / 2) - 1];
  return [{ max: mid }, { min: mid + 1 }];
}

/** Date au format attendu par Qualys (AAAA-MM-JJTHH:MM:SSZ), encodée pour l'adresse ; accepte « …+00:00 » comme « …Z ». */
export const qualysDate = (iso: string) => encodeURIComponent(new Date(Date.parse(iso)).toISOString().replace(/\.\d{3}Z$/, "Z"));

/** Ligne cumulée des vulnérabilités corrigées : un jour de correction, une sévérité, un type d'actif. */
export interface FixedRow { day: string; severity: number; asset_type: AssetType; n: number; in_sla: number; days_sum: number; hist: Hist }

/**
 * Vulnérabilités corrigées (statut Fixed) dont la correction a été constatée dans [since, until[ :
 * délais de correction réels, regroupés par jour, sévérité et type d'actif. La borne haute évite de
 * compter deux fois une correction lue par deux calculs successifs.
 */
export function fixedPage(xml: string, since: number, until = Infinity) {
  const cells: Record<string, FixedRow> = {};
  for (const h of blocks(xml, "HOST")) {
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const type = assetType(tag(head, "OS"));
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      if (!SLA[sev] || !/fixed/i.test(tag(d, "STATUS") ?? "")) continue;
      const fixedAt = Date.parse(tag(d, "LAST_FIXED_DATETIME") ?? "");
      const first = Date.parse(tag(d, "FIRST_FOUND_DATETIME") ?? "");
      if (!Number.isFinite(fixedAt) || !Number.isFinite(first) || fixedAt < since || fixedAt >= until) continue;
      const days = Math.max(0, Math.floor((fixedAt - first) / DAY));
      const day = new Date(fixedAt).toISOString().slice(0, 10);
      const key = `${day}|${sev}|${type}`;
      const c = (cells[key] ??= { day, severity: sev, asset_type: type, n: 0, in_sla: 0, days_sum: 0, hist: {} });
      c.n++;
      if (fixedAt <= deadline(first, sev)) c.in_sla++;
      c.days_sum += days;
      const k = String(Math.min(days, 365));
      c.hist[k] = (c.hist[k] ?? 0) + 1;
    }
  }
  return { cells };
}

/** Lignes cumulées de plusieurs pages (mêmes jour, sévérité et type additionnés). */
export function mergeFixedRows(list: FixedRow[]): FixedRow[] {
  const out: Record<string, FixedRow> = {};
  for (const r of list) {
    const key = `${r.day}|${r.severity}|${r.asset_type}`;
    const c = (out[key] ??= { day: r.day, severity: r.severity, asset_type: r.asset_type, n: 0, in_sla: 0, days_sum: 0, hist: {} });
    c.n += r.n; c.in_sla += r.in_sla; c.days_sum += Number(r.days_sum);
    for (const [k, v] of Object.entries(r.hist ?? {})) c.hist[k] = (c.hist[k] ?? 0) + Number(v);
  }
  return Object.values(out);
}

/** Corrections lues pendant la photo (pages « fixed »). */
export const fixedRowsOfPages = (pages: { kind: string; agg: Row }[]) =>
  mergeFixedRows(pages.filter((p) => p.kind === "fixed").flatMap((p) => Object.values((p.agg.cells ?? {}) as Record<string, FixedRow>)));

/** Base de connaissances : titre, CVE et indicateurs de menace de chaque vulnérabilité. */
export const KB_FLAGS = { kev: 1, ransomware: 2, patchable: 4, activeAttacks: 8, exploitPublic: 16 } as const;
/** Vulnérabilité « armée » : exploitée ou exploitable par un attaquant. */
export const ARMED = KB_FLAGS.kev | KB_FLAGS.ransomware | KB_FLAGS.activeAttacks | KB_FLAGS.exploitPublic;
export function kbPage(xml: string) {
  const out: Record<string, [string, number, string]> = {};
  for (const v of blocks(xml, "VULN")) {
    const qid = tag(v, "QID");
    if (!qid) continue;
    const intel = [...v.matchAll(/<THREAT_INTEL[^>]*>(?:<!\[CDATA\[)?([^\]<]*)/g)].map((m) => m[1]);
    let flags = 0;
    if (intel.some((t) => /cisa_known_exploited/i.test(t))) flags |= KB_FLAGS.kev;
    if (intel.some((t) => /ransomware/i.test(t))) flags |= KB_FLAGS.ransomware;
    if (intel.some((t) => /active_attacks/i.test(t))) flags |= KB_FLAGS.activeAttacks;
    if (intel.some((t) => /exploit_public/i.test(t))) flags |= KB_FLAGS.exploitPublic;
    if (tag(v, "PATCHABLE") === "1") flags |= KB_FLAGS.patchable;
    const cves = [...blocks(tag(v, "CVE_LIST") ?? "", "CVE")].map((c) => tag(c, "ID")).filter(Boolean).slice(0, 5).join(", ");
    out[qid] = [tag(v, "TITLE") ?? "", flags, cves];
  }
  return out;
}

/** Texte lisible d'un champ HTML de la base de connaissances (solution, conséquence…). */
export const plainText = (html: string | null, max: number) =>
  normalizeSpaces(decodeEntities(stripTags(html ?? ""))).slice(0, max) || null;

/** Retire les balises HTML en un seul passage ; fin de ligne pour <br>, </p> et </li>. */
function stripTags(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    const gt = html.indexOf(">", lt);
    if (gt === -1) { out += html.slice(lt); break; }
    const name = html.slice(lt + 1, gt).trim().toLowerCase().replace(/\/$/, "").trim();
    if (name === "br" || name === "/p" || name === "/li") out += "\n";
    i = gt + 1;
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
const decodeEntities = (s: string) => s.replace(/&(?:nbsp|lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e]);

/** Espaces et tabulations réduits à un ; lignes vides retirées. */
const normalizeSpaces = (s: string) =>
  s.split(/\r?\n|\r/).map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l) => l !== "").join("\n");

/** Fiche d'une vulnérabilité de la base de connaissances (table qualys_kb). */
export interface KbRow {
  qid: number; severity: number | null; title: string; category: string | null; vuln_type: string | null;
  cvss3: number | null; cvss: number | null; cves: string[]; flags: number; threats: string[];
  products: [string, string][]; solution: string | null; consequence: string | null; diagnosis: string | null;
  published: string | null; patch_published: string | null; vendor_refs: string[];
}

export function kbDetails(xml: string): KbRow[] {
  const out: KbRow[] = [];
  const flagsOf = kbPage(xml);
  for (const v of blocks(xml, "VULN")) {
    const qid = Number(tag(v, "QID"));
    if (!Number.isFinite(qid)) continue;
    const num = (x: string | null) => { const n = Number(x); return x !== null && x !== "" && Number.isFinite(n) ? n : null; };
    out.push({
      qid, severity: num(tag(v, "SEVERITY_LEVEL")), title: tag(v, "TITLE") ?? "", category: tag(v, "CATEGORY"), vuln_type: tag(v, "VULN_TYPE"),
      cvss3: num(tag(tag(v, "CVSS_V3") ?? "", "BASE")), cvss: num(tag(tag(v, "CVSS") ?? "", "BASE")),
      cves: [...blocks(tag(v, "CVE_LIST") ?? "", "CVE")].map((c) => tag(c, "ID")).filter((x): x is string => Boolean(x)).slice(0, 50),
      flags: flagsOf[String(qid)]?.[1] ?? 0,
      threats: [...v.matchAll(/<THREAT_INTEL[^>]*>(?:<!\[CDATA\[)?([^\]<]*)/g)].map((m) => m[1].trim()).filter(Boolean),
      products: [...blocks(tag(v, "SOFTWARE_LIST") ?? "", "SOFTWARE")].map((x) => [tag(x, "VENDOR") ?? "", tag(x, "PRODUCT") ?? ""] as [string, string]).filter((x) => x[1]).slice(0, 20),
      solution: plainText(tag(v, "SOLUTION"), 3000), consequence: plainText(tag(v, "CONSEQUENCE"), 1500), diagnosis: plainText(tag(v, "DIAGNOSIS"), 1500),
      published: isoOrNull(tag(v, "PUBLISHED_DATETIME")), patch_published: isoOrNull(tag(v, "PATCH_PUBLISHED_DATE")),
      vendor_refs: [...blocks(tag(v, "VENDOR_REFERENCE_LIST") ?? "", "VENDOR_REFERENCE")].map((r) => tag(r, "ID")).filter((x): x is string => Boolean(x)).slice(0, 20),
    });
  }
  return out;
}

/** Vulnérabilité signalant un système ou un logiciel en fin de vie (titres Qualys « EOL/Obsolete … »). */
export const isEol = (title: string | null | undefined) => /^\s*EOL\s*\/\s*Obsolete/i.test(title ?? "");
/** Fin de vie d'un système d'exploitation (plutôt que d'un logiciel). */
export const isEolOs = (title: string | null | undefined) => isEol(title) && /operating system/i.test(title ?? "");

// ---------------------------------------------------------------------------
// Conformité (Policy Audit) : politiques et état de conformité
// ---------------------------------------------------------------------------

/** Liste des politiques de conformité : identifiant et titre. */
export function policiesPage(xml: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const p of blocks(tag(xml, "POLICY_LIST") ?? "", "POLICY")) {
    const id = tag(p, "ID");
    if (id) out.push({ id, title: tag(p, "TITLE") ?? `Politique ${id}` });
  }
  return out;
}

/** État de conformité d'une page (un lot d'actifs) pour une politique. */
export function posturePage(xml: string, policyId: string) {
  /** Contrôle -> [réussis, échoués, en erreur]. */
  const controls: Record<string, [number, number, number]> = {};
  const hosts = new Set<string>();
  const failingHosts = new Set<string>();
  let passed = 0, failed = 0, errors = 0, records = 0;
  for (const i of blocks(tag(xml, "INFO_LIST") ?? "", "INFO")) {
    records++;
    const cid = tag(i, "CONTROL_ID");
    const host = tag(i, "HOST_ID");
    const status = (tag(i, "STATUS") ?? "").toLowerCase();
    if (!cid) continue;
    if (host) hosts.add(host);
    const c = (controls[cid] ??= [0, 0, 0]);
    if (status.startsWith("pass")) { passed++; c[0]++; }
    else if (status.startsWith("fail")) { failed++; c[1]++; if (host) failingHosts.add(host); }
    else { errors++; c[2]++; }
  }
  /** Libellé et criticité des contrôles (glossaire de la réponse). */
  const glossary: Record<string, [string, string | null]> = {};
  for (const c of blocks(tag(xml, "CONTROL_LIST") ?? "", "CONTROL")) {
    const cid = tag(c, "CID") ?? tag(c, "ID");
    if (cid) glossary[cid] = [tag(c, "STATEMENT") ?? "", tag(tag(c, "CRITICALITY") ?? "", "LABEL")];
  }
  // Contrôle de lecture : enregistrements reconnus face aux balises <INFO> présentes, et racine de la réponse
  const raw = (xml.match(/<INFO[\s>]/g) ?? []).length;
  const root = /<([A-Z_]+)[\s>]/.exec(xml.replace(/<\?[^>]*\?>|<!DOCTYPE[^>]*>/g, ""))?.[1] ?? null;
  // Identifiants des actifs : un actif peut être réparti sur plusieurs pages (Qualys pagine par enregistrement)
  return { policyId, hosts: hosts.size, compliantHosts: hosts.size - failingHosts.size, passed, failed, errors, controls, glossary, records, raw, root,
    hostIds: [...hosts], failingIds: [...failingHosts] };
}

/** Cumul des pages de conformité d'une même politique (reprise d'une lecture interrompue). */
export function mergePosture(parts: Row[]): ReturnType<typeof posturePage> | null {
  if (!parts.length) return null;
  const out = { policyId: String(parts[0].policyId), hosts: 0, compliantHosts: 0, passed: 0, failed: 0, errors: 0,
    controls: {} as Record<string, [number, number, number]>, glossary: {} as Record<string, [string, string | null]>,
    records: 0, raw: 0, root: (parts[0].root as string | null | undefined) ?? null, hostIds: [] as string[], failingIds: [] as string[] };
  const ids = new Set<string>(), failing = new Set<string>();
  let untracked = 0, untrackedOk = 0;
  for (const p of parts) {
    if (Array.isArray(p.hostIds)) {
      for (const h of p.hostIds) ids.add(String(h));
      for (const h of p.failingIds ?? []) failing.add(String(h));
    } else { untracked += Number(p.hosts) || 0; untrackedOk += Number(p.compliantHosts) || 0; }
    out.records += Number(p.records) || 0; out.raw += Number(p.raw) || 0;
    out.passed += Number(p.passed) || 0; out.failed += Number(p.failed) || 0; out.errors += Number(p.errors) || 0;
    for (const [cid, c] of Object.entries((p.controls ?? {}) as Record<string, [number, number, number]>)) {
      const cur = (out.controls[cid] ??= [0, 0, 0]);
      cur[0] += c[0]; cur[1] += c[1]; cur[2] += c[2];
    }
    Object.assign(out.glossary, p.glossary ?? {});
  }
  out.hostIds = [...ids];
  out.failingIds = [...failing];
  out.hosts = ids.size + untracked;
  out.compliantHosts = ids.size - failing.size + untrackedOk;
  return out;
}

// ---------------------------------------------------------------------------
// CSAM (inventaire) : agents, Shadow IT, cycle de vie des systèmes d'exploitation
// Format JSON de l'API Gateway « search/am/asset » ; lecture tolérante (champs optionnels).
// ---------------------------------------------------------------------------

export const AGENT_STALE_DAYS = 7;
export const NEW_ASSET_DAYS = 30;
const dateMs = (v: unknown): number | null => {
  const x = typeof v === "object" && v !== null ? (v as Row).dateTime ?? (v as Row).date ?? null : v;
  const t = typeof x === "number" ? x : Date.parse(String(x ?? ""));
  return Number.isFinite(t) && t > 0 ? t : null;
};

export interface CsamAsset { id: string; name: string | null; ip: string | null; os: string | null; source: string | null; created: string | null }

/** Fiche d'un actif CSAM (table qualys_csam_assets). */
export interface CsamRow {
  asset_id: number; host_id: number | null; name: string | null; ip: string | null; os: string | null; asset_type: AssetType;
  has_agent: boolean; has_scanner: boolean; agent_last_checkin: string | null; lifecycle_stage: string | null;
  eos: string | null; eol: string | null; created: string | null; last_seen: string | null; sources: string | null;
  hardware: string | null; criticality: number | null; tags: string[]; attrs: Row;
}

/** Copie allégée d'un objet JSON : listes volumineuses écourtées, champs très longs coupés. */
export function trimJson(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return depth > 3 ? `[${v.length}]` : v.slice(0, 10).map((x) => trimJson(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 4) return "{…}";
    const out: Row = {};
    for (const [k, x] of Object.entries(v as Row)) {
      if (/software|openPort|volume|networkInterface|processor|service|userAccount|container|missing/i.test(k)) continue;
      out[k] = trimJson(x, depth + 1);
    }
    return out;
  }
  return typeof v === "string" ? v.slice(0, 300) : v;
}

/** Nom du système d'exploitation d'un actif CSAM (objet ou simple texte selon la version de l'API). */
function csamOsName(a: Row): string | null {
  const osObj = a.operatingSystem ?? {};
  return osObj.osName ?? osObj.fullName ?? osObj.name ?? (typeof a.operatingSystem === "string" ? a.operatingSystem : null);
}

/** Cycle de vie du système d'exploitation : fin de support, fin de vie. */
function csamLifecycle(osObj: Row, now: number) {
  const lc = osObj.lifecycle ?? osObj.lifeCycle ?? {};
  const eos = dateMs(lc.eosDate ?? lc.endOfSupport);
  const eol = dateMs(lc.eolDate ?? lc.endOfLife);
  const stage = String(lc.stage ?? "");
  return {
    eos, eol, stage,
    outOfSupport: (eos !== null && eos < now) || /EOS|end of support/i.test(stage),
    endOfLife: (eol !== null && eol < now) || /EOL|end of life/i.test(stage),
  };
}
type CsamLifecycle = ReturnType<typeof csamLifecycle>;

const isoOfMs = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const csamCreated = (a: Row) => a.inventory?.created ?? a.createdDate ?? a.firstSeen;

function csamHardware(hw: Row): string | null {
  const parts = [hw.category?.category ?? hw.category1 ?? hw.category, hw.manufacturer, hw.model];
  return parts.filter((x) => typeof x === "string" && x).join(" · ") || null;
}

/** Ce qui est déjà lu d'un actif CSAM, partagé entre les compteurs et la fiche. */
interface CsamSeen { assetId: number; ip: string | null; os: string | null; type: AssetType; hasAgent: boolean; hasScanner: boolean; life: CsamLifecycle }

function csamRow(a: Row, x: CsamSeen): CsamRow {
  const sensor = a.sensor ?? {};
  const hostId = Number(a.hostId);
  const crit = Number(a.criticality?.score ?? a.criticalityScore);
  return {
    asset_id: x.assetId, host_id: positiveOrNull(hostId),
    name: a.assetName ?? a.name ?? null, ip: x.ip, os: x.os, asset_type: x.type, has_agent: x.hasAgent, has_scanner: x.hasScanner,
    agent_last_checkin: isoOrNull(a.agent?.lastCheckedIn?.dateTime ?? a.agent?.lastCheckedIn ?? a.agent?.lastActivity ?? sensor.lastAgentCheckIn),
    lifecycle_stage: x.life.stage || null, eos: isoOfMs(x.life.eos), eol: isoOfMs(x.life.eol),
    created: isoOrNull(csamCreated(a)),
    last_seen: isoOrNull(a.inventory?.lastUpdated ?? a.lastModifiedDate ?? a.lastSeen ?? sensor.lastFullScan),
    sources: String(a.inventory?.source ?? a.sources ?? "") || null,
    hardware: csamHardware(a.hardware ?? {}),
    criticality: positiveOrNull(crit),
    tags: ((a.tagList?.tag ?? a.tags ?? []) as Row[]).map((t) => String(t?.tagName ?? t?.name ?? "")).filter(Boolean).slice(0, 50),
    attrs: trimJson(a) as Row,
  };
}

function newCsamAgg() {
  return {
    total: 0, withAgent: 0, agentStale: 0, unmanaged: 0, unmanagedNew: 0, publicIp: 0,
    byType: emptyByType(() => ({ total: 0, withAgent: 0, unmanaged: 0 })),
    /** Système -> [actifs, fin de support (ms) ou 0, fin de vie (ms) ou 0, en fin de support ? 1 : 0]. */
    os: {} as Record<string, [number, number, number, number]>,
    osEol: 0, osEos: 0,
    recentUnmanaged: [] as CsamAsset[],
  };
}
type CsamAgg = ReturnType<typeof newCsamAgg>;

function countCsamAgent(agg: CsamAgg, a: Row, x: CsamSeen, now: number) {
  agg.withAgent++;
  agg.byType[x.type].withAgent++;
  const sensor = a.sensor ?? {};
  const last = dateMs(a.agent?.lastCheckedIn ?? a.agent?.lastActivity ?? a.agent?.lastCheckIn ?? sensor.lastAgentCheckIn);
  if (last !== null && now - last > AGENT_STALE_DAYS * DAY) agg.agentStale++;
}

/** Shadow IT : actif découvert (capteur passif, découverte réseau…) sans agent ni scan authentifié. */
function countUnmanaged(agg: CsamAgg, a: Row, x: CsamSeen, now: number) {
  agg.unmanaged++;
  agg.byType[x.type].unmanaged++;
  const created = dateMs(csamCreated(a));
  if (created === null || now - created > NEW_ASSET_DAYS * DAY) return;
  agg.unmanagedNew++;
  agg.recentUnmanaged.push({
    id: String(a.assetId ?? a.id ?? ""), name: a.assetName ?? a.name ?? null, ip: x.ip, os: x.os,
    source: a.inventory?.source ?? null, created: new Date(created).toISOString(),
  });
}

function countLifecycle(agg: CsamAgg, os: string | null, life: CsamLifecycle) {
  if (life.outOfSupport) agg.osEos++;
  if (life.endOfLife) agg.osEol++;
  if (os && (life.outOfSupport || life.endOfLife)) {
    const c = (agg.os[os] ??= [0, life.eos ?? 0, life.eol ?? 0, life.outOfSupport ? 1 : 0]);
    c[0]++;
  }
}

export function csamPage(json: Row, now: number) {
  const rows: CsamRow[] = [];
  const list: Row[] = json?.assetListData?.asset ?? json?.assetList ?? json?.data ?? [];
  const agg = newCsamAgg();
  for (const a of list) {
    agg.total++;
    const os = csamOsName(a);
    const type = assetType(os);
    agg.byType[type].total++;
    const sensor = a.sensor ?? {};
    const x: CsamSeen = {
      assetId: Number(a.assetId ?? a.id), ip: a.address ?? a.ipAddress ?? null, os, type,
      hasAgent: Boolean(sensor.hasAgent ?? a.agent?.agentId ?? a.agentId),
      hasScanner: Boolean(sensor.hasNetworkScanner ?? sensor.hasScanner),
      life: csamLifecycle(a.operatingSystem ?? {}, now),
    };
    if (isPublicIp(x.ip)) agg.publicIp++;
    if (x.hasAgent) countCsamAgent(agg, a, x, now);
    if (!x.hasAgent && !x.hasScanner) countUnmanaged(agg, a, x, now);
    countLifecycle(agg, os, x.life);
    if (Number.isFinite(x.assetId)) rows.push(csamRow(a, x));
  }
  agg.recentUnmanaged.sort((p, q) => String(q.created).localeCompare(String(p.created)));
  agg.recentUnmanaged = agg.recentUnmanaged.slice(0, TOP);
  const hasMore = json?.hasMore === 1 || json?.hasMore === true || json?.hasMore === "1";
  return { agg, rows, next: hasMore ? String(json?.lastSeenAssetId ?? "") || null : null };
}

// ---------------------------------------------------------------------------
// WAS (applications web) : vulnérabilités par application, catégories OWASP, MTTR applicatif
// ---------------------------------------------------------------------------

/** Vulnérabilité applicative (table qualys_was_findings). */
export interface WasFindingRow {
  finding_id: number; app_id: number | null; app_name: string | null; qid: number | null; title: string | null; severity: number | null;
  status: string | null; owasp: string | null; url: string | null; first_detected: string | null; last_detected: string | null;
  last_tested: string | null; fixed_date: string | null; times_detected: number | null; potential: boolean; ignored: boolean; overdue: boolean;
  attrs: Record<string, string>;
}

/** Application -> [nom, ouvertes sév. 5, ouvertes sév. 4, ouvertes sév. 3, hors délai]. */
type WasApp = [string, number, number, number, number];
/** Ce qui est déjà lu d'une vulnérabilité applicative. */
interface WasSeen { sev: number; status: string; app: string; appId: string; appName: string; first: number; late: boolean }

const numOrNull = (x: string | null) => (x !== null && Number.isFinite(Number(x)) ? Number(x) : null);
const WAS_ATTR_SKIP = ["resultList", "webApp", "history", "request", "response", "payloads"];

function wasRow(f: string, fid: number, x: WasSeen): WasFindingRow {
  return {
    finding_id: fid, app_id: numOrNull(tag(x.app, "id")), app_name: x.appName, qid: numOrNull(tag(f, "qid")), title: tag(f, "name"), severity: numOrNull(tag(f, "severity")),
    status: x.status || null, owasp: tag(tag(f, "owasp") ?? "", "name"), url: tag(f, "url"),
    first_detected: isoOrNull(tag(f, "firstDetectedDate")), last_detected: isoOrNull(tag(f, "lastDetectedDate")),
    last_tested: isoOrNull(tag(f, "lastTestedDate")), fixed_date: isoOrNull(tag(f, "fixedDate")), times_detected: numOrNull(tag(f, "timesDetected")),
    potential: /true/i.test(tag(f, "potential") ?? ""), ignored: /true/i.test(tag(f, "isIgnored") ?? ""),
    overdue: x.status !== "FIXED" && x.sev >= 3 && x.late,
    attrs: leaves(f, WAS_ATTR_SKIP),
  };
}

/** Vulnérabilité corrigée dans la période : délai de correction. */
function countWasFixed(fix: FixStat, f: string, x: WasSeen, since: number) {
  const fixedAt = Date.parse(tag(f, "fixedDate") ?? tag(f, "lastTestedDate") ?? "");
  if (!Number.isFinite(fixedAt) || !Number.isFinite(x.first) || fixedAt < since || !SLA[x.sev]) return;
  const days = Math.max(0, Math.floor((fixedAt - x.first) / DAY));
  fix.n++;
  fix.daysSum += days;
  if (fixedAt <= deadline(x.first, x.sev)) fix.inSla++;
  const k = String(Math.min(days, 365));
  fix.hist[k] = (fix.hist[k] ?? 0) + 1;
}

function countWasOpen(apps: Record<string, WasApp>, x: WasSeen) {
  const a = (apps[x.appId] ??= [x.appName, 0, 0, 0, 0]);
  if (x.sev >= 5) a[1]++;
  else if (x.sev === 4) a[2]++;
  else a[3]++;
  if (x.late) a[4]++;
}

/** Une page de résultats WAS (QPS « search/was/finding », XML). `since` : début de la période des corrigées. */
export function wasPage(xml: string, now: number, since: number) {
  const rows: WasFindingRow[] = [];
  const apps: Record<string, WasApp> = {};
  const fix = emptyFix();
  let open = 0, lastId: string | null = null;
  for (const f of blocks(tag(xml, "data") ?? "", "Finding")) {
    lastId = tag(f, "id") ?? lastId;
    const app = tag(f, "webApp") ?? "";
    const appId = tag(app, "id") ?? "?";
    const sev = Number(tag(f, "severity"));
    const first = Date.parse(tag(f, "firstDetectedDate") ?? "");
    const x: WasSeen = {
      sev, status: (tag(f, "status") ?? "").toUpperCase(), app, appId, appName: tag(app, "name") ?? `Application ${appId}`, first,
      late: Number.isFinite(first) && now > deadline(first, Math.min(5, sev)),
    };
    const fid = Number(tag(f, "id"));
    if (Number.isFinite(fid)) rows.push(wasRow(f, fid, x));
    if (x.status === "FIXED") countWasFixed(fix, f, x, since);
    else if (sev >= 3) {
      open++;
      countWasOpen(apps, x);
    }
  }
  const more = /<hasMoreRecords>\s*true\s*<\/hasMoreRecords>/i.test(xml);
  return { agg: { open, apps, fix }, rows, next: more ? (tag(xml, "lastId") ?? lastId) : null };
}

/** Application web déclarée dans WAS (table qualys_was_apps). */
export interface WasAppRow { app_id: number; name: string | null; url: string | null; tags: string[]; created: string | null; last_scan: string | null; attrs: Record<string, string> }

/** Une page de l'inventaire des applications web (QPS « search/was/webapp »). */
export function wasAppsPage(xml: string): { rows: WasAppRow[]; next: string | null } {
  const rows: WasAppRow[] = [];
  let lastId: string | null = null;
  for (const w of blocks(tag(xml, "data") ?? "", "WebApp")) {
    const id = Number(tag(w, "id"));
    if (!Number.isFinite(id)) continue;
    lastId = String(id);
    rows.push({
      app_id: id, name: tag(w, "name"), url: tag(w, "url"),
      tags: [...blocks(tag(tag(w, "tags") ?? "", "list") ?? "", "Tag")].map((t) => tag(t, "name")).filter((x): x is string => Boolean(x)),
      created: isoOrNull(tag(w, "createdDate")),
      last_scan: isoOrNull(tag(tag(w, "lastScan") ?? "", "launchedDate") ?? tag(w, "lastScanDate")),
      attrs: leaves(w, ["tags", "comments", "authRecords", "uris", "scanners", "config"]),
    });
  }
  const more = /<hasMoreRecords>\s*true\s*<\/hasMoreRecords>/i.test(xml);
  return { rows, next: more ? (tag(xml, "lastId") ?? lastId) : null };
}

// ---------------------------------------------------------------------------
// Photo finale : réunion des pages
// ---------------------------------------------------------------------------

/** Médiane d'une répartition jour -> nombre. */
export function medianOf(hist: Hist): number | null {
  const entries = Object.entries(hist).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
  const n = entries.reduce((t, [, v]) => t + v, 0);
  if (!n) return null;
  let seen = 0;
  for (const [day, v] of entries) {
    seen += v;
    if (seen >= n / 2) return day;
  }
  return entries[entries.length - 1][0];
}

function mergeFix(list: FixStat[]): FixStat {
  const out = emptyFix();
  for (const f of list) {
    if (!f) continue;
    out.n += f.n; out.inSla += f.inSla; out.daysSum += f.daysSum;
    for (const [k, v] of Object.entries(f.hist ?? {})) out.hist[k] = (out.hist[k] ?? 0) + v;
  }
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const fixView = (f: FixStat) => ({
  fixed: f.n, inSla: f.inSla,
  slaRate: f.n ? round1((f.inSla / f.n) * 100) : null,
  mttr: f.n ? round1(f.daysSum / f.n) : null,
  median: medianOf(f.hist),
});

/**
 * Produits en fin de vie, regroupés par titre : Qualys publie parfois plusieurs QID pour le
 * même produit (ex. deux « Microsoft .Net Version 6 »). Une machine pouvant porter les deux,
 * on garde le plus grand nombre d'actifs plutôt que la somme.
 */
function eolProducts(entries: [string, QidStat][], kb: Record<string, [string, number, string]>) {
  const byTitle = new Map<string, { qids: string[]; title: string; os: boolean; severity: number; hosts: number; servers: number }>();
  for (const [qid, q] of entries) {
    const title = (kb[qid]?.[0] ?? "").replace(/^\s*EOL\s*\/\s*Obsolete\s*(Software|Operating System)?\s*:?\s*/i, "") || `QID ${qid}`;
    const key = title.toLowerCase();
    const cur = byTitle.get(key);
    if (!cur) { byTitle.set(key, { qids: [qid], title, os: isEolOs(kb[qid]?.[0]), severity: q[1], hosts: q[0], servers: q[6] ?? 0 }); continue; }
    cur.qids.push(qid);
    cur.severity = Math.max(cur.severity, q[1]);
    cur.hosts = Math.max(cur.hosts, q[0]);
    cur.servers = Math.max(cur.servers, q[6] ?? 0);
  }
  return [...byTitle.values()].sort((a, b) => b.hosts - a.hosts).map((p) => ({ ...p, qid: p.qids.join(", ") }));
}

/** Vulnérabilités (QID) de toutes les pages réunies. */
function mergeQids(detPages: Row[]) {
  const qids = new Map<string, QidStat>();
  for (const p of detPages) {
    for (const [qid, q] of Object.entries(p.qids as Record<string, QidStat>)) {
      const cur = qids.get(qid);
      if (!cur) { qids.set(qid, [...q] as QidStat); continue; }
      cur[0] += q[0]; cur[2] += q[2]; cur[3] = cur[3] && q[3] ? Math.min(cur[3], q[3]) : cur[3] || q[3];
      cur[4] = Math.max(cur[4], q[4]); cur[5] = (cur[5] ?? 0) + (q[5] ?? 0); cur[6] = (cur[6] ?? 0) + (q[6] ?? 0);
    }
  }
  return qids;
}

type Page = { kind: string; agg: Row };
type KbMap = Record<string, [string, number, string]>;
type OsStat = [number, number, number, number];

const sumOf = (list: Row[], f: (x: Row) => number) => list.reduce((t, x) => t + (f(x) || 0), 0);
const aggsOf = (pages: Page[], kind: string) => pages.filter((p) => p.kind === kind).map((p) => p.agg);
const errorOf = (pages: Page[], kind: string): string | null => pages.find((p) => p.kind === kind)?.agg?.message ?? null;
const byAssetType = <T>(f: (t: AssetType) => T) => Object.fromEntries(ASSET_TYPES.map((t) => [t, f(t)])) as Record<AssetType, T>;
const kbOf = (pages: Page[]): KbMap => Object.assign({}, ...aggsOf(pages, "kb"));

/** Couverture des scans (axe 1). */
function coverageOf(hostsPages: Row[]) {
  return {
    total: sumOf(hostsPages, (p) => p.total),
    agent: sumOf(hostsPages, (p) => p.agent),
    scanned: sumOf(hostsPages, (p) => p.scanned),
    neverScanned: sumOf(hostsPages, (p) => p.neverScanned),
    trurisk: {
      critical: sumOf(hostsPages, (p) => p.trurisk?.critical), high: sumOf(hostsPages, (p) => p.trurisk?.high),
      medium: sumOf(hostsPages, (p) => p.trurisk?.medium), low: sumOf(hostsPages, (p) => p.trurisk?.low),
    },
    byType: byAssetType((t) => ({ total: sumOf(hostsPages, (p) => p.byType?.[t]?.total), scanned: sumOf(hostsPages, (p) => p.byType?.[t]?.scanned) })),
    recentDays: RECENT_SCAN_DAYS,
  };
}

function severitiesOf(detPages: Row[]) {
  return SEVERITIES.map((s) => {
    const total = sumOf(detPages, (p) => p.bySev[s]?.total);
    return {
      severity: s,
      slaDays: SLA_DAYS[s],
      slaLabel: SLA[s].label,
      total,
      overdue: sumOf(detPages, (p) => p.bySev[s]?.overdue),
      reopened: sumOf(detPages, (p) => p.bySev[s]?.reopened),
      ages: [0, 1, 2, 3].map((i) => sumOf(detPages, (p) => p.bySev[s]?.ages?.[i])),
      avgAge: total ? Math.round(sumOf(detPages, (p) => p.bySev[s]?.ageSum) / total) : null,
    };
  });
}

/**
 * Vulnérabilités portant un indicateur de la base de connaissances (CISA KEV, ransomware…).
 * Chaque chiffre est donné pour les sévérités 3 à 5, et pour la sévérité 5 seule (sev5),
 * comme les filtres de la console VMDR.
 */
function flaggedOf(qids: Map<string, QidStat>, kb: KbMap, flag: number) {
  let detections = 0, vulns = 0, sev5 = 0, servers = 0;
  for (const [qid, q] of qids) {
    if (!((kb[qid]?.[1] ?? 0) & flag)) continue;
    detections += q[0];
    vulns++;
    if (q[1] === 5) sev5 += q[0];
    servers += q[6] ?? 0;
  }
  return { detections, vulns, sev5, servers };
}

const toFix = (r: FixedRow): FixStat => ({ n: r.n, inSla: r.in_sla, daysSum: Number(r.days_sum), hist: r.hist ?? {} });

/** Chiffres partiels : premier mois des données commencé en cours de mois, ou mois en cours. */
function monthPartial(m: string, firstDay: string | null, now: number): "start" | "current" | null {
  if (firstDay && m === firstDay.slice(0, 7) && !firstDay.endsWith("-01")) return "start";
  if (m === new Date(now).toISOString().slice(0, 7)) return "current";
  return null;
}

/** Corrections mois après mois, sur 12 mois au plus. */
function monthlyFixes(fixedRows: FixedRow[], now: number) {
  const monthStart = new Date(now - 365 * DAY).toISOString().slice(0, 7);
  const monthCells: Record<string, Record<string, [number, number, number]>> = {};
  for (const r of fixedRows) {
    const m = r.day.slice(0, 7);
    if (m < monthStart) continue;
    monthCells[m] ??= {};
    monthCells[m][r.severity] ??= [0, 0, 0];
    const cell = monthCells[m][r.severity];
    cell[0] += r.n; cell[1] += r.in_sla; cell[2] += Number(r.days_sum);
  }
  const firstDay = fixedRows.map((r) => r.day).sort((a, b) => a.localeCompare(b))[0] ?? null;
  return Object.keys(monthCells).sort((a, b) => a.localeCompare(b)).map((m) => {
    const cells = Object.values(monthCells[m]);
    const fixed = cells.reduce((t, c) => t + c[0], 0);
    const inSla = cells.reduce((t, c) => t + c[1], 0);
    const mttrOf = (s: number) => { const c = monthCells[m][s]; return c?.[0] ? round1(c[2] / c[0]) : null; };
    return { month: m, fixed, slaRate: fixed ? round1((inSla / fixed) * 100) : null, mttr5: mttrOf(5), mttr4: mttrOf(4), mttr3: mttrOf(3), partial: monthPartial(m, firstDay, now) };
  });
}

/** Délais de correction réels sur la fenêtre de 90 jours, puis mois après mois. */
function fixedOf(fixedRows: FixedRow[], now: number) {
  const windowStartDay = new Date(now - FIXED_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const inWindow = fixedRows.filter((r) => r.day >= windowStartDay);
  const view = (rows: FixedRow[]) => fixView(mergeFix(rows.map(toFix)));
  return {
    all: view(inWindow),
    bySev: Object.fromEntries(SEVERITIES.map((s) => [s, view(inWindow.filter((r) => r.severity === s))])),
    byType: byAssetType((t) => view(inWindow.filter((r) => r.asset_type === t))),
    monthly: monthlyFixes(fixedRows, now),
  };
}

/** Obsolescence : vulnérabilités « EOL/Obsolete » de la photo (axe 1, d'après VMDR). */
function obsolescenceOf(detPages: Row[], qids: Map<string, QidStat>, kb: KbMap) {
  const eolEntries = [...qids.entries()].filter(([qid]) => isEol(kb[qid]?.[0]));
  const byType = byAssetType((t) => sumOf(detPages, (p) => p.eol?.[t]));
  const products = eolProducts(eolEntries, kb);
  return {
    // Le nombre d'actifs s'appuie sur la liste des produits en fin de vie de la photo précédente
    hostsTracked: detPages.some((p) => p.eol),
    hosts: ASSET_TYPES.reduce((t, k) => t + byType[k], 0),
    byType,
    products: products.length,
    osProducts: products.filter((p) => p.os).length,
    detections: eolEntries.reduce((t, [, q]) => t + q[0], 0),
  };
}

/** Inventaire CSAM (axe 1). */
function inventoryOf(pages: Page[]) {
  const csam = aggsOf(pages, "csam");
  const error = errorOf(pages, "csamerror");
  const osMap = new Map<string, OsStat>();
  for (const p of csam) {
    for (const [os, c] of Object.entries((p.os ?? {}) as Record<string, OsStat>)) {
      const cur = osMap.get(os);
      if (cur) cur[0] += c[0];
      else osMap.set(os, [...c] as OsStat);
    }
  }
  const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
  return {
    collected: csam.length > 0 || Boolean(error),
    error,
    total: sumOf(csam, (p) => p.total),
    withAgent: sumOf(csam, (p) => p.withAgent),
    agentStale: sumOf(csam, (p) => p.agentStale),
    unmanaged: sumOf(csam, (p) => p.unmanaged),
    unmanagedNew: sumOf(csam, (p) => p.unmanagedNew),
    publicIp: sumOf(csam, (p) => p.publicIp),
    byType: byAssetType((t) => ({
      total: sumOf(csam, (p) => p.byType?.[t]?.total), withAgent: sumOf(csam, (p) => p.byType?.[t]?.withAgent), unmanaged: sumOf(csam, (p) => p.byType?.[t]?.unmanaged),
    })),
    osEol: sumOf(csam, (p) => p.osEol),
    osEos: sumOf(csam, (p) => p.osEos),
    osOutdated: [...osMap.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP_OS).map(([os, c]) => ({
      os, assets: c[0], endOfSupport: day(c[1]), endOfLife: day(c[2]),
    })),
    recentUnmanaged: csam.flatMap((p) => p.recentUnmanaged ?? []).sort((a: Row, b: Row) => String(b.created).localeCompare(String(a.created))).slice(0, TOP),
    agentStaleDays: AGENT_STALE_DAYS,
    newDays: NEW_ASSET_DAYS,
  };
}

/** Applications web (WAS, axe 5). */
function webAppsOf(pages: Page[]) {
  const was = aggsOf(pages, "was");
  const error = errorOf(pages, "waserror");
  const appMap = new Map<string, WasApp>();
  for (const p of was) {
    for (const [id, a] of Object.entries((p.apps ?? {}) as Record<string, WasApp>)) {
      const cur = appMap.get(id);
      if (!cur) appMap.set(id, [...a] as WasApp);
      else { cur[1] += a[1]; cur[2] += a[2]; cur[3] += a[3]; cur[4] += a[4]; }
    }
  }
  const weight = (x: { sev5: number; sev4: number; sev3: number }) => x.sev5 * 1000 + x.sev4 * 10 + x.sev3;
  return {
    collected: was.length > 0 || Boolean(error),
    error,
    open: sumOf(was, (p) => p.open),
    apps: [...appMap.entries()].map(([id, a]) => ({ id, name: a[0], sev5: a[1], sev4: a[2], sev3: a[3], overdue: a[4] }))
      .sort((x, y) => weight(y) - weight(x)),
    fixed: fixView(mergeFix(was.map((p) => p.fix))),
  };
}

type PolicyStat = { id: string; title: string; hosts: number; compliantHosts: number; passed: number; failed: number; errors: number };
type ControlStat = { failed: number; passed: number; policies: Set<string> };

const rateOf = (ok: number, ko: number) => (ok + ko ? round1((ok / (ok + ko)) * 100) : null);

/** Résultats par politique et par contrôle des pages de posture retenues. */
function policyStats(posture: Row[], policyTitles: Record<string, string>) {
  const byPolicy = new Map<string, PolicyStat>();
  const controlStats = new Map<string, ControlStat>();
  const glossary: Record<string, [string, string | null]> = {};
  for (const p of posture) {
    const cur: PolicyStat = byPolicy.get(p.policyId) ?? { id: p.policyId, title: policyTitles[p.policyId] ?? `Politique ${p.policyId}`, hosts: 0, compliantHosts: 0, passed: 0, failed: 0, errors: 0 };
    cur.passed += p.passed; cur.failed += p.failed; cur.errors += p.errors;
    byPolicy.set(p.policyId, cur);
    Object.assign(glossary, p.glossary ?? {});
    for (const [cid, c] of Object.entries((p.controls ?? {}) as Record<string, [number, number, number]>)) {
      const st = controlStats.get(cid) ?? { failed: 0, passed: 0, policies: new Set<string>() };
      st.passed += c[0]; st.failed += c[1];
      if (c[1]) st.policies.add(p.policyId);
      controlStats.set(cid, st);
    }
  }
  // Actifs distincts par politique (un actif peut être réparti sur plusieurs pages)
  for (const [id, cur] of byPolicy) {
    const m = mergePosture(posture.filter((p) => p.policyId === id));
    if (m) { cur.hosts = m.hosts; cur.compliantHosts = m.compliantHosts; }
  }
  return { byPolicy, controlStats, glossary };
}

/** Politiques non réévaluées cette nuit : dernier résultat connu, avec sa date. */
function carriedPolicies(previous: Row[], freshIds: Set<string>, pcMeta: Row | null, policyTitles: Record<string, string>) {
  if (pcMeta && !((pcMeta.total ?? 0) > 0)) return [];
  return previous.filter((p) => p && !freshIds.has(p.id)).map((p) => ({
    id: String(p.id), title: policyTitles[p.id] ?? String(p.title ?? `Politique ${p.id}`),
    hosts: Number(p.hosts) || 0, compliantHosts: Number(p.compliantHosts) || 0,
    passed: Number(p.passed) || 0, failed: Number(p.failed) || 0, errors: Number(p.errors) || 0,
    rate: typeof p.rate === "number" ? p.rate : null, evaluatedAt: (p.evaluatedAt as string | undefined) ?? null, stale: true,
  }));
}

/** Contrôle de lecture de la nuit (toutes pages lues, politiques terminées ou non). */
function postureRead(pages: Page[]) {
  const all = aggsOf(pages, "posture");
  const ids = [...new Set(all.map((a) => a.policyId))];
  const total = (k: string) => all.reduce((t, a) => t + (Number(a[k]) || 0), 0);
  return {
    pages: all.length,
    policies: ids.length,
    emptyPolicies: ids.filter((id) => all.filter((a) => a.policyId === id).every((a) => !Number(a.raw) && !Number(a.records))).length,
    records: total("records"),
    raw: total("raw"),
    hosts: total("hosts"),
    root: (all.find((a) => a.root)?.root as string | undefined) ?? null,
  };
}

/** Conformité (Policy Audit, axe 4). */
function complianceOf(pages: Page[], now: number, previousPolicies: Row[]) {
  // Seules les politiques entièrement lues comptent (la lecture a pu être interrompue)
  const pcMeta: Row | null = pages.find((p) => p.kind === "pcmeta")?.agg ?? null;
  const doneSet = pcMeta ? new Set<string>(pcMeta.done ?? []) : null;
  const posture = aggsOf(pages, "posture").filter((a) => !doneSet || doneSet.has(a.policyId));
  const policyTitles: Record<string, string> = Object.assign({}, ...aggsOf(pages, "policies").map((a) => Object.fromEntries((a.list ?? []).map((x: Row) => [x.id, x.title]))));
  const pcError = errorOf(pages, "pcerror");
  const { byPolicy, controlStats, glossary } = policyStats(posture, policyTitles);
  const evaluatedAt = new Date(now).toISOString();
  const fresh = [...byPolicy.values()].filter((p) => p.passed + p.failed > 0)
    .map((p) => ({ ...p, rate: rateOf(p.passed, p.failed), evaluatedAt: evaluatedAt as string | null, stale: false }));
  const carried = carriedPolicies(previousPolicies, new Set(fresh.map((p) => p.id)), pcMeta, policyTitles);
  const policies = [...fresh, ...carried].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
  const allPassed = policies.reduce((t, p) => t + p.passed, 0), allFailed = policies.reduce((t, p) => t + p.failed, 0);
  return {
    collected: pages.some((p) => p.kind === "policies") || Boolean(pcError),
    error: pcError,
    /** Politiques évaluées cette nuit / au total ; lecture interrompue (budget de temps) ? */
    evaluated: fresh.length,
    total: pcMeta?.total ?? fresh.length,
    stopped: Boolean(pcMeta?.stopped),
    rate: rateOf(allPassed, allFailed),
    passed: allPassed, failed: allFailed,
    read: postureRead(pages),
    policies,
    topFailed: [...controlStats.entries()].filter(([, c]) => c.failed > 0).sort((a, b) => b[1].failed - a[1].failed).slice(0, 5)
      .map(([cid, c]) => ({ cid, statement: glossary[cid]?.[0] || `Contrôle ${cid}`, criticality: glossary[cid]?.[1] ?? null, failed: c.failed, rate: rateOf(c.passed, c.failed), policies: c.policies.size })),
  };
}

export function buildResults(pages: Page[], now: number, opts: { previousPolicies?: Row[]; fixedDaily?: FixedRow[] } = {}) {
  const hostsPages = aggsOf(pages, "hosts");
  const detPages = aggsOf(pages, "detections");
  const kb = kbOf(pages);
  const severities = severitiesOf(detPages);
  const qids = mergeQids(detPages);
  const truriskCount = sumOf(hostsPages, (p) => p.truriskCount);
  // Délais de correction réels : cumul jour par jour (table qualys_fixed_daily), ou pages de la photo
  const fixedRows = opts.fixedDaily ?? fixedRowsOfPages(pages);
  const exposedByType = byAssetType((t) => sumOf(hostsPages, (p) => p.byType?.[t]?.publicIp));
  const total = severities.reduce((t, s) => t + s.total, 0);
  const reopened = severities.reduce((t, s) => t + s.reopened, 0);
  return {
    generatedAt: new Date(now).toISOString(),
    coverage: coverageOf(hostsPages),
    hostsWithVulns: sumOf(detPages, (p) => p.hostsWithVulns),
    detections: { total, potential: sumOf(detPages, (p) => p.potential), qdsCritical: sumOf(detPages, (p) => p.qdsCritical), vulns: qids.size },
    severities,
    kev: flaggedOf(qids, kb, KB_FLAGS.kev),
    ransomware: flaggedOf(qids, kb, KB_FLAGS.ransomware),
    activeAttacks: flaggedOf(qids, kb, KB_FLAGS.activeAttacks),
    // Axe 2 : exposition aux menaces
    exposure: {
      truriskAvg: truriskCount ? Math.round(sumOf(hostsPages, (p) => p.truriskSum) / truriskCount) : null,
      truriskAssets: truriskCount,
      armed: { ...flaggedOf(qids, kb, ARMED), exploitPublic: flaggedOf(qids, kb, KB_FLAGS.exploitPublic).detections },
    },
    // Axe 3 : efficacité opérationnelle
    operations: {
      windowDays: FIXED_WINDOW_DAYS,
      fixed: fixedOf(fixedRows, now),
      open: {
        byType: byAssetType((t) => ({
          total: sumOf(detPages, (p) => p.byType?.[t]?.total), overdue: sumOf(detPages, (p) => p.byType?.[t]?.overdue), sev5: sumOf(detPages, (p) => p.byType?.[t]?.sev5),
        })),
      },
      reopenRate: total ? round1((reopened / total) * 100) : null,
      ignored: {
        total: sumOf(detPages, (p) => p.ignored?.total),
        sev5: sumOf(detPages, (p) => p.ignored?.sev5),
        ages: [0, 1, 2, 3].map((i) => sumOf(detPages, (p) => p.ignored?.ages?.[i])),
      },
      fixedCollected: fixedRows.length > 0 || pages.some((p) => p.kind === "fixed"),
      /** Lecture des corrigées en échec cette nuit (indicateurs sur l'historique déjà en base). */
      fixedError: errorOf(pages, "fixederror"),
    },
    // Axe 1 (en partie) : obsolescence, d'après VMDR
    obsolescence: obsolescenceOf(detPages, qids, kb),
    // Axe 4 : conformité et durcissement (Policy Audit)
    compliance: complianceOf(pages, now, opts.previousPolicies ?? []),
    // Axe 1 : inventaire (CSAM) et exposition Internet
    inventory: inventoryOf(pages),
    internetExposed: { total: ASSET_TYPES.reduce((t, k) => t + exposedByType[k], 0), byType: exposedByType },
    // Axe 5 : sécurité applicative (WAS)
    webApps: webAppsOf(pages),
  };
}

/** Index des vulnérabilités ouvertes de la photo, pour la recherche d'exposition (une ligne par QID). */
export function vulnIndex(pages: Page[]) {
  const qids = mergeQids(aggsOf(pages, "detections"));
  const kb = kbOf(pages);
  return [...qids.entries()].map(([qid, q]) => ({
    qid: Number(qid), severity: q[1], hosts: q[0], servers: q[6] ?? 0, overdue: q[2],
    first_found: q[3] ? new Date(q[3]).toISOString() : null,
    title: kb[qid]?.[0] || null, cves: kb[qid]?.[2] || null, flags: kb[qid]?.[1] ?? 0,
  }));
}

/** Chiffres clés gardés pour l'évolution dans le temps. */
export function summaryOf(r: ReturnType<typeof buildResults>) {
  const sev = (s: number) => r.severities.find((x) => x.severity === s);
  return {
    detections: r.detections.total,
    sev5: sev(5)?.total ?? 0,
    sev4: sev(4)?.total ?? 0,
    sev3: sev(3)?.total ?? 0,
    overdue: r.severities.reduce((t, s) => t + s.overdue, 0),
    kev: r.kev.detections,
    ransomware: r.ransomware.detections,
    qdsCritical: r.detections.qdsCritical,
    coverage: r.coverage.total ? Math.round((r.coverage.scanned / r.coverage.total) * 1000) / 10 : null,
    truriskAvg: r.exposure.truriskAvg,
    armed: r.exposure.armed.detections,
    slaRate: r.operations.fixedCollected ? r.operations.fixed.all.slaRate : null,
    mttr5: r.operations.fixedCollected ? r.operations.fixed.bySev[5]?.mttr ?? null : null,
    ignored: r.operations.ignored.total,
    eolHosts: r.obsolescence.hostsTracked ? r.obsolescence.hosts : null,
    complianceRate: r.compliance.rate,
    unmanaged: r.inventory.collected && !r.inventory.error ? r.inventory.unmanaged : null,
    webAppsCritical: r.webApps.collected && !r.webApps.error ? r.webApps.apps.reduce((t, a) => t + a.sev5, 0) : null,
  };
}
