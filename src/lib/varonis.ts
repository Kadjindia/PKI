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
}

export interface VaronisProxyResponse {
  status?: "pending" | "done";
  jobId?: string;
  jobStatus?: string;
  jobProgress?: number;
  alerts?: VaronisAlert[] | null;
}

export type SeverityLevel = "high" | "medium" | "low" | "unknown";

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
  unknown: "Non renseignée",
};

export function normalizeSeverity(severity?: string | null): SeverityLevel {
  const s = (severity ?? "").toLowerCase();
  if (s.includes("crit") || s.includes("high") || s.includes("élev") || s.includes("haut")) return "high";
  if (s.includes("med") || s.includes("moy")) return "medium";
  if (s.includes("low") || s.includes("faib") || s.includes("bas")) return "low";
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
  const bySeverity: Record<SeverityLevel, number> = { high: 0, medium: 0, low: 0, unknown: 0 };
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
  const n = Math.max(1, Math.floor(value) || 1);
  const from = new Date(now);
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

export interface TimelinePoint { start: number; high: number; medium: number; low: number; unknown: number; total: number }

/** Alertes par intervalle (heure, jour, semaine ou mois), ventilées par sévérité. */
export function buildTimeline(alerts: VaronisAlert[], range: TimeRange, g = granularityFor(range)): TimelinePoint[] {
  const points = new Map<number, TimelinePoint>();
  for (let t = bucketStart(range.from, g); t <= range.to; t = nextBucket(t, g)) {
    points.set(t, { start: t, high: 0, medium: 0, low: 0, unknown: 0, total: 0 });
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

export interface Insight { level: "critical" | "warning" | "info"; text: string }

/** Points d'attention rédigés pour le RSSI, à partir des alertes de la période. */
export function buildInsights(current: VaronisAlert[], previous: VaronisAlert[]): Insight[] {
  const insights: Insight[] = [];
  if (current.length === 0) return insights;
  const s = summarizeAlerts(current);

  if (s.openHigh > 0) {
    insights.push({ level: "critical", text: `${s.openHigh} alerte${s.openHigh > 1 ? "s" : ""} de sévérité élevée ${s.openHigh > 1 ? "sont" : "est"} encore ouverte${s.openHigh > 1 ? "s" : ""}.` });
  }
  const sensitiveOpen = s.sensitive;
  if (sensitiveOpen > 0) {
    insights.push({ level: "warning", text: `${sensitiveOpen} alerte${sensitiveOpen > 1 ? "s" : ""} ouverte${sensitiveOpen > 1 ? "s" : ""} concerne${sensitiveOpen > 1 ? "nt" : ""} des données sensibles.` });
  }
  const evo = variation(current.length, previous.length);
  if (evo !== null && Math.abs(evo) >= 20 && previous.length > 0) {
    insights.push({
      level: evo > 0 ? "warning" : "info",
      text: `Volume d'alertes en ${evo > 0 ? "hausse" : "baisse"} de ${Math.abs(evo)} % par rapport à la période précédente.`,
    });
  }
  const off = current.filter((a) => { const d = alertDate(a); return d ? isOffHours(d) : false; }).length;
  const offPct = Math.round((off / current.length) * 100);
  if (offPct >= 30) {
    insights.push({ level: "warning", text: `${offPct} % des alertes surviennent hors heures ouvrées (soir, nuit ou week-end).` });
  }
  const top = s.topPolicies[0];
  if (top && top.count >= 2) {
    insights.push({ level: "info", text: `Politique la plus déclenchée : « ${top.name} » (${top.count} alertes ouvertes).` });
  }
  const treated = s.total - s.open;
  insights.push({ level: "info", text: `Taux de traitement : ${Math.round((treated / s.total) * 100)} % des alertes de la période sont fermées.` });
  return insights;
}
