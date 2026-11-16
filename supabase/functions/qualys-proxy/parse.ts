// Lecture des réponses XML de Qualys et calcul des chiffres de la photo.
// Module sans dépendance : utilisé par qualys-proxy et testé avec Vitest.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const SEVERITIES = [5, 4] as const;
/** Délais de correction cibles (jours) par sévérité. */
export const SLA_DAYS: Record<number, number> = { 5: 15, 4: 30 };
/** Tranches d'ancienneté (jours depuis la première détection). */
export const AGE_LIMITS = [30, 90, 180]; // < 30, 30-90, 90-180, > 180
export const RECENT_SCAN_DAYS = 30;

export const TOP = 20;
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
// Chiffres d'une page
// ---------------------------------------------------------------------------

/** Liste des actifs : couverture des scans. */
export function hostsPage(xml: string, now: number) {
  const agg = { total: 0, agent: 0, scanned: 0, neverScanned: 0, trurisk: [] as number[] };
  for (const h of blocks(xml, "HOST")) {
    agg.total++;
    if (/agent/i.test(tag(h, "TRACKING_METHOD") ?? "")) agg.agent++;
    const last = tag(h, "LAST_VULN_SCAN_DATETIME") ?? tag(h, "LAST_VM_SCANNED_DATE");
    const age = daysSince(last, now);
    if (age === null) agg.neverScanned++;
    else if (age <= RECENT_SCAN_DAYS) agg.scanned++;
    const score = Number(tag(h, "TRURISK_SCORE"));
    if (Number.isFinite(score) && tag(h, "TRURISK_SCORE") !== null) agg.trurisk.push(score);
  }
  // Répartition TruRisk (0-1000) : on ne garde que les tranches
  const tr = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of agg.trurisk) {
    if (s >= 850) tr.critical++; else if (s >= 700) tr.high++; else if (s >= 500) tr.medium++; else tr.low++;
  }
  return { total: agg.total, agent: agg.agent, scanned: agg.scanned, neverScanned: agg.neverScanned, trurisk: tr };
}

/** QID -> [détections, sévérité, hors délai, plus ancienne détection (ms, 0 si inconnue), QDS max, détections QDS >= 90]. */
type QidStat = [number, number, number, number, number, number];

/** Vulnérabilités ouvertes d'une page d'actifs. */
export function detectionsPage(xml: string, now: number) {
  const bySev: Record<string, { total: number; overdue: number; ages: number[]; reopened: number }> = {};
  for (const s of SEVERITIES) bySev[s] = { total: 0, overdue: 0, ages: [0, 0, 0, 0], reopened: 0 };
  const qids: Record<string, QidStat> = {};
  const hosts: Row[] = [];
  let hostCount = 0, hostsWithSev5 = 0, qdsCritical = 0, potential = 0;

  for (const h of blocks(xml, "HOST")) {
    hostCount++;
    const head = h.slice(0, Math.max(0, h.indexOf("<DETECTION_LIST>")) || h.length);
    const host = { id: tag(head, "ID"), ip: tag(head, "IP"), name: tag(head, "DNS") || tag(head, "NETBIOS") || null, os: tag(head, "OS"), d5: 0, d4: 0, overdue: 0, qdsCritical: 0 };
    for (const d of blocks(h, "DETECTION")) {
      const sev = Number(tag(d, "SEVERITY"));
      const stat = bySev[sev];
      if (!stat) continue;
      if (tag(d, "IS_IGNORED") === "1" || tag(d, "IS_DISABLED") === "1") continue;
      if (/potential/i.test(tag(d, "TYPE") ?? "")) potential++;
      const status = tag(d, "STATUS") ?? "";
      const first = tag(d, "FIRST_FOUND_DATETIME");
      const age = daysSince(first, now) ?? 0;
      const late = age > SLA_DAYS[sev];
      const qds = Number(tag(d, "QDS") ?? 0) || 0;
      stat.total++;
      if (late) stat.overdue++;
      if (/re-?opened/i.test(status)) stat.reopened++;
      stat.ages[AGE_LIMITS.findIndex((l) => age < l) === -1 ? AGE_LIMITS.length : AGE_LIMITS.findIndex((l) => age < l)]++;
      if (qds >= 90) { qdsCritical++; host.qdsCritical++; }
      if (sev === 5) host.d5++; else host.d4++;
      if (late) host.overdue++;
      const qid = tag(d, "QID");
      if (qid) {
        const q = qids[qid] ?? (qids[qid] = [0, sev, 0, 0, 0, 0]);
        q[0]++;
        if (late) q[2]++;
        if (first) q[3] = q[3] ? Math.min(q[3], Date.parse(first)) : Date.parse(first);
        q[4] = Math.max(q[4], qds);
        if (qds >= 90) q[5]++;
      }
    }
    if (host.d5 + host.d4 > 0) hosts.push(host);
    if (host.d5 > 0) hostsWithSev5++;
  }
  // Actifs les plus exposés de la page : vulnérabilités critiques (QDS >= 90), puis sévérité 5
  const exposure = (x: Row) => x.qdsCritical * 1000 + x.d5 * 10 + x.d4;
  hosts.sort((a, b) => exposure(b) - exposure(a));
  return { hosts: hostCount, hostsWithVulns: hosts.length, hostsWithSev5, bySev, qdsCritical, potential, qids, topHosts: hosts.slice(0, TOP) };
}

