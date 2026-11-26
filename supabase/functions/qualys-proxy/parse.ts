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
  if (/server|linux|unix|ubuntu|debian|red ?hat|rhel|centos|rocky|alma|suse|oracle|aix|solaris|hp-?ux|esxi?|vmware|freebsd/.test(s)) return "server";
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

/** Liste des actifs : couverture des scans, score TruRisk, fiches des actifs. */
export function hostsPage(xml: string, now: number) {
  const rows: AssetRow[] = [];
  const agg = { total: 0, agent: 0, scanned: 0, neverScanned: 0 };
  const tr = { critical: 0, high: 0, medium: 0, low: 0 };
  let truriskSum = 0, truriskCount = 0;
  const byType = emptyByType(() => ({ total: 0, scanned: 0, publicIp: 0 }));
  /** Identifiants des actifs : pour partager la lecture des vulnérabilités entre deux appels simultanés. */
  const ids: number[] = [];
  for (const h of blocks(xml, "HOST")) {
    agg.total++;
    const hid = Number(tag(h, "ID"));
    if (Number.isFinite(hid)) ids.push(hid);
    const os = tag(h, "OS");
    const type = assetType(os);
    byType[type].total++;
    if (isPublicIp(tag(h, "IP"))) byType[type].publicIp++;
    if (/agent/i.test(tag(h, "TRACKING_METHOD") ?? "")) agg.agent++;
    const last = tag(h, "LAST_VULN_SCAN_DATETIME") ?? tag(h, "LAST_VM_SCANNED_DATE");
    const age = daysSince(last, now);
    if (age === null) agg.neverScanned++;
    else if (age <= RECENT_SCAN_DAYS) { agg.scanned++; byType[type].scanned++; }
    const raw = tag(h, "TRURISK_SCORE");
    const score = Number(raw);
    if (raw !== null && Number.isFinite(score)) {
      truriskSum += score;
      truriskCount++;
      // Répartition TruRisk (0-1000) : on ne garde que les tranches
      if (score >= 850) tr.critical++; else if (score >= 700) tr.high++; else if (score >= 500) tr.medium++; else tr.low++;
    }
    const acs = Number(tag(h, "ASSET_CRITICALITY_SCORE"));
    if (Number.isFinite(hid)) {
      const assetId = Number(tag(h, "ASSET_ID"));
      rows.push({
        host_id: hid, asset_id: Number.isFinite(assetId) && assetId > 0 ? assetId : null,
        name: tag(h, "DNS") || tag(h, "NETBIOS") || null, netbios: tag(h, "NETBIOS"), ip: tag(h, "IP"), os, asset_type: type,
        tracking: tag(h, "TRACKING_METHOD"), trurisk: raw !== null && Number.isFinite(score) ? score : null,
        criticality: Number.isFinite(acs) && acs > 0 ? acs : null,
        last_scan: isoOrNull(last), last_activity: isoOrNull(tag(h, "LAST_ACTIVITY") ?? tag(h, "LAST_BOOT")),
        public_ip: isPublicIp(tag(h, "IP")),
        tags: [...blocks(tag(h, "TAGS") ?? "", "TAG")].map((t) => tag(t, "NAME")).filter((x): x is string => Boolean(x)),
        attrs: leaves(h, ["TAGS", "DNS_DATA", "CLOUD_PROVIDER_TAGS", "METADATA", "ASSET_GROUP_IDS"]),
      });
    }
  }
  return { ...agg, trurisk: tr, truriskSum, truriskCount, byType, ids, rows };
}

/** QID -> [détections, sévérité, hors délai, plus ancienne détection (ms, 0 si inconnue), QDS max, détections QDS >= 90, détections sur serveurs]. */
type QidStat = [number, number, number, number, number, number, number];

/** Vulnérabilités ouvertes d'une page d'actifs. `watch` : actifs suivis de près (les plus risqués). */
/**
 * Vulnérabilités d'un actif (table qualys_asset_vulns). `detections` : une ligne par détection,
 * [QID, sévérité, 1re détection (AAAA-MM-JJ), dernière détection, statut (N nouvelle, A active, R réouverte),
 *  QDS, dérogation (1/0), hors délai (1/0), port].
 */
export interface AssetVulnRow {
  host_id: number; d5: number; d4: number; d3: number; overdue: number; ignored: number; reopened: number; qds_max: number;
  qids: number[]; detections: (string | number | null)[][];
}

