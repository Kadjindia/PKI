// Vulnérabilités Qualys VMDR : photo calculée chaque nuit par la fonction
// qualys-proxy (voir supabase/functions/qualys-proxy/parse.ts pour le calcul).

export interface QualysSeverity {
  severity: 4 | 5;
  slaDays: number;
  total: number;
  overdue: number;
  reopened: number;
  /** Ancienneté depuis la première détection : < 30 j, 30-90 j, 90-180 j, > 180 j. */
  ages: [number, number, number, number];
}

export interface QualysVuln {
  qid: string;
  title: string | null;
  cves: string | null;
  severity: number;
  hosts: number;
  overdue: number;
  firstFound: string | null;
  maxQds: number | null;
  kev: boolean;
  ransomware: boolean;
  activeAttacks: boolean;
  patchable: boolean;
}

export interface QualysHost {
  id: string | null;
  ip: string | null;
  name: string | null;
  os: string | null;
  d5: number;
  d4: number;
  overdue: number;
  qdsCritical: number;
}

export interface QualysResults {
  date: string;
  coverage: {
    total: number; agent: number; scanned: number; neverScanned: number; recentDays: number;
    trurisk: { critical: number; high: number; medium: number; low: number };
  };
  hostsWithVulns: number;
  /** Les champs « sev5 » sont la part de sévérité 5 (absents des photos d'avant le 17/11/2026). */
  hostsWithSev5?: number;
  detections: { total: number; potential: number; qdsCritical: number; qdsCriticalSev5?: number; vulns: number };
  severities: QualysSeverity[];
  kev: { detections: number; vulns: number; sev5?: number };
  ransomware: { detections: number; vulns: number; sev5?: number };
  activeAttacks: { detections: number; vulns: number; sev5?: number };
  criticalPatchable: number;
  criticalPatchableSev5?: number;
  topVulns: QualysVuln[];
  topHosts: QualysHost[];
}

export interface QualysState {
  latest: QualysResults | null;
  running: { startedAt: string; phase: "hosts" | "detections" | "kb" | "final"; pages: number; expected: number | null } | null;
  lastError: string | null;
}

export interface QualysHistoryPoint {
  date: string;
  detections: number; sev5: number; sev4: number; overdue: number;
  kev: number; ransomware: number; qdsCritical: number; coverage: number | null;
}

export const AGE_LABELS = ["< 30 j", "30 à 90 j", "90 à 180 j", "> 180 j"] as const;

export const SEVERITY_LABELS: Record<number, string> = { 5: "Critique (5)", 4: "Élevée (4)" };

/** Part en %, arrondie (null si total nul). */
export function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Nombre lisible : 263 412 -> « 263 412 ». */
export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("fr-FR"));

/** Ancienneté en jours depuis une date ISO. */
export function daysSince(iso: string | null, now = Date.now()): number | null {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86400000)) : null;
}

/** Avancement du calcul en cours, en clair. */
export function progressLabel(r: NonNullable<QualysState["running"]>): string {
  if (r.phase === "hosts") return "inventaire des actifs";
  if (r.phase === "detections") return r.expected ? `vulnérabilités : page ${r.pages} sur ${r.expected}` : `vulnérabilités : page ${r.pages}`;
  if (r.phase === "kb") return "base de connaissances Qualys";
  return "finalisation";
}

export const HISTORY_METRICS: { key: keyof Omit<QualysHistoryPoint, "date">; label: string; lowerIsBetter: boolean; unit?: string }[] = [
  { key: "sev5", label: "Critiques ouvertes", lowerIsBetter: true },
  { key: "kev", label: "Exploitées (CISA KEV)", lowerIsBetter: true },
  { key: "overdue", label: "Hors délai", lowerIsBetter: true },
  { key: "qdsCritical", label: "QDS ≥ 90", lowerIsBetter: true },
  { key: "detections", label: "Sévérité 4 et 5", lowerIsBetter: true },
  { key: "coverage", label: "Couverture des scans", lowerIsBetter: false, unit: "%" },
];