/** Base de connaissances : titre, CVE et indicateurs de menace de chaque vulnérabilité. */
export const KB_FLAGS = { kev: 1, ransomware: 2, patchable: 4, activeAttacks: 8, exploitPublic: 16 } as const;
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
    const cves = [...blocks(tag(v, "CVE_LIST") ?? "", "CVE")].map((c) => tag(c, "ID")).filter(Boolean).slice(0, 3).join(", ");
    out[qid] = [tag(v, "TITLE") ?? "", flags, cves];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photo finale : réunion des pages
// ---------------------------------------------------------------------------

export function buildResults(pages: { kind: string; agg: Row }[], now: number) {
  const hostsPages = pages.filter((p) => p.kind === "hosts").map((p) => p.agg);
  const detPages = pages.filter((p) => p.kind === "detections").map((p) => p.agg);
  const kb: Record<string, [string, number, string]> = Object.assign({}, ...pages.filter((p) => p.kind === "kb").map((p) => p.agg));

  const sum = (list: Row[], f: (x: Row) => number) => list.reduce((t, x) => t + (f(x) || 0), 0);
  const coverage = {
    total: sum(hostsPages, (p) => p.total),
    agent: sum(hostsPages, (p) => p.agent),
    scanned: sum(hostsPages, (p) => p.scanned),
    neverScanned: sum(hostsPages, (p) => p.neverScanned),
    trurisk: { critical: sum(hostsPages, (p) => p.trurisk?.critical), high: sum(hostsPages, (p) => p.trurisk?.high), medium: sum(hostsPages, (p) => p.trurisk?.medium), low: sum(hostsPages, (p) => p.trurisk?.low) },
    recentDays: RECENT_SCAN_DAYS,
  };

  const severities = SEVERITIES.map((s) => ({
    severity: s,
    slaDays: SLA_DAYS[s],
    total: sum(detPages, (p) => p.bySev[s]?.total),
    overdue: sum(detPages, (p) => p.bySev[s]?.overdue),
    reopened: sum(detPages, (p) => p.bySev[s]?.reopened),
    ages: [0, 1, 2, 3].map((i) => sum(detPages, (p) => p.bySev[s]?.ages?.[i])),
  }));

  // Vulnérabilités (QID) réunies
  const qids = new Map<string, QidStat>();
  for (const p of detPages) {
    for (const [qid, q] of Object.entries(p.qids as Record<string, QidStat>)) {
      const cur = qids.get(qid);
      if (!cur) { qids.set(qid, [...q] as QidStat); continue; }
      cur[0] += q[0]; cur[2] += q[2]; cur[3] = cur[3] && q[3] ? Math.min(cur[3], q[3]) : cur[3] || q[3]; cur[4] = Math.max(cur[4], q[4]); cur[5] = (cur[5] ?? 0) + (q[5] ?? 0);
    }
  }
  // Chaque chiffre est donné pour les sévérités 4 et 5, et pour la sévérité 5 seule
  // (sev5), comme les filtres de la console VMDR
  const flagged = (flag: number) => {
    let detections = 0, vulns = 0, sev5 = 0;
    for (const [qid, q] of qids) {
      if (!((kb[qid]?.[1] ?? 0) & flag)) continue;
      detections += q[0];
      vulns++;
      if (q[1] === 5) sev5 += q[0];
    }
    return { detections, vulns, sev5 };
  };
  // « Critical Patchable Vulns » de VMDR : critiques au sens du QDS (>= 90) avec un correctif disponible
  let criticalPatchable = 0, criticalPatchableSev5 = 0, qdsCriticalSev5 = 0;
  for (const [qid, q] of qids) {
    if (q[1] === 5) qdsCriticalSev5 += q[5] ?? 0;
    if (!((kb[qid]?.[1] ?? 0) & KB_FLAGS.patchable)) continue;
    criticalPatchable += q[5] ?? 0;
    if (q[1] === 5) criticalPatchableSev5 += q[5] ?? 0;
  }

  const topVulns = [...qids.entries()]
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, TOP)
    .map(([qid, q]) => {
      const info = kb[qid];
      const flags = info?.[1] ?? 0;
      return {
        qid, title: info?.[0] || null, cves: info?.[2] || null, severity: q[1], hosts: q[0], overdue: q[2],
        firstFound: q[3] ? new Date(q[3]).toISOString() : null, maxQds: q[4] || null,
        kev: Boolean(flags & KB_FLAGS.kev), ransomware: Boolean(flags & KB_FLAGS.ransomware),
        activeAttacks: Boolean(flags & KB_FLAGS.activeAttacks), patchable: Boolean(flags & KB_FLAGS.patchable),
      };
    });

  const exposure = (x: Row) => x.qdsCritical * 1000 + x.d5 * 10 + x.d4;
  const topHosts = detPages.flatMap((p) => p.topHosts ?? []).sort((a, b) => exposure(b) - exposure(a)).slice(0, TOP);

  const total = severities.reduce((t, s) => t + s.total, 0);
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
  };
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
  };
}

