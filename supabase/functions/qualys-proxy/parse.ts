// Lecture des réponses XML de Qualys et calcul des chiffres de la photo.
// Module sans dépendance : utilisé par qualys-proxy et testé avec Vitest.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const SEVERITIES = [5, 4] as const;
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
export const TOP_RISK = 10;
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

// ---------------------------------------------------------------------------
// Chiffres d'une page
// ---------------------------------------------------------------------------

export interface RiskHost {
  id: string | null; name: string | null; ip: string | null; os: string | null;
  type: AssetType; trurisk: number; criticality: number | null; lastScan: string | null;
}

/** Liste des actifs : couverture des scans, score TruRisk, actifs les plus risqués. */
export function hostsPage(xml: string, now: number) {
  const agg = { total: 0, agent: 0, scanned: 0, neverScanned: 0 };
  const tr = { critical: 0, high: 0, medium: 0, low: 0 };
  let truriskSum = 0, truriskCount = 0;
  const byType = emptyByType(() => ({ total: 0, scanned: 0 }));
  const risk: RiskHost[] = [];
  for (const h of blocks(xml, "HOST")) {
    agg.total++;
    const os = tag(h, "OS");
    const type = assetType(os);
    byType[type].total++;
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
      const acs = Number(tag(h, "ASSET_CRITICALITY_SCORE"));
      risk.push({
        id: tag(h, "ID"), name: tag(h, "DNS") || tag(h, "NETBIOS") || null, ip: tag(h, "IP"), os, type,
        trurisk: score, criticality: Number.isFinite(acs) && acs > 0 ? acs : null, lastScan: last,
      });
    }
  }
  risk.sort((a, b) => b.trurisk - a.trurisk);
  return { ...agg, trurisk: tr, truriskSum, truriskCount, byType, topRisk: risk.slice(0, TOP_RISK) };
}

/** QID -> [détections, sévérité, hors délai, plus ancienne détection (ms, 0 si inconnue), QDS max, détections QDS >= 90, détections sur serveurs]. */
type QidStat = [number, number, number, number, number, number, number];

/** Vulnérabilités ouvertes d'une page d'actifs. `watch` : actifs suivis de près (les plus risqués). */
export function detectionsPage(xml: string, now: number, watch: readonly string[] = [], eolQids: readonly string[] = []) {
  const bySev: Record<string, { total: number; overdue: number; ages: number[]; reopened: number; ageSum: number }> = {};
  for (const s of SEVERITIES) bySev[s] = { total: 0, overdue: 0, ages: [0, 0, 0, 0], reopened: 0, ageSum: 0 };
  const byType = emptyByType(() => ({ total: 0, overdue: 0, sev5: 0 }));
  const ignored = { total: 0, sev5: 0, ages: [0, 0, 0, 0] };
  const qids: Record<string, QidStat> = {};
  const hosts: Row[] = [];
  type Watched = { d5: number; d4: number; overdue: number; qids: string[] };
  const watched: Record<string, Watched> = {};
  const watchSet = new Set(watch);
  const eolSet = new Set(eolQids);
  /** Actifs portant au moins un système ou logiciel en fin de vie (EOL/Obsolete). */
  const eol = emptyByType(() => 0);
  let hostCount = 0, hostsWithSev5 = 0, qdsCritical = 0, potential = 0;
  const ageBucket = (age: number) => { const i = AGE_LIMITS.findIndex((l) => age < l); return i === -1 ? AGE_LIMITS.length : i; };

  for (const h of blocks(xml, "HOST")) {
    hostCount++;
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const id = tag(head, "ID");
    const os = tag(head, "OS");
    const type = assetType(os);
    const host = { id, ip: tag(head, "IP"), name: tag(head, "DNS") || tag(head, "NETBIOS") || null, os, type, d5: 0, d4: 0, overdue: 0, qdsCritical: 0 };
    let hasEol = false;
    let w: Watched | null = null;
    if (id && watchSet.has(id)) w = watched[id] = { d5: 0, d4: 0, overdue: 0, qids: [] };
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      const stat = bySev[sev];
      if (!stat) continue;
      if (tag(d, "IS_DISABLED") === "1") continue;
      const first = tag(d, "FIRST_FOUND_DATETIME");
      const age = daysSince(first, now) ?? 0;
      // Dérogations : vulnérabilités ignorées dans la console (risque accepté), comptées à part
      if (tag(d, "IS_IGNORED") === "1") {
        ignored.total++;
        if (sev === 5) ignored.sev5++;
        ignored.ages[ageBucket(age)]++;
        continue;
      }
      if (/potential/i.test(tag(d, "TYPE") ?? "")) potential++;
      const status = tag(d, "STATUS") ?? "";
      const late = first ? now > deadline(Date.parse(first), sev) : false;
      const qds = Number(tag(d, "QDS") ?? 0) || 0;
      stat.total++;
      stat.ageSum += age;
      if (late) stat.overdue++;
      if (/re-?opened/i.test(status)) stat.reopened++;
      stat.ages[ageBucket(age)]++;
      byType[type].total++;
      if (late) byType[type].overdue++;
      if (sev === 5) byType[type].sev5++;
      if (qds >= 90) { qdsCritical++; host.qdsCritical++; }
      if (sev === 5) host.d5++; else host.d4++;
      if (late) host.overdue++;
      const qid = tag(d, "QID");
      if (qid && eolSet.has(qid)) hasEol = true;
      if (w) {
        if (sev === 5) w.d5++; else w.d4++;
        if (late) w.overdue++;
        if (qid) w.qids.push(qid);
      }
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
    if (host.d5 + host.d4 > 0) hosts.push(host);
    if (host.d5 > 0) hostsWithSev5++;
  }
  // Actifs les plus exposés de la page : vulnérabilités critiques (QDS >= 90), puis sévérité 5
  const exposure = (x: Row) => x.qdsCritical * 1000 + x.d5 * 10 + x.d4;
  hosts.sort((a, b) => exposure(b) - exposure(a));
  return { hosts: hostCount, hostsWithVulns: hosts.length, hostsWithSev5, bySev, byType, ignored, eol, qdsCritical, potential, qids, watched, topHosts: hosts.slice(0, TOP) };
}