export function detectionsPage(xml: string, now: number, eolQids: readonly string[] = []) {
  const rows: AssetVulnRow[] = [];
  const bySev: Record<string, { total: number; overdue: number; ages: number[]; reopened: number; ageSum: number }> = {};
  for (const s of SEVERITIES) bySev[s] = { total: 0, overdue: 0, ages: [0, 0, 0, 0], reopened: 0, ageSum: 0 };
  const byType = emptyByType(() => ({ total: 0, overdue: 0, sev5: 0 }));
  const ignored = { total: 0, sev5: 0, ages: [0, 0, 0, 0] };
  const qids: Record<string, QidStat> = {};
  const eolSet = new Set(eolQids);
  /** Actifs portant au moins un système ou logiciel en fin de vie (EOL/Obsolete). */
  const eol = emptyByType(() => 0);
  let hostCount = 0, hostsWithVulns = 0, qdsCritical = 0, potential = 0;
  const ageBucket = (age: number) => { const i = AGE_LIMITS.findIndex((l) => age < l); return i === -1 ? AGE_LIMITS.length : i; };

  for (const h of blocks(xml, "HOST")) {
    hostCount++;
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const id = tag(head, "ID");
    const os = tag(head, "OS");
    const type = assetType(os);
    let hasEol = false;
    const row: AssetVulnRow = { host_id: Number(id), d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0, qds_max: 0, qids: [], detections: [] };
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      const stat = bySev[sev];
      if (!stat) continue;
      if (tag(d, "IS_DISABLED") === "1") continue;
      const first = tag(d, "FIRST_FOUND_DATETIME");
      const age = daysSince(first, now) ?? 0;
      const qidNum = Number(tag(d, "QID"));
      const day = (v: string | null) => (v ? v.slice(0, 10) : null);
      const portRaw = tag(d, "PORT");
      const detRow = (st: string, qds: number, ign: number, late: number) =>
        row.detections.push([qidNum, sev, day(first), day(tag(d, "LAST_FOUND_DATETIME")), st, qds, ign, late, portRaw ? Number(portRaw) : null]);
      // Dérogations : vulnérabilités ignorées dans la console (risque accepté), comptées à part
      if (tag(d, "IS_IGNORED") === "1") {
        row.ignored++;
        detRow("I", Number(tag(d, "QDS") ?? 0) || 0, 1, 0);
        ignored.total++;
        if (sev === 5) ignored.sev5++;
        ignored.ages[ageBucket(age)]++;
        continue;
      }
      if (/potential/i.test(tag(d, "TYPE") ?? "")) potential++;
      const status = tag(d, "STATUS") ?? "";
      const late = first ? now > deadline(Date.parse(first), sev) : false;
      const qds = Number(tag(d, "QDS") ?? 0) || 0;
      const st = /re-?opened/i.test(status) ? "R" : /new/i.test(status) ? "N" : "A";
      detRow(st, qds, 0, late ? 1 : 0);
      if (Number.isFinite(qidNum)) row.qids.push(qidNum);
      if (sev === 5) row.d5++; else if (sev === 4) row.d4++; else row.d3++;
      if (late) row.overdue++;
      if (st === "R") row.reopened++;
      row.qds_max = Math.max(row.qds_max, qds);
      stat.total++;
      stat.ageSum += age;
      if (late) stat.overdue++;
      if (/re-?opened/i.test(status)) stat.reopened++;
      stat.ages[ageBucket(age)]++;
      byType[type].total++;
      if (late) byType[type].overdue++;
      if (sev === 5) byType[type].sev5++;
      if (qds >= 90) qdsCritical++;
      const qid = tag(d, "QID");
      if (qid && eolSet.has(qid)) hasEol = true;
      if (qid) {
        const q = qids[qid] ?? (qids[qid] = [0, sev, 0, 0, 0, 0, 0]);
        q[0]++;
        if (late) q[2]++;
        if (first) q[3] = q[3] ? Math.min(q[3], Date.parse(first)) : Date.parse(first);
        q[4] = Math.max(q[4], qds);
        if (qds >= 90) q[5]++;
        if (type === "server") q[6]++;
      }
    }
    if (hasEol) eol[type]++;
    if (Number.isFinite(row.host_id) && row.detections.length) rows.push(row);
    if (row.d5 + row.d4 + row.d3 > 0) hostsWithVulns++;
  }
  return { hosts: hostCount, hostsWithVulns, bySev, byType, ignored, eol, qdsCritical, potential, qids, rows };
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
  (html ?? "").replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n(?:[ \t]*\n)+/g, "\n").trim().slice(0, max) || null;

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

