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