/** Répartition des délais de correction : jour -> nombre (plafonné à 365). */
type Hist = Record<string, number>;
interface FixStat { n: number; inSla: number; daysSum: number; hist: Hist }
const emptyFix = (): FixStat => ({ n: 0, inSla: 0, daysSum: 0, hist: {} });

/** Vulnérabilités corrigées (statut Fixed) depuis `since` : délais de correction réels. */
export function fixedPage(xml: string, since: number) {
  const bySev: Record<string, FixStat> = {};
  for (const s of SEVERITIES) bySev[s] = emptyFix();
  const byType = emptyByType(emptyFix);
  /** Mois de correction (AAAA-MM) -> sévérité -> [corrigées, dans les délais, somme des délais]. */
  const months: Record<string, Record<string, [number, number, number]>> = {};
  for (const h of blocks(xml, "HOST")) {
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const type = assetType(tag(head, "OS"));
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      if (!bySev[sev] || !/fixed/i.test(tag(d, "STATUS") ?? "")) continue;
      const fixedAt = Date.parse(tag(d, "LAST_FIXED_DATETIME") ?? "");
      const first = Date.parse(tag(d, "FIRST_FOUND_DATETIME") ?? "");
      if (!Number.isFinite(fixedAt) || !Number.isFinite(first) || fixedAt < since) continue;
      const days = Math.max(0, Math.floor((fixedAt - first) / DAY));
      const ok = fixedAt <= deadline(first, sev);
      for (const f of [bySev[sev], byType[type]]) {
        f.n++;
        if (ok) f.inSla++;
        f.daysSum += days;
        const k = String(Math.min(days, 365));
        f.hist[k] = (f.hist[k] ?? 0) + 1;
      }
      const m = new Date(fixedAt).toISOString().slice(0, 7);
      const ms = (months[m] ??= {});
      const cell = (ms[sev] ??= [0, 0, 0]);
      cell[0]++;
      if (ok) cell[1]++;
      cell[2] += days;
    }
  }
  return { bySev, byType, months };
}

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
  let passed = 0, failed = 0, errors = 0;
  for (const i of blocks(tag(xml, "INFO_LIST") ?? "", "INFO")) {
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
  return { policyId, hosts: hosts.size, compliantHosts: hosts.size - failingHosts.size, passed, failed, errors, controls, glossary };
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

export function buildResults(pages: { kind: string; agg: Row }[], now: number) {
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
  // Chaque chiffre est donné pour les sévérités 4 et 5, et pour la sévérité 5 seule
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
  // Critiques au sens du QDS (>= 90) avec un correctif de l'éditeur. La tuile « Critical Patchable »
  // de VMDR compte les correctifs Qualys Patch Management (isQualysPatchable), absents de l'API.
  let criticalPatchable = 0, criticalPatchableSev5 = 0, qdsCriticalSev5 = 0;
  for (const [qid, q] of qids) {
    if (q[1] === 5) qdsCriticalSev5 += q[5] ?? 0;
    if (!(flagsOf(qid) & KB_FLAGS.patchable)) continue;
    criticalPatchable += q[5] ?? 0;
    if (q[1] === 5) criticalPatchableSev5 += q[5] ?? 0;
  }

  const vulnView = ([qid, q]: [string, QidStat]) => {
    const info = kb[qid];
    const flags = info?.[1] ?? 0;
    return {
      qid, title: info?.[0] || null, cves: info?.[2] || null, severity: q[1], hosts: q[0], servers: q[6] ?? 0, overdue: q[2],
      firstFound: q[3] ? new Date(q[3]).toISOString() : null, maxQds: q[4] || null,
      kev: Boolean(flags & KB_FLAGS.kev), ransomware: Boolean(flags & KB_FLAGS.ransomware),
      activeAttacks: Boolean(flags & KB_FLAGS.activeAttacks), exploitPublic: Boolean(flags & KB_FLAGS.exploitPublic),
      patchable: Boolean(flags & KB_FLAGS.patchable),
    };
  };
  const byHosts = (a: [string, QidStat], b: [string, QidStat]) => b[1][0] - a[1][0];
  const topVulns = [...qids.entries()].sort(byHosts).slice(0, TOP).map(vulnView);
  const topArmed = [...qids.entries()].filter(([qid]) => flagsOf(qid) & ARMED).sort(byHosts).slice(0, TOP_RISK).map(vulnView);

  const exposure = (x: Row) => x.qdsCritical * 1000 + x.d5 * 10 + x.d4;
  const topHosts = detPages.flatMap((p) => p.topHosts ?? []).sort((a, b) => exposure(b) - exposure(a)).slice(0, TOP);

  // Actifs les plus risqués (TruRisk), avec leurs vulnérabilités ouvertes
  const watched: Record<string, Row> = Object.assign({}, ...detPages.map((p) => p.watched ?? {}));
  const topRisk = hostsPages.flatMap((p) => (p.topRisk ?? []) as RiskHost[])
    .sort((a, b) => b.trurisk - a.trurisk).slice(0, TOP_RISK)
    .map((h) => {
      const w = h.id ? watched[h.id] : undefined;
      return { ...h, d5: w?.d5 ?? null, d4: w?.d4 ?? null, overdue: w?.overdue ?? null, armed: w ? w.qids.filter((q: string) => flagsOf(q) & ARMED).length : null };
    });
  const truriskCount = sum(hostsPages, (p) => p.truriskCount);

  // Délais de correction réels (vulnérabilités corrigées sur la période)
  const fixSev = Object.fromEntries(SEVERITIES.map((s) => [s, fixView(mergeFix(fixPages.map((p) => p.bySev?.[s])))]));
  const fixAll = fixView(mergeFix(fixPages.flatMap((p) => SEVERITIES.map((s) => p.bySev?.[s]))));
  const fixType = Object.fromEntries(ASSET_TYPES.map((t) => [t, fixView(mergeFix(fixPages.map((p) => p.byType?.[t])))]));
  const monthCells: Record<string, Record<string, [number, number, number]>> = {};
  for (const p of fixPages) {
    for (const [m, bySev] of Object.entries((p.months ?? {}) as Record<string, Record<string, [number, number, number]>>)) {
      for (const [s, c] of Object.entries(bySev)) {
        const cell = ((monthCells[m] ??= {})[s] ??= [0, 0, 0]);
        cell[0] += c[0]; cell[1] += c[1]; cell[2] += c[2];
      }
    }
  }
  const monthly = Object.keys(monthCells).sort().map((m) => {
    const cells = Object.values(monthCells[m]);
    const fixed = cells.reduce((t, c) => t + c[0], 0);
    const inSla = cells.reduce((t, c) => t + c[1], 0);
    const mttrOf = (s: number) => { const c = monthCells[m][s]; return c && c[0] ? round1(c[2] / c[0]) : null; };
    // Premier mois coupé par la fenêtre de 90 jours, mois en cours : chiffres partiels
    const windowStart = new Date(now - FIXED_WINDOW_DAYS * DAY).toISOString().slice(0, 7);
    const partial = m === windowStart ? "start" : m === new Date(now).toISOString().slice(0, 7) ? "current" : null;
    return { month: m, fixed, slaRate: fixed ? round1((inSla / fixed) * 100) : null, mttr5: mttrOf(5), mttr4: mttrOf(4), partial };
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
    top: eolProducts(eolEntries, kb).slice(0, TOP_RISK),
  };

  // Conformité (Policy Audit)
  const posture = pages.filter((p) => p.kind === "posture").map((p) => p.agg);
  const policyTitles: Record<string, string> = Object.assign({}, ...pages.filter((p) => p.kind === "policies").map((p) => Object.fromEntries((p.agg.list ?? []).map((x: Row) => [x.id, x.title]))));
  const pcError: string | null = pages.find((p) => p.kind === "pcerror")?.agg?.message ?? null;
  type PolicyStat = { id: string; title: string; hosts: number; compliantHosts: number; passed: number; failed: number; errors: number };
  const byPolicy = new Map<string, PolicyStat>();
  const controlStats = new Map<string, { failed: number; passed: number; policies: Set<string> }>();
  const glossary: Record<string, [string, string | null]> = {};
  for (const p of posture) {
    const cur: PolicyStat = byPolicy.get(p.policyId) ?? { id: p.policyId, title: policyTitles[p.policyId] ?? `Politique ${p.policyId}`, hosts: 0, compliantHosts: 0, passed: 0, failed: 0, errors: 0 };
    cur.hosts += p.hosts; cur.compliantHosts += p.compliantHosts; cur.passed += p.passed; cur.failed += p.failed; cur.errors += p.errors;
    byPolicy.set(p.policyId, cur);
    Object.assign(glossary, p.glossary ?? {});
    for (const [cid, c] of Object.entries((p.controls ?? {}) as Record<string, [number, number, number]>)) {
      const st = controlStats.get(cid) ?? { failed: 0, passed: 0, policies: new Set<string>() };
      st.passed += c[0]; st.failed += c[1];
      if (c[1]) st.policies.add(p.policyId);
      controlStats.set(cid, st);
    }
  }
  const rate = (ok: number, ko: number) => (ok + ko ? round1((ok / (ok + ko)) * 100) : null);
  const policies = [...byPolicy.values()].filter((p) => p.passed + p.failed > 0)
    .map((p) => ({ ...p, rate: rate(p.passed, p.failed) })).sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
  const allPassed = policies.reduce((t, p) => t + p.passed, 0), allFailed = policies.reduce((t, p) => t + p.failed, 0);
  const compliance = {
    collected: pages.some((p) => p.kind === "policies") || Boolean(pcError),
    error: pcError,
    rate: rate(allPassed, allFailed),
    passed: allPassed, failed: allFailed,
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
    hostsWithSev5: sum(detPages, (p) => p.hostsWithSev5),
    detections: { total, potential: sum(detPages, (p) => p.potential), qdsCritical: sum(detPages, (p) => p.qdsCritical), qdsCriticalSev5, vulns: qids.size },
    severities,
    kev: flagged(KB_FLAGS.kev),
    ransomware: flagged(KB_FLAGS.ransomware),
    activeAttacks: flagged(KB_FLAGS.activeAttacks),
    criticalPatchable,
    criticalPatchableSev5,
    topVulns,
    topHosts,
    // Axe 2 : exposition aux menaces
    exposure: {
      truriskAvg: truriskCount ? Math.round(sum(hostsPages, (p) => p.truriskSum) / truriskCount) : null,
      truriskAssets: truriskCount,
      armed: { ...flagged(ARMED), exploitPublic: flagged(KB_FLAGS.exploitPublic).detections },
      topArmed,
      topRisk,
    },
    // Axe 3 : efficacité opérationnelle
    operations: {
      windowDays: FIXED_WINDOW_DAYS,
      fixed: { all: fixAll, bySev: fixSev, byType: fixType, monthly },
      open: { byType: byTypeOpen },
      reopenRate: total ? round1((reopened / total) * 100) : null,
      ignored,
      fixedCollected: fixPages.length > 0,
    },
    // Axe 1 (en partie) : obsolescence, d'après VMDR
    obsolescence,
    // Axe 4 : conformité et durcissement (Policy Audit)
    compliance,
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
  };
}
