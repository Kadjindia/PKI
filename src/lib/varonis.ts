// Mise en forme des alertes renvoyées par l'Edge Function varonis-proxy.
// Les champs suivent la requête GraphQL alertsQueryJob du proxy ; ils sont tous
// traités comme optionnels, le schéma Varonis n'ayant pas encore été validé
// sur le tenant.

export interface VaronisAlert {
  id: string;
  status?: string | null;
  eventsCount?: number | null;
  hasSensitiveResource?: boolean | null;
  hasTaggedResource?: boolean | null;
  isAssignedToVaronis?: boolean | null;
  generationTime?: { dateTimeUtc?: string | null } | null;
  policy?: {
    id?: string | null;
    name?: string | null;
    severity?: string | null;
    category?: string | null;
  } | null;
  closeReason?: { id?: string | null; name?: string | null } | null;
  closedBy?: { name?: string | null } | null;
  dataSource?: { id?: string | null; name?: string | null; type?: string | null }[] | null;
  escalationType?: string | null;
  url?: string | null;
}

/**
 * Réponse de varonis-proxy pour les alertes : état du cache côté serveur, et les
 * alertes seulement quand elles diffèrent de celles déjà affichées (since).
 */
export interface VaronisAlertsResponse {
  fetchedAt: string | null;
  refreshing: boolean;
  progress: number | null;
  partial: boolean;
  lastError: string | null;
  alerts?: VaronisAlert[];
}

// Mêmes niveaux que la console Varonis (High, Medium, Low, Informational)
export type SeverityLevel = "high" | "medium" | "low" | "info" | "unknown";

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
  info: "Information",
  unknown: "Non renseignée",
};

export function normalizeSeverity(severity?: string | null): SeverityLevel {
  const s = (severity ?? "").toLowerCase();
  if (s.includes("crit") || s.includes("high") || s.includes("élev") || s.includes("haut")) return "high";
  if (s.includes("med") || s.includes("moy")) return "medium";
  if (s.includes("low") || s.includes("faib") || s.includes("bas")) return "low";
  if (s.includes("info")) return "info";
  return "unknown";
}

const CLOSED_MARKERS = ["closed", "resolved", "dismissed", "fermé", "clos", "résolu"];

export function isOpen(alert: VaronisAlert): boolean {
  const s = (alert.status ?? "").toLowerCase();
  return !CLOSED_MARKERS.some((m) => s.includes(m));
}