/** Une page d'actifs CSAM. */
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

export function csamPage(json: Row, now: number) {
  const rows: CsamRow[] = [];
  const list: Row[] = json?.assetListData?.asset ?? json?.assetList ?? json?.data ?? [];
  const agg = {
    total: 0, withAgent: 0, agentStale: 0, unmanaged: 0, unmanagedNew: 0, publicIp: 0,
    byType: emptyByType(() => ({ total: 0, withAgent: 0, unmanaged: 0 })),
    /** Système -> [actifs, fin de support (ms) ou 0, fin de vie (ms) ou 0, en fin de support ? 1 : 0]. */
    os: {} as Record<string, [number, number, number, number]>,
    osEol: 0, osEos: 0,
    recentUnmanaged: [] as CsamAsset[],
  };
  for (const a of list) {
    agg.total++;
    const osObj = a.operatingSystem ?? {};
    const os: string | null = osObj.osName ?? osObj.fullName ?? osObj.name ?? (typeof a.operatingSystem === "string" ? a.operatingSystem : null);
    const type = assetType(os);
    agg.byType[type].total++;
    const sensor = a.sensor ?? {};
    const hasAgent = Boolean(sensor.hasAgent ?? a.agent?.agentId ?? a.agentId);
    const hasScanner = Boolean(sensor.hasNetworkScanner ?? sensor.hasScanner);
    const ip: string | null = a.address ?? a.ipAddress ?? null;
    if (isPublicIp(ip)) agg.publicIp++;
    if (hasAgent) {
      agg.withAgent++;
      agg.byType[type].withAgent++;
      const last = dateMs(a.agent?.lastCheckedIn ?? a.agent?.lastActivity ?? a.agent?.lastCheckIn ?? sensor.lastAgentCheckIn);
      if (last !== null && now - last > AGENT_STALE_DAYS * DAY) agg.agentStale++;
    }
    // Shadow IT : actif découvert (capteur passif, découverte réseau…) sans agent ni scan authentifié
    if (!hasAgent && !hasScanner) {
      agg.unmanaged++;
      agg.byType[type].unmanaged++;
      const created = dateMs(a.inventory?.created ?? a.createdDate ?? a.firstSeen);
      if (created !== null && now - created <= NEW_ASSET_DAYS * DAY) {
        agg.unmanagedNew++;
        agg.recentUnmanaged.push({
          id: String(a.assetId ?? a.id ?? ""), name: a.assetName ?? a.name ?? null, ip, os,
          source: a.inventory?.source ?? null, created: new Date(created).toISOString(),
        });
      }
    }
    // Cycle de vie du système d'exploitation
    const lc = osObj.lifecycle ?? osObj.lifeCycle ?? {};
    const eos = dateMs(lc.eosDate ?? lc.endOfSupport);
    const eol = dateMs(lc.eolDate ?? lc.endOfLife);
    const stage = String(lc.stage ?? "");
    const outOfSupport = (eos !== null && eos < now) || /EOS|end of support/i.test(stage);
    const endOfLife = (eol !== null && eol < now) || /EOL|end of life/i.test(stage);
    if (outOfSupport) agg.osEos++;
    if (endOfLife) agg.osEol++;
    if (os && (outOfSupport || endOfLife)) {
      const c = (agg.os[os] ??= [0, eos ?? 0, eol ?? 0, outOfSupport ? 1 : 0]);
      c[0]++;
    }
    const assetId = Number(a.assetId ?? a.id);
    if (Number.isFinite(assetId)) {
      const hw = a.hardware ?? {};
      const crit = Number(a.criticality?.score ?? a.criticalityScore);
      rows.push({
        asset_id: assetId, host_id: Number.isFinite(Number(a.hostId)) && Number(a.hostId) > 0 ? Number(a.hostId) : null,
        name: a.assetName ?? a.name ?? null, ip, os, asset_type: type, has_agent: hasAgent, has_scanner: hasScanner,
        agent_last_checkin: isoOrNull(a.agent?.lastCheckedIn?.dateTime ?? a.agent?.lastCheckedIn ?? a.agent?.lastActivity ?? sensor.lastAgentCheckIn),
        lifecycle_stage: stage || null, eos: eos !== null ? new Date(eos).toISOString() : null, eol: eol !== null ? new Date(eol).toISOString() : null,
        created: isoOrNull(a.inventory?.created ?? a.createdDate ?? a.firstSeen),
        last_seen: isoOrNull(a.inventory?.lastUpdated ?? a.lastModifiedDate ?? a.lastSeen ?? sensor.lastFullScan),
        sources: String(a.inventory?.source ?? a.sources ?? "") || null,
        hardware: [hw.category?.category ?? hw.category1 ?? hw.category, hw.manufacturer, hw.model].filter((x) => typeof x === "string" && x).join(" · ") || null,
        criticality: Number.isFinite(crit) && crit > 0 ? crit : null,
        tags: ((a.tagList?.tag ?? a.tags ?? []) as Row[]).map((t) => String(t?.tagName ?? t?.name ?? "")).filter(Boolean).slice(0, 50),
        attrs: trimJson(a) as Row,
      });
    }
  }
  agg.recentUnmanaged.sort((x, y) => String(y.created).localeCompare(String(x.created)));
  agg.recentUnmanaged = agg.recentUnmanaged.slice(0, TOP);
  const hasMore = json?.hasMore === 1 || json?.hasMore === true || json?.hasMore === "1";
  return { agg, rows, next: hasMore ? String(json?.lastSeenAssetId ?? "") || null : null };
}