/** Libellé lisible d'un statut Varonis (UNDER_INVESTIGATION -> Under investigation). */
export function formatStatus(status?: string | null): string {
  if (!status) return "Non renseigné";
  const s = status.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function alertDate(alert: VaronisAlert): Date | null {
  const raw = alert.generationTime?.dateTimeUtc;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function countBy<T>(items: T[], key: (item: T) => string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface VaronisSummary {
  total: number;
  open: number;
  openHigh: number;
  sensitive: number;
  distinctPolicies: number;
  bySeverity: Record<SeverityLevel, number>;
  byStatus: { name: string; count: number }[];
  topPolicies: { name: string; count: number }[];
  byCategory: { name: string; count: number }[];
  latest: VaronisAlert[];
}

export function summarizeAlerts(alerts: VaronisAlert[], latestLimit = 20): VaronisSummary {
  const open = alerts.filter(isOpen);
  const bySeverity: Record<SeverityLevel, number> = { high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
  for (const a of open) bySeverity[normalizeSeverity(a.policy?.severity)]++;

  const policies = countBy(open, (a) => a.policy?.name || "Politique inconnue");

  const latest = [...alerts]
    .sort((a, b) => (alertDate(b)?.getTime() ?? 0) - (alertDate(a)?.getTime() ?? 0))
    .slice(0, latestLimit);

  return {
    total: alerts.length,
    open: open.length,
    openHigh: bySeverity.high,
    sensitive: open.filter((a) => a.hasSensitiveResource).length,
    distinctPolicies: policies.length,
    bySeverity,
    byStatus: countBy(alerts, (a) => formatStatus(a.status)),
    topPolicies: policies.slice(0, 5),
    byCategory: countBy(open, (a) => a.policy?.category || "Non catégorisée"),
    latest,
  };
}

// ---------------------------------------------------------------------------
// Filtre de période et indicateurs de pilotage (calculés côté navigateur sur
// generationTime, la syntaxe de filtre de date Varonis n'étant pas confirmée).
// ---------------------------------------------------------------------------

export type TimePrefix = "last" | "this";
export type TimeUnit = "days" | "months" | "years";
export interface TimeRange { from: number; to: number }

export function computeRange(prefix: TimePrefix, value: number, unit: TimeUnit, now = new Date()): TimeRange {
  if (prefix === "this") {
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    if (unit === "days") return { from: new Date(y, m, d).getTime(), to: now.getTime() };
    if (unit === "months") return { from: new Date(y, m, 1).getTime(), to: now.getTime() };
    return { from: new Date(y, 0, 1).getTime(), to: now.getTime() };
  }
  // Depuis minuit du jour de départ, comme la console Varonis (« from 30 days ago »)
  const n = Math.max(1, Math.floor(value) || 1);
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === "days") from.setDate(from.getDate() - n);
  else if (unit === "months") from.setMonth(from.getMonth() - n);
  else from.setFullYear(from.getFullYear() - n);
  return { from: from.getTime(), to: now.getTime() };
}

/** Période de même durée juste avant, pour les comparaisons. */
export function previousRange(range: TimeRange): TimeRange {
  const span = range.to - range.from;
  return { from: range.from - span, to: range.from };
}

export function filterByRange(alerts: VaronisAlert[], range: TimeRange): VaronisAlert[] {
  return alerts.filter((a) => {
    const t = alertDate(a)?.getTime();
    return t !== undefined && t >= range.from && t <= range.to;
  });
}

/** Dates de la plus ancienne et de la plus récente alerte reçues. */
export function dataCoverage(alerts: VaronisAlert[]): { oldest: Date; newest: Date } | null {
  const times = alerts.map((a) => alertDate(a)?.getTime()).filter((t): t is number => t !== undefined);
  if (times.length === 0) return null;
  return { oldest: new Date(Math.min(...times)), newest: new Date(Math.max(...times)) };
}

/** Évolution en % par rapport à la période précédente (null si pas de base). */
export function variation(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export type Granularity = "hour" | "day" | "week" | "month";
const DAY_MS = 24 * 3600 * 1000;

export function granularityFor(range: TimeRange): Granularity {
  const span = range.to - range.from;
  if (span <= 2 * DAY_MS) return "hour";
  if (span <= 45 * DAY_MS) return "day";
  if (span <= 180 * DAY_MS) return "week";
  return "month";
}

function bucketStart(t: number, g: Granularity): number {
  const d = new Date(t);
  if (g === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  if (g === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (g === "week") {
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday.getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function nextBucket(t: number, g: Granularity): number {
  const d = new Date(t);
  if (g === "hour") d.setHours(d.getHours() + 1);
  else if (g === "day") d.setDate(d.getDate() + 1);
  else if (g === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export interface TimelinePoint { start: number; high: number; medium: number; low: number; info: number; unknown: number; total: number }

/** Alertes par intervalle (heure, jour, semaine ou mois), ventilées par sévérité. */
export function buildTimeline(alerts: VaronisAlert[], range: TimeRange, g = granularityFor(range)): TimelinePoint[] {
  const points = new Map<number, TimelinePoint>();
  for (let t = bucketStart(range.from, g); t <= range.to; t = nextBucket(t, g)) {
    points.set(t, { start: t, high: 0, medium: 0, low: 0, info: 0, unknown: 0, total: 0 });
  }
  for (const a of alerts) {
    const t = alertDate(a)?.getTime();
    if (t === undefined) continue;
    const p = points.get(bucketStart(t, g));
    if (!p) continue;
    p[normalizeSeverity(a.policy?.severity)]++;
    p.total++;
  }
  return [...points.values()];
}

/** Répartition des alertes par heure de la journée (heure locale). */
export function hourlyDistribution(alerts: VaronisAlert[]): { hour: number; count: number }[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const a of alerts) {
    const d = alertDate(a);
    if (d) hours[d.getHours()].count++;
  }
  return hours;
}

/** Alertes hors heures ouvrées : avant 8 h, après 19 h ou le week-end. */
export function isOffHours(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6 || d.getHours() < 8 || d.getHours() >= 19;
}

// ---------------------------------------------------------------------------
// Pilotage SOC : menaces critiques, ancienneté, prise en charge, bruit
// ---------------------------------------------------------------------------

export type ThreatFamily = "ransomware" | "exfiltration" | "privileges" | "destruction";

export const THREAT_FAMILIES: { key: ThreatFamily; label: string }[] = [
  { key: "ransomware", label: "Rançongiciel" },
  { key: "exfiltration", label: "Exfiltration" },
  { key: "privileges", label: "Élévation de privilèges" },
  { key: "destruction", label: "Destruction de données" },
];

// Mots-clés recherchés dans la catégorie puis dans le nom de la politique
// (les libellés exacts dépendent du tenant Varonis).
const THREAT_KEYWORDS: Record<ThreatFamily, string[]> = {
  ransomware: ["ransom", "rançon", "chiffr", "encrypt", "crypto"],
  exfiltration: ["exfil", "fuite", "leak", "upload", "transfer", "copie massive"],
  privileges: ["privil", "escalat", "élévation", "admin", "domain admin"],
  destruction: ["delet", "suppression", "destruct", "wip", "effac"],
};

export function threatFamily(alert: VaronisAlert): ThreatFamily | null {
  const texts = [alert.policy?.category, alert.policy?.name].map((t) => (t ?? "").toLowerCase());
  for (const text of texts) {
    if (!text) continue;
    for (const { key } of THREAT_FAMILIES) {
      if (THREAT_KEYWORDS[key].some((k) => text.includes(k))) return key;
    }
  }
  return null;
}

export interface ThreatStat { key: ThreatFamily; label: string; total: number; open: number; previous: number }

export function threatTracking(current: VaronisAlert[], previous: VaronisAlert[]): ThreatStat[] {
  return THREAT_FAMILIES.map(({ key, label }) => {
    const cur = current.filter((a) => threatFamily(a) === key);
    return {
      key,
      label,
      total: cur.length,
      open: cur.filter(isOpen).length,
      previous: previous.filter((a) => threatFamily(a) === key).length,
    };
  });
}

/** Âge en jours d'une alerte (null si pas de date). */
export function ageInDays(alert: VaronisAlert, now = new Date()): number | null {
  const d = alertDate(alert);
  return d ? Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS)) : null;
}

export interface AgeBuckets { lt7: number; d7to30: number; gt30: number; oldestDays: number | null; highGt7: number }

/** Ancienneté des alertes encore ouvertes (arriéré), quelle que soit la période. */
export function openAgeBuckets(alerts: VaronisAlert[], now = new Date()): AgeBuckets {
  const b: AgeBuckets = { lt7: 0, d7to30: 0, gt30: 0, oldestDays: null, highGt7: 0 };
  for (const a of alerts.filter(isOpen)) {
    const age = ageInDays(a, now);
    if (age === null) continue;
    if (age < 7) b.lt7++;
    else if (age <= 30) b.d7to30++;
    else b.gt30++;
    if (age >= 7 && normalizeSeverity(a.policy?.severity) === "high") b.highGt7++;
    b.oldestDays = Math.max(b.oldestDays ?? 0, age);
  }
  return b;
}

/** Répartition de la prise en charge des alertes ouvertes : Varonis (MDR) ou équipe interne. */
export function handlingSplit(alerts: VaronisAlert[]): { varonis: number; internal: number } {
  const open = alerts.filter(isOpen);
  const varonis = open.filter((a) => a.isAssignedToVaronis).length;
  return { varonis, internal: open.length - varonis };
}

/** Part des alertes de la période passées au statut « escaladé ». */
export function escalationRate(alerts: VaronisAlert[]): number {
  if (alerts.length === 0) return 0;
  const escalated = alerts.filter((a) => (a.status ?? "").toLowerCase().includes("escalat")).length;
  return Math.round((escalated / alerts.length) * 100);
}

export interface PolicyNoise {
  name: string;
  severity: SeverityLevel;
  total: number;
  open: number;
  closedPct: number;
  share: number; // part des alertes de la période, en %
  falsePositivePct: number | null; // parmi les alertes clôturées avec un motif
  noisy: boolean;
}

/**
 * Volume par politique. « Bruit probable » : sévérité faible ou moyenne et au
 * moins 15 % des alertes de la période — candidate à un réglage.
 */
export function policyNoise(alerts: VaronisAlert[]): PolicyNoise[] {
  const groups = new Map<string, VaronisAlert[]>();
  for (const a of alerts) {
    const name = a.policy?.name || "Politique inconnue";
    groups.set(name, [...(groups.get(name) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const open = list.filter(isOpen).length;
      const severity = normalizeSeverity(list[0].policy?.severity);
      const share = Math.round((list.length / alerts.length) * 100);
      const v = verdictStats(list);
      const falsePositivePct = v.classified > 0 ? Math.round((v.falsePositive / v.classified) * 100) : null;
      return {
        name,
        severity,
        total: list.length,
        open,
        closedPct: Math.round(((list.length - open) / list.length) * 100),
        share,
        falsePositivePct,
        // Bruit : beaucoup d'alertes peu graves, ou majorité de faux positifs (sur au moins 5 verdicts)
        noisy: ((severity === "low" || severity === "medium" || severity === "info") && share >= 15)
          || (falsePositivePct !== null && falsePositivePct >= 50 && v.classified >= 5),
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Étape 2 : verdicts, sources de données, clôture, escalades
// ---------------------------------------------------------------------------

export type Verdict = "truePositive" | "falsePositive" | "other";

export const VERDICT_LABELS: Record<Verdict, string> = {
  truePositive: "Menace avérée",
  falsePositive: "Faux positif / activité légitime",
  other: "Autre motif",
};

// Motifs de clôture Varonis (en partie personnalisables) : classés par mots-clés
const TRUE_POSITIVE_KEYS = ["true positive", "vrai positif", "malicious", "malveillant", "confirmed", "confirmé", "incident"];
const FALSE_POSITIVE_KEYS = ["false positive", "faux positif", "benign", "bénin", "légitime", "legitimate", "not relevant", "non pertinent", "authorized", "autorisé", "expected", "attendu"];

export function closeVerdict(alert: VaronisAlert): Verdict | null {
  const reason = (alert.closeReason?.name ?? "").toLowerCase();
  if (!reason) return null;
  if (FALSE_POSITIVE_KEYS.some((k) => reason.includes(k))) return "falsePositive";
  if (TRUE_POSITIVE_KEYS.some((k) => reason.includes(k))) return "truePositive";
  return "other";
}

export interface VerdictStats {
  closed: number;
  classified: number; // alertes clôturées avec un motif renseigné
  truePositive: number;
  falsePositive: number;
  other: number;
  reasons: { name: string; count: number; verdict: Verdict }[];
}

/** Verdicts des alertes clôturées (motif de clôture). */
export function verdictStats(alerts: VaronisAlert[]): VerdictStats {
  const closed = alerts.filter((a) => !isOpen(a));
  const stats: VerdictStats = { closed: closed.length, classified: 0, truePositive: 0, falsePositive: 0, other: 0, reasons: [] };
  const reasons = new Map<string, { count: number; verdict: Verdict }>();
  for (const a of closed) {
    const v = closeVerdict(a);
    if (!v) continue;
    stats.classified++;
    stats[v]++;
    const name = a.closeReason?.name ?? "";
    reasons.set(name, { count: (reasons.get(name)?.count ?? 0) + 1, verdict: v });
  }
  stats.reasons = [...reasons.entries()]
    .map(([name, r]) => ({ name, ...r }))
    .sort((a, b) => b.count - a.count);
  return stats;
}

const DATA_SOURCE_LABELS: Record<string, string> = {
  windows: "Serveurs de fichiers Windows",
  sharepointonline: "SharePoint Online",
  sharepoint: "SharePoint",
  exchangeonline: "Exchange Online",
  exchange: "Exchange",
  onedrive: "OneDrive",
  activedirectory: "Active Directory",
  azureactivedirectory: "Entra ID (Azure AD)",
  entraid: "Entra ID (Azure AD)",
  teams: "Teams",
  nas: "NAS",
  netapp: "NetApp",
  unix: "Serveurs Unix/Linux",
};

export function dataSourceLabel(type?: string | null, name?: string | null): string {
  if (!type) return name || "Source inconnue";
  return DATA_SOURCE_LABELS[type.toLowerCase().replace(/[^a-z]/g, "")] ?? type;
}

/** Alertes par type de source de données (une alerte compte une fois par type). */
export function dataSourceStats(alerts: VaronisAlert[]): { label: string; total: number; open: number }[] {
  const map = new Map<string, { total: number; open: number }>();
  for (const a of alerts) {
    const labels = new Set((a.dataSource ?? []).map((d) => dataSourceLabel(d?.type, d?.name)));
    if (labels.size === 0) labels.add("Source inconnue");
    for (const label of labels) {
      const e = map.get(label) ?? { total: 0, open: 0 };
      e.total++;
      if (isOpen(a)) e.open++;
      map.set(label, e);
    }
  }
  return [...map.entries()]
    .map(([label, e]) => ({ label, ...e }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export type CloserKind = "varonis" | "internal" | "unknown";

/** Qui a clôturé une alerte (null si elle est encore ouverte). */
export function closerKind(alert: VaronisAlert): CloserKind | null {
  if (isOpen(alert)) return null;
  const name = (alert.closedBy?.name ?? "").trim();
  if (!name) return "unknown";
  return name.toLowerCase().includes("varonis") ? "varonis" : "internal";
}

/** Qui a clôturé les alertes : Varonis (MDR) ou l'équipe interne (par analyste). */
export function closedByStats(alerts: VaronisAlert[]): { varonis: number; internal: number; unknown: number; analysts: { name: string; count: number }[] } {
  const r = { varonis: 0, internal: 0, unknown: 0, analysts: [] as { name: string; count: number }[] };
  const analysts = new Map<string, number>();
  for (const a of alerts.filter((x) => !isOpen(x))) {
    const kind = closerKind(a)!;
    r[kind]++;
    if (kind === "internal") {
      const name = (a.closedBy?.name ?? "").trim();
      analysts.set(name, (analysts.get(name) ?? 0) + 1);
    }
  }
  r.analysts = [...analysts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  return r;
}

export type EscalationType = "MITIGATION" | "VALIDATION" | "INFORMATION";
export const ESCALATION_LABELS: Record<EscalationType, string> = {
  MITIGATION: "Remédiation",
  VALIDATION: "Validation",
  INFORMATION: "Information",
};

/** Alertes ouvertes escaladées par Varonis, par type d'escalade attendu. */
export function openEscalations(alerts: VaronisAlert[]): Record<EscalationType, number> {
  const r: Record<EscalationType, number> = { MITIGATION: 0, VALIDATION: 0, INFORMATION: 0 };
  for (const a of alerts.filter(isOpen)) {
    const t = (a.escalationType ?? "").toUpperCase() as EscalationType;
    if (t in r) r[t]++;
  }
  return r;
}

/** URL de l'alerte dans la console Varonis, seulement si http(s). */
export function safeAlertUrl(alert: VaronisAlert): string | null {
  const u = alert.url ?? "";
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Point d'attention ; « filter » : filtre appliqué quand on clique dessus. */
export interface Insight { level: "critical" | "warning" | "info"; text: string; filter?: AlertFilters }

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/**
 * Points d'attention rédigés pour le RSSI. `allAlerts` (toutes les alertes
 * reçues) sert à l'arriéré, qui ne dépend pas de la période choisie.
 */
export function buildInsights(
  current: VaronisAlert[],
  previous: VaronisAlert[],
  allAlerts: VaronisAlert[] = current,
  now = new Date(),
): Insight[] {
  const insights: Insight[] = [];
  if (current.length === 0) return insights;
  const s = summarizeAlerts(current);

  if (s.openHigh > 0) {
    insights.push({ level: "critical", text: `${s.openHigh} ${plural(s.openHigh, "alerte", "alertes")} de sévérité élevée ${plural(s.openHigh, "est encore ouverte", "sont encore ouvertes")}.`, filter: { state: "open", severity: ["high"] } });
  }
  const ages = openAgeBuckets(allAlerts, now);
  if (ages.highGt7 > 0) {
    insights.push({ level: "critical", text: `${ages.highGt7} ${plural(ages.highGt7, "alerte élevée est ouverte", "alertes élevées sont ouvertes")} depuis plus de 7 jours (toutes périodes confondues).`, filter: { severity: ["high"], age: "gt7" } });
  }
  const mitigation = openEscalations(allAlerts).MITIGATION;
  if (mitigation > 0) {
    insights.push({ level: "critical", text: `${mitigation} ${plural(mitigation, "alerte escaladée par Varonis attend", "alertes escaladées par Varonis attendent")} une action de remédiation de votre part.`, filter: { escalation: "MITIGATION" } });
  }
  const ransomware = current.filter((a) => threatFamily(a) === "ransomware" && isOpen(a)).length;
  if (ransomware > 0) {
    insights.push({ level: "critical", text: `${ransomware} ${plural(ransomware, "alerte ouverte évoque", "alertes ouvertes évoquent")} un comportement de rançongiciel.`, filter: { state: "open", threat: "ransomware" } });
  }
  const taggedOpen = current.filter((a) => isOpen(a) && a.hasTaggedResource).length;
  if (taggedOpen > 0) {
    insights.push({ level: "warning", text: `${taggedOpen} ${plural(taggedOpen, "alerte ouverte touche", "alertes ouvertes touchent")} des ressources taguées (données critiques).`, filter: { state: "open", tagged: true } });
  }
  if (s.sensitive > 0) {
    insights.push({ level: "warning", text: `${s.sensitive} ${plural(s.sensitive, "alerte ouverte concerne", "alertes ouvertes concernent")} des données sensibles.`, filter: { state: "open", sensitive: true } });
  }
  if (ages.gt30 > 0) {
    insights.push({ level: "warning", text: `Arriéré (toutes périodes) : ${ages.gt30} ${plural(ages.gt30, "alerte ouverte", "alertes ouvertes")} depuis plus de 30 jours.`, filter: { age: "gt30" } });
  }
  const evo = variation(current.length, previous.length);
  // Seulement sur une base significative (au moins 10 alertes la période précédente)
  if (evo !== null && Math.abs(evo) >= 20 && previous.length >= 10) {
    insights.push({
      level: evo > 0 ? "warning" : "info",
      text: `Volume d'alertes en ${evo > 0 ? "hausse" : "baisse"} de ${Math.abs(evo)} % par rapport à la période précédente.`,
    });
  }
  const off = current.filter((a) => { const d = alertDate(a); return d ? isOffHours(d) : false; }).length;
  const offPct = Math.round((off / current.length) * 100);
  if (offPct >= 30) {
    insights.push({ level: "warning", text: `${offPct} % des alertes surviennent hors heures ouvrées (soir, nuit ou week-end).`, filter: { offHours: true } });
  }
  const v = verdictStats(current);
  if (v.classified >= 10) {
    const fp = Math.round((v.falsePositive / v.classified) * 100);
    if (fp >= 50) {
      insights.push({ level: "warning", text: `${fp} % des alertes clôturées sont des faux positifs ou une activité légitime : des politiques sont à régler.`, filter: { verdict: "falsePositive" } });
    }
  }
  const noisy = policyNoise(current).filter((p) => p.noisy);
  if (noisy.length > 0) {
    insights.push({ level: "info", text: `${noisy.length} ${plural(noisy.length, "politique génère", "politiques génèrent")} surtout du bruit (alertes peu graves ou faux positifs) : réglage à envisager (« ${noisy[0].name} »).`, filter: { policy: noisy[0].name } });
  }
  const treated = s.total - s.open;
  insights.push({ level: "info", text: `Taux de traitement : ${Math.round((treated / s.total) * 100)} % des alertes de la période sont fermées.`, filter: { state: "closed" } });
  return insights;
}

// ---------------------------------------------------------------------------
// Filtres croisés : un clic sur un visuel filtre l'ensemble de l'onglet
// ---------------------------------------------------------------------------

export type AgeFilter = "lt7" | "d7to30" | "gt30" | "gt7";

export interface AlertFilters {
  state?: "open" | "closed";
  severity?: SeverityLevel[];
  status?: string[]; // statut tel qu'affiché (formatStatus)
  threat?: ThreatFamily;
  policy?: string;
  category?: string;
  source?: string; // libellé de type de source (dataSourceLabel)
  verdict?: Verdict;
  closeReason?: string;
  closer?: CloserKind;
  analyst?: string;
  handling?: "varonis" | "internal"; // alertes ouvertes : prise en charge
  escalation?: EscalationType; // alertes ouvertes escaladées par Varonis
  age?: AgeFilter; // alertes ouvertes : ancienneté
  hour?: number;
  offHours?: boolean;
  sensitive?: boolean;
  tagged?: boolean;
  bucket?: { from: number; to: number; label: string }; // barre du graphique d'évolution
}

const AGE_LABELS: Record<AgeFilter, string> = {
  lt7: "ouvertes depuis moins de 7 jours", d7to30: "ouvertes depuis 7 à 30 jours",
  gt30: "ouvertes depuis plus de 30 jours", gt7: "ouvertes depuis plus de 7 jours",
};
const CLOSER_LABELS: Record<CloserKind, string> = { varonis: "Varonis (MDR)", internal: "Équipe interne", unknown: "Non renseigné" };

export function matchesFilters(a: VaronisAlert, f: AlertFilters, now = new Date()): boolean {
  const open = isOpen(a);
  if (f.state === "open" && !open) return false;
  if (f.state === "closed" && open) return false;
  if (f.severity?.length && !f.severity.includes(normalizeSeverity(a.policy?.severity))) return false;
  if (f.status?.length && !f.status.includes(formatStatus(a.status))) return false;
  if (f.threat && threatFamily(a) !== f.threat) return false;
  if (f.policy && (a.policy?.name || "Politique inconnue") !== f.policy) return false;
  if (f.category && (a.policy?.category || "Non catégorisée") !== f.category) return false;
  if (f.source && !(a.dataSource ?? []).some((d) => dataSourceLabel(d?.type, d?.name) === f.source)) return false;
  if (f.verdict && closeVerdict(a) !== f.verdict) return false;
  if (f.closeReason && (a.closeReason?.name ?? "") !== f.closeReason) return false;
  if (f.closer && closerKind(a) !== f.closer) return false;
  if (f.analyst && (closerKind(a) !== "internal" || (a.closedBy?.name ?? "").trim() !== f.analyst)) return false;
  if (f.handling && (!open || (f.handling === "varonis") !== Boolean(a.isAssignedToVaronis))) return false;
  if (f.escalation && (!open || (a.escalationType ?? "").toUpperCase() !== f.escalation)) return false;
  if (f.age) {
    const age = open ? ageInDays(a, now) : null;
    if (age === null) return false;
    const ok = f.age === "lt7" ? age < 7 : f.age === "d7to30" ? age >= 7 && age <= 30 : f.age === "gt30" ? age > 30 : age >= 7;
    if (!ok) return false;
  }
  const d = alertDate(a);
  if (f.hour !== undefined && (!d || d.getHours() !== f.hour)) return false;
  if (f.offHours && (!d || !isOffHours(d))) return false;
  if (f.sensitive && !a.hasSensitiveResource) return false;
  if (f.tagged && !a.hasTaggedResource) return false;
  if (f.bucket && (!d || d.getTime() < f.bucket.from || d.getTime() >= f.bucket.to)) return false;
  return true;
}

export function applyFilters(alerts: VaronisAlert[], f: AlertFilters, now = new Date()): VaronisAlert[] {
  return isFiltered(f) ? alerts.filter((a) => matchesFilters(a, f, now)) : alerts;
}

export function isFiltered(f: AlertFilters): boolean {
  return Object.values(f).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Bascule un filtre au clic : une liste (sévérités, statuts) ajoute ou retire la
 * valeur ; une valeur simple est posée, ou retirée si elle était déjà active.
 */
export function toggleFilter<K extends keyof AlertFilters>(f: AlertFilters, key: K, value: NonNullable<AlertFilters[K]> extends (infer U)[] ? U : NonNullable<AlertFilters[K]>): AlertFilters {
  const next: AlertFilters = { ...f };
  const current = f[key];
  if (Array.isArray(current) || key === "severity" || key === "status") {
    const list = ((current as unknown[]) ?? []).slice();
    const i = list.findIndex((v) => sameValue(v, value));
    if (i >= 0) list.splice(i, 1); else list.push(value);
    (next as Record<string, unknown>)[key] = list.length ? list : undefined;
  } else {
    (next as Record<string, unknown>)[key] = sameValue(current, value) ? undefined : value;
  }
  return next;
}

/** Applique d'un coup un ensemble de filtres (ex. un point d'attention) ; le recliquer les retire. */
export function applyFilterPatch(f: AlertFilters, patch: AlertFilters): AlertFilters {
  const active = Object.entries(patch).every(([k, v]) => sameValue(f[k as keyof AlertFilters], v));
  const next: AlertFilters = { ...f };
  for (const [k, v] of Object.entries(patch)) (next as Record<string, unknown>)[k] = active ? undefined : v;
  return next;
}

export interface FilterChip { key: keyof AlertFilters; value?: unknown; label: string }

/** Filtres actifs, en libellés lisibles (une pastille par valeur). */
export function filterChips(f: AlertFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.state) chips.push({ key: "state", label: f.state === "open" ? "Ouvertes" : "Clôturées" });
  for (const s of f.severity ?? []) chips.push({ key: "severity", value: s, label: `Sévérité : ${SEVERITY_LABELS[s]}` });
  for (const s of f.status ?? []) chips.push({ key: "status", value: s, label: `Statut : ${s}` });
  if (f.threat) chips.push({ key: "threat", label: THREAT_FAMILIES.find((t) => t.key === f.threat)?.label ?? f.threat });
  if (f.policy) chips.push({ key: "policy", label: `Politique : ${f.policy}` });
  if (f.category) chips.push({ key: "category", label: `Catégorie : ${f.category}` });
  if (f.source) chips.push({ key: "source", label: `Source : ${f.source}` });
  if (f.verdict) chips.push({ key: "verdict", label: `Verdict : ${VERDICT_LABELS[f.verdict]}` });
  if (f.closeReason) chips.push({ key: "closeReason", label: `Motif : ${f.closeReason}` });
  if (f.closer) chips.push({ key: "closer", label: `Clôturées par : ${CLOSER_LABELS[f.closer]}` });
  if (f.analyst) chips.push({ key: "analyst", label: `Analyste : ${f.analyst}` });
  if (f.handling) chips.push({ key: "handling", label: `Prise en charge : ${f.handling === "varonis" ? "Varonis (MDR)" : "Équipe interne"}` });
  if (f.escalation) chips.push({ key: "escalation", label: `Escalade : ${ESCALATION_LABELS[f.escalation]}` });
  if (f.age) chips.push({ key: "age", label: AGE_LABELS[f.age] });
  if (f.hour !== undefined) chips.push({ key: "hour", label: `${f.hour}h – ${f.hour + 1}h` });
  if (f.offHours) chips.push({ key: "offHours", label: "Hors heures ouvrées" });
  if (f.sensitive) chips.push({ key: "sensitive", label: "Données sensibles" });
  if (f.tagged) chips.push({ key: "tagged", label: "Ressources taguées" });
  if (f.bucket) chips.push({ key: "bucket", label: `Période : ${f.bucket.label}` });
  return chips;
}

/** Retire une pastille (une valeur d'une liste, ou le filtre entier). */
export function removeChip(f: AlertFilters, chip: FilterChip): AlertFilters {
  if (chip.value !== undefined) return toggleFilter(f, chip.key, chip.value as never);
  const next = { ...f };
  delete next[chip.key];
  return next;
}