// ---------------------------------------------------------------------------
// WAS (applications web) : vulnérabilités par application, catégories OWASP, MTTR applicatif
// ---------------------------------------------------------------------------

/** Une page de résultats WAS (QPS « search/was/finding », XML). `since` : début de la période des corrigées. */
/** Vulnérabilité applicative (table qualys_was_findings). */
export interface WasFindingRow {
  finding_id: number; app_id: number | null; app_name: string | null; qid: number | null; title: string | null; severity: number | null;
  status: string | null; owasp: string | null; url: string | null; first_detected: string | null; last_detected: string | null;
  last_tested: string | null; fixed_date: string | null; times_detected: number | null; potential: boolean; ignored: boolean; overdue: boolean;
  attrs: Record<string, string>;
}

export function wasPage(xml: string, now: number, since: number) {
  const rows: WasFindingRow[] = [];
  /** Application -> [nom, ouvertes sév. 5, ouvertes sév. 4, ouvertes sév. 3, hors délai]. */
  const apps: Record<string, [string, number, number, number, number]> = {};
  const fix = emptyFix();
  let open = 0, lastId: string | null = null;
  for (const f of blocks(tag(xml, "data") ?? "", "Finding")) {
    lastId = tag(f, "id") ?? lastId;
    const sev = Number(tag(f, "severity"));
    const status = (tag(f, "status") ?? "").toUpperCase();
    const app = tag(f, "webApp") ?? "";
    const appId = tag(app, "id") ?? "?";
    const appName = tag(app, "name") ?? `Application ${appId}`;
    const first = Date.parse(tag(f, "firstDetectedDate") ?? "");
    const fid = Number(tag(f, "id"));
    if (Number.isFinite(fid)) {
      const n = (x: string | null) => (x !== null && Number.isFinite(Number(x)) ? Number(x) : null);
      rows.push({
        finding_id: fid, app_id: n(tag(app, "id")), app_name: appName, qid: n(tag(f, "qid")), title: tag(f, "name"), severity: n(tag(f, "severity")),
        status: status || null, owasp: tag(tag(f, "owasp") ?? "", "name"), url: tag(f, "url"),
        first_detected: isoOrNull(tag(f, "firstDetectedDate")), last_detected: isoOrNull(tag(f, "lastDetectedDate")),
        last_tested: isoOrNull(tag(f, "lastTestedDate")), fixed_date: isoOrNull(tag(f, "fixedDate")), times_detected: n(tag(f, "timesDetected")),
        potential: /true/i.test(tag(f, "potential") ?? ""), ignored: /true/i.test(tag(f, "isIgnored") ?? ""),
        overdue: status !== "FIXED" && sev >= 3 && Number.isFinite(first) && now > deadline(first, Math.min(5, sev)),
        attrs: leaves(f, ["resultList", "webApp", "history", "request", "response", "payloads"]),
      });
    }
    if (status === "FIXED") {
      const fixedAt = Date.parse(tag(f, "fixedDate") ?? tag(f, "lastTestedDate") ?? "");
      if (!Number.isFinite(fixedAt) || !Number.isFinite(first) || fixedAt < since || !SLA[sev]) continue;
      const days = Math.max(0, Math.floor((fixedAt - first) / DAY));
      fix.n++; fix.daysSum += days;
      if (fixedAt <= deadline(first, sev)) fix.inSla++;
      const k = String(Math.min(days, 365)); fix.hist[k] = (fix.hist[k] ?? 0) + 1;
      continue;
    }
    if (sev < 3) continue;
    open++;
    const a = (apps[appId] ??= [appName, 0, 0, 0, 0]);
    if (sev >= 5) a[1]++; else if (sev === 4) a[2]++; else a[3]++;
    if (Number.isFinite(first) && now > deadline(first, Math.min(5, sev))) a[4]++;
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

export function buildResults(pages: { kind: string; agg: Row }[], now: number, opts: { previousPolicies?: Row[]; fixedDaily?: FixedRow[] } = {}) {
  const hostsPages = pages.filter((p) => p.kind === "hosts").map((p) => p.agg);
  const detPages = pages.filter((p) => p.kind === "detections").map((p) => p.agg);
  const fixPages = pages.filter((p) => p.kind === "fixed").map((p) => p.agg);
  const kb: Record<string, [string, number, string]> = Object.assign({}, ...pages.filter((p) => p.kind === "kb").map((p) => p.agg));
  const flagsOf = (qid: string) => kb[qid]?.[1] ?? 0;

  const sum = (list: Row[], f: (x: Row) => number) => list.reduce((t, x) => t + (f(x) || 0), 0);
  const coverage = {
    total: sum(hostsPages, (p) => p.total),
    agent: sum(hostsPages, (p) => p.agent),
    scanned: sum(hostsPages, (p) => p.scanned),
    neverScanned: sum(hostsPages, (p) => p.neverScanned),
    trurisk: { critical: sum(hostsPages, (p) => p.trurisk?.critical), high: sum(hostsPages, (p) => p.trurisk?.high), medium: sum(hostsPages, (p) => p.trurisk?.medium), low: sum(hostsPages, (p) => p.trurisk?.low) },
    byType: Object.fromEntries(ASSET_TYPES.map((t) => [t, { total: sum(hostsPages, (p) => p.byType?.[t]?.total), scanned: sum(hostsPages, (p) => p.byType?.[t]?.scanned) }])),
    recentDays: RECENT_SCAN_DAYS,
  };

  const severities = SEVERITIES.map((s) => {
    const total = sum(detPages, (p) => p.bySev[s]?.total);
    return {
      severity: s,
      slaDays: SLA_DAYS[s],
      slaLabel: SLA[s].label,
      total,
      overdue: sum(detPages, (p) => p.bySev[s]?.overdue),
      reopened: sum(detPages, (p) => p.bySev[s]?.reopened),
      ages: [0, 1, 2, 3].map((i) => sum(detPages, (p) => p.bySev[s]?.ages?.[i])),
      avgAge: total ? Math.round(sum(detPages, (p) => p.bySev[s]?.ageSum) / total) : null,
    };
  });

  const qids = mergeQids(detPages);
  // Chaque chiffre est donné pour les sévérités 3 à 5, et pour la sévérité 5 seule
  // (sev5), comme les filtres de la console VMDR
  const flagged = (flag: number) => {
    let detections = 0, vulns = 0, sev5 = 0, servers = 0;
    for (const [qid, q] of qids) {
      if (!(flagsOf(qid) & flag)) continue;
      detections += q[0];
      vulns++;
      if (q[1] === 5) sev5 += q[0];
      servers += q[6] ?? 0;
    }
    return { detections, vulns, sev5, servers };
  };
  const truriskCount = sum(hostsPages, (p) => p.truriskCount);

  // Délais de correction réels : cumul jour par jour (table qualys_fixed_daily), ou pages de la photo
  const fixedRows = opts.fixedDaily ?? fixedRowsOfPages(pages);
  const toFix = (r: FixedRow): FixStat => ({ n: r.n, inSla: r.in_sla, daysSum: Number(r.days_sum), hist: r.hist ?? {} });
  const windowStartDay = new Date(now - FIXED_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const inWindow = fixedRows.filter((r) => r.day >= windowStartDay);
  const fixSev = Object.fromEntries(SEVERITIES.map((s) => [s, fixView(mergeFix(inWindow.filter((r) => r.severity === s).map(toFix)))]));
  const fixAll = fixView(mergeFix(inWindow.map(toFix)));
  const fixType = Object.fromEntries(ASSET_TYPES.map((t) => [t, fixView(mergeFix(inWindow.filter((r) => r.asset_type === t).map(toFix)))]));
  // Mois après mois, sur 12 mois au plus
  const monthStart = new Date(now - 365 * DAY).toISOString().slice(0, 7);
  const monthCells: Record<string, Record<string, [number, number, number]>> = {};
  for (const r of fixedRows) {
    const m = r.day.slice(0, 7);
    if (m < monthStart) continue;
    const cell = ((monthCells[m] ??= {})[r.severity] ??= [0, 0, 0]);
    cell[0] += r.n; cell[1] += r.in_sla; cell[2] += Number(r.days_sum);
  }
  const firstDay = fixedRows.map((r) => r.day).sort((a, b) => a.localeCompare(b))[0] ?? null;
  const monthly = Object.keys(monthCells).sort((a, b) => a.localeCompare(b)).map((m) => {
    const cells = Object.values(monthCells[m]);
    const fixed = cells.reduce((t, c) => t + c[0], 0);
    const inSla = cells.reduce((t, c) => t + c[1], 0);
    const mttrOf = (s: number) => { const c = monthCells[m][s]; return c && c[0] ? round1(c[2] / c[0]) : null; };
    // Premier mois des données commencé en cours de mois, mois en cours : chiffres partiels
    const partial = firstDay && m === firstDay.slice(0, 7) && !firstDay.endsWith("-01") ? "start" : m === new Date(now).toISOString().slice(0, 7) ? "current" : null;
    return { month: m, fixed, slaRate: fixed ? round1((inSla / fixed) * 100) : null, mttr5: mttrOf(5), mttr4: mttrOf(4), mttr3: mttrOf(3), partial };
  });

  const byTypeOpen = Object.fromEntries(ASSET_TYPES.map((t) => [t, {
    total: sum(detPages, (p) => p.byType?.[t]?.total), overdue: sum(detPages, (p) => p.byType?.[t]?.overdue), sev5: sum(detPages, (p) => p.byType?.[t]?.sev5),
  }]));
  const ignored = {
    total: sum(detPages, (p) => p.ignored?.total),
    sev5: sum(detPages, (p) => p.ignored?.sev5),
    ages: [0, 1, 2, 3].map((i) => sum(detPages, (p) => p.ignored?.ages?.[i])),
  };

  // Obsolescence : vulnérabilités « EOL/Obsolete » de la photo
  const eolEntries = [...qids.entries()].filter(([qid]) => isEol(kb[qid]?.[0]));
  const eolHostsByType = Object.fromEntries(ASSET_TYPES.map((t) => [t, sum(detPages, (p) => p.eol?.[t])])) as Record<AssetType, number>;
  const eolHosts = ASSET_TYPES.reduce((t, k) => t + eolHostsByType[k], 0);
  const obsolescence = {
    // Le nombre d'actifs s'appuie sur la liste des produits en fin de vie de la photo précédente
    hostsTracked: detPages.some((p) => p.eol),
    hosts: eolHosts,
    byType: eolHostsByType,
    products: eolProducts(eolEntries, kb).length,
    osProducts: eolProducts(eolEntries, kb).filter((p) => p.os).length,
    detections: eolEntries.reduce((t, [, q]) => t + q[0], 0),
  };

  // Inventaire CSAM (axe 1)
  const csam = pages.filter((p) => p.kind === "csam").map((p) => p.agg);
  const csamError: string | null = pages.find((p) => p.kind === "csamerror")?.agg?.message ?? null;
  const osMap = new Map<string, [number, number, number, number]>();
  for (const p of csam) for (const [os, c] of Object.entries((p.os ?? {}) as Record<string, [number, number, number, number]>)) {
    const cur = osMap.get(os);
    if (!cur) osMap.set(os, [...c] as [number, number, number, number]); else cur[0] += c[0];
  }
  const csamTotal = sum(csam, (p) => p.total);
  const inventory = {
    collected: csam.length > 0 || Boolean(csamError),
    error: csamError,
    total: csamTotal,
    withAgent: sum(csam, (p) => p.withAgent),
    agentStale: sum(csam, (p) => p.agentStale),
    unmanaged: sum(csam, (p) => p.unmanaged),
    unmanagedNew: sum(csam, (p) => p.unmanagedNew),
    publicIp: sum(csam, (p) => p.publicIp),
    byType: Object.fromEntries(ASSET_TYPES.map((t) => [t, {
      total: sum(csam, (p) => p.byType?.[t]?.total), withAgent: sum(csam, (p) => p.byType?.[t]?.withAgent), unmanaged: sum(csam, (p) => p.byType?.[t]?.unmanaged),
    }])),
    osEol: sum(csam, (p) => p.osEol),
    osEos: sum(csam, (p) => p.osEos),
    osOutdated: [...osMap.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP_OS).map(([os, c]) => ({
      os, assets: c[0], endOfSupport: c[1] ? new Date(c[1]).toISOString().slice(0, 10) : null, endOfLife: c[2] ? new Date(c[2]).toISOString().slice(0, 10) : null,
    })),
    recentUnmanaged: csam.flatMap((p) => p.recentUnmanaged ?? []).sort((a: Row, b: Row) => String(b.created).localeCompare(String(a.created))).slice(0, TOP),
    agentStaleDays: AGENT_STALE_DAYS,
    newDays: NEW_ASSET_DAYS,
  };
  const exposedByType = Object.fromEntries(ASSET_TYPES.map((t) => [t, sum(hostsPages, (p) => p.byType?.[t]?.publicIp)])) as Record<AssetType, number>;
  const internetExposed = { total: ASSET_TYPES.reduce((t, k) => t + exposedByType[k], 0), byType: exposedByType };

  // Applications web (WAS, axe 5)
  const was = pages.filter((p) => p.kind === "was").map((p) => p.agg);
  const wasError: string | null = pages.find((p) => p.kind === "waserror")?.agg?.message ?? null;
  const appMap = new Map<string, [string, number, number, number, number]>();
  for (const p of was) {
    for (const [id, a] of Object.entries((p.apps ?? {}) as Record<string, [string, number, number, number, number]>)) {
      const cur = appMap.get(id);
      if (!cur) appMap.set(id, [...a] as [string, number, number, number, number]);
      else { cur[1] += a[1]; cur[2] += a[2]; cur[3] += a[3]; cur[4] += a[4]; }
    }
  }
  const webApps = {
    collected: was.length > 0 || Boolean(wasError),
    error: wasError,
    open: sum(was, (p) => p.open),
    apps: [...appMap.entries()].map(([id, a]) => ({ id, name: a[0], sev5: a[1], sev4: a[2], sev3: a[3], overdue: a[4] }))
      .sort((x, y) => y.sev5 * 1000 + y.sev4 * 10 + y.sev3 - (x.sev5 * 1000 + x.sev4 * 10 + x.sev3)),
    fixed: fixView(mergeFix(was.map((p) => p.fix))),
  };

  // Conformité (Policy Audit)
  // Seules les politiques entièrement lues comptent (la lecture a pu être interrompue)
  const pcMeta: Row | null = pages.find((p) => p.kind === "pcmeta")?.agg ?? null;
  const doneSet = pcMeta ? new Set<string>(pcMeta.done ?? []) : null;
  const posture = pages.filter((p) => p.kind === "posture").map((p) => p.agg).filter((a) => !doneSet || doneSet.has(a.policyId));
  const policyTitles: Record<string, string> = Object.assign({}, ...pages.filter((p) => p.kind === "policies").map((p) => Object.fromEntries((p.agg.list ?? []).map((x: Row) => [x.id, x.title]))));
  const pcError: string | null = pages.find((p) => p.kind === "pcerror")?.agg?.message ?? null;
  type PolicyStat = { id: string; title: string; hosts: number; compliantHosts: number; passed: number; failed: number; errors: number };
  const byPolicy = new Map<string, PolicyStat>();
  const controlStats = new Map<string, { failed: number; passed: number; policies: Set<string> }>();
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
  const rate = (ok: number, ko: number) => (ok + ko ? round1((ok / (ok + ko)) * 100) : null);
  const evaluatedAt = new Date(now).toISOString();
  const fresh = [...byPolicy.values()].filter((p) => p.passed + p.failed > 0)
    .map((p) => ({ ...p, rate: rate(p.passed, p.failed), evaluatedAt: evaluatedAt as string | null, stale: false }));
  // Politiques non réévaluées cette nuit : dernier résultat connu, avec sa date
  const freshIds = new Set(fresh.map((p) => p.id));
  const carried = (opts.previousPolicies ?? []).filter((p) => p && !freshIds.has(p.id) && (!pcMeta || (pcMeta.total ?? 0) > 0))
    .map((p) => ({
      id: String(p.id), title: policyTitles[p.id] ?? String(p.title ?? `Politique ${p.id}`),
      hosts: Number(p.hosts) || 0, compliantHosts: Number(p.compliantHosts) || 0,
      passed: Number(p.passed) || 0, failed: Number(p.failed) || 0, errors: Number(p.errors) || 0,
      rate: typeof p.rate === "number" ? p.rate : null, evaluatedAt: (p.evaluatedAt as string | undefined) ?? null, stale: true,
    }));
  const policies = [...fresh, ...carried].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
  const allPassed = policies.reduce((t, p) => t + p.passed, 0), allFailed = policies.reduce((t, p) => t + p.failed, 0);
  const compliance = {
    collected: pages.some((p) => p.kind === "policies") || Boolean(pcError),
    error: pcError,
    /** Politiques évaluées cette nuit / au total ; lecture interrompue (budget de temps) ? */
    evaluated: fresh.length,
    total: pcMeta?.total ?? fresh.length,
    stopped: Boolean(pcMeta?.stopped),
    rate: rate(allPassed, allFailed),
    passed: allPassed, failed: allFailed,
    /** Contrôle de lecture de la nuit (toutes pages lues, politiques terminées ou non). */
    read: (() => {
      const all = pages.filter((p) => p.kind === "posture").map((p) => p.agg);
      return {
        pages: all.length,
        policies: new Set(all.map((a) => a.policyId)).size,
        emptyPolicies: [...new Set(all.map((a) => a.policyId))].filter((id) => all.filter((a) => a.policyId === id).every((a) => !Number(a.raw) && !Number(a.records))).length,
        records: all.reduce((t, a) => t + (Number(a.records) || 0), 0),
        raw: all.reduce((t, a) => t + (Number(a.raw) || 0), 0),
        hosts: all.reduce((t, a) => t + (Number(a.hosts) || 0), 0),
        root: (all.find((a) => a.root)?.root as string | undefined) ?? null,
      };
    })(),
    policies,
    topFailed: [...controlStats.entries()].filter(([, c]) => c.failed > 0).sort((a, b) => b[1].failed - a[1].failed).slice(0, 5)
      .map(([cid, c]) => ({ cid, statement: glossary[cid]?.[0] || `Contrôle ${cid}`, criticality: glossary[cid]?.[1] ?? null, failed: c.failed, rate: rate(c.passed, c.failed), policies: c.policies.size })),
  };

  const total = severities.reduce((t, s) => t + s.total, 0);
  const reopened = severities.reduce((t, s) => t + s.reopened, 0);
  return {
    generatedAt: new Date(now).toISOString(),
    coverage,
    hostsWithVulns: sum(detPages, (p) => p.hostsWithVulns),
    detections: { total, potential: sum(detPages, (p) => p.potential), qdsCritical: sum(detPages, (p) => p.qdsCritical), vulns: qids.size },
    severities,
    kev: flagged(KB_FLAGS.kev),
    ransomware: flagged(KB_FLAGS.ransomware),
    activeAttacks: flagged(KB_FLAGS.activeAttacks),
    // Axe 2 : exposition aux menaces
    exposure: {
      truriskAvg: truriskCount ? Math.round(sum(hostsPages, (p) => p.truriskSum) / truriskCount) : null,
      truriskAssets: truriskCount,
      armed: { ...flagged(ARMED), exploitPublic: flagged(KB_FLAGS.exploitPublic).detections },
    },
    // Axe 3 : efficacité opérationnelle
    operations: {
      windowDays: FIXED_WINDOW_DAYS,
      fixed: { all: fixAll, bySev: fixSev, byType: fixType, monthly },
      open: { byType: byTypeOpen },
      reopenRate: total ? round1((reopened / total) * 100) : null,
      ignored,
      fixedCollected: fixedRows.length > 0 || fixPages.length > 0,
      /** Lecture des corrigées en échec cette nuit (indicateurs sur l'historique déjà en base). */
      fixedError: (pages.find((p) => p.kind === "fixederror")?.agg?.message as string | undefined) ?? null,
    },
    // Axe 1 (en partie) : obsolescence, d'après VMDR
    obsolescence,
    // Axe 4 : conformité et durcissement (Policy Audit)
    compliance,
    // Axe 1 : inventaire (CSAM) et exposition Internet
    inventory,
    internetExposed,
    // Axe 5 : sécurité applicative (WAS)
    webApps,
  };
}

/** Index des vulnérabilités ouvertes de la photo, pour la recherche d'exposition (une ligne par QID). */
export function vulnIndex(pages: { kind: string; agg: Row }[]) {
  const qids = mergeQids(pages.filter((p) => p.kind === "detections").map((p) => p.agg));
  const kb: Record<string, [string, number, string]> = Object.assign({}, ...pages.filter((p) => p.kind === "kb").map((p) => p.agg));
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
