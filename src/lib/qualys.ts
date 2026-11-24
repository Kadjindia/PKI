// Vulnérabilités Qualys VMDR : photo calculée chaque nuit par la fonction
// qualys-proxy (voir supabase/functions/qualys-proxy/parse.ts pour le calcul).

export interface QualysSeverity {
  severity: 3 | 4 | 5;
  slaDays: number;
  /** Délai de la politique en clair (« 7 jours », « 1 mois ») ; absent des photos d'avant le 20/11/2026. */
  slaLabel?: string;
  total: number;
  overdue: number;
  reopened: number;
  /** Ancienneté depuis la première détection : < 30 j, 30-90 j, 90-180 j, > 180 j. */
  ages: [number, number, number, number];
  /** Âge moyen (jours) des vulnérabilités ouvertes. */
  avgAge?: number | null;
}

export type AssetType = "server" | "workstation" | "other";

/** Vulnérabilités corrigées sur la période : respect des délais et MTTR. */
export interface QualysFixView {
  fixed: number; inSla: number; slaRate: number | null; mttr: number | null; median: number | null;
}

export interface QualysExposure {
  truriskAvg: number | null;
  truriskAssets: number;
  armed: { detections: number; vulns: number; sev5: number; servers: number; exploitPublic: number };
}

export interface QualysOperations {
  windowDays: number;
  fixed: {
    all: QualysFixView;
    bySev: Partial<Record<"3" | "4" | "5", QualysFixView>>;
    byType: Record<AssetType, QualysFixView>;
    /** partial : « start » premier mois coupé par la fenêtre, « current » mois en cours. */
    monthly: { month: string; fixed: number; slaRate: number | null; mttr5: number | null; mttr4: number | null; mttr3?: number | null; partial?: "start" | "current" | null }[];
  };
  open: { byType: Record<AssetType, { total: number; overdue: number; sev5: number }> };
  reopenRate: number | null;
  ignored: { total: number; sev5: number; ages: [number, number, number, number] };
  fixedCollected: boolean;
  fixedError?: string | null;
}

export interface QualysResults {
  date: string;
  /** Détail par actif enregistré (inventaires, fiches) ; erreur éventuelle de son enregistrement. */
  details?: { available: boolean; error: string | null };
  coverage: {
    total: number; agent: number; scanned: number; neverScanned: number; recentDays: number;
    trurisk: { critical: number; high: number; medium: number; low: number };
    byType?: Record<AssetType, { total: number; scanned: number }>;
  };
  hostsWithVulns: number;
  detections: { total: number; potential: number; qdsCritical: number; vulns: number };
  severities: QualysSeverity[];
  kev: { detections: number; vulns: number; sev5?: number };
  ransomware: { detections: number; vulns: number; sev5?: number };
  activeAttacks: { detections: number; vulns: number; sev5?: number };
  /** Axes 2 et 3 (absents des photos d'avant le 19/11/2026). */
  exposure?: QualysExposure;
  operations?: QualysOperations;
  obsolescence?: QualysObsolescence;
  compliance?: QualysCompliance;
  inventory?: QualysInventory;
  internetExposed?: { total: number; byType: Record<AssetType, number> };
  webApps?: QualysWebApps;
}

/** Inventaire CSAM : agents, Shadow IT, fin de support des systèmes d'exploitation. */
export interface QualysInventory {
  collected: boolean;
  error: string | null;
  total: number;
  withAgent: number;
  agentStale: number;
  unmanaged: number;
  unmanagedNew: number;
  publicIp: number;
  byType: Record<AssetType, { total: number; withAgent: number; unmanaged: number }>;
  osEol: number;
  osEos: number;
  osOutdated: { os: string; assets: number; endOfSupport: string | null; endOfLife: string | null }[];
  recentUnmanaged: { id: string; name: string | null; ip: string | null; os: string | null; source: string | null; created: string | null }[];
  agentStaleDays: number;
  newDays: number;
}

/** Applications web (WAS). */
export interface QualysWebApps {
  collected: boolean;
  error: string | null;
  open: number;
  apps: { id: string; name: string; sev5: number; sev4: number; sev3: number; overdue: number }[];
  fixed: QualysFixView;
}

/** Systèmes et logiciels en fin de vie, repérés par VMDR (vulnérabilités « EOL/Obsolete »). */
export interface QualysObsolescence {
  /** Faux la première nuit : le nombre d'actifs s'appuie sur la liste de la photo précédente. */
  hostsTracked: boolean;
  hosts: number;
  byType: Record<AssetType, number>;
  products: number;
  osProducts: number;
  detections: number;
}

/** Conformité et durcissement (Policy Audit). */
export interface QualysCompliance {
  collected: boolean;
  error: string | null;
  rate: number | null;
  passed: number;
  failed: number;
  /** Politiques évaluées cette nuit / au total ; lecture interrompue par le budget de temps (absents des photos d'avant le 20/11/2026). */
  evaluated?: number;
  total?: number;
  stopped?: boolean;
  policies: { id: string; title: string; hosts: number; compliantHosts: number; passed: number; failed: number; errors: number; rate: number | null; evaluatedAt?: string | null; stale?: boolean }[];
  topFailed: { cid: string; statement: string; criticality: string | null; failed: number; rate: number | null; policies: number }[];
}

export interface QualysState {
  latest: QualysResults | null;
  running: { startedAt: string; phase: "hosts" | "detections" | "fixed" | "kb" | "policies" | "posture" | "csam" | "was" | "final"; pages: number; expected: number | null } | null;
  lastError: string | null;
}

export interface QualysHistoryPoint {
  date: string;
  detections: number; sev5: number; sev4: number; sev3?: number; overdue: number;
  kev: number; ransomware: number; qdsCritical: number; coverage: number | null;
  truriskAvg?: number | null; armed?: number; slaRate?: number | null; mttr5?: number | null; ignored?: number;
  eolHosts?: number | null; complianceRate?: number | null; unmanaged?: number | null; webAppsCritical?: number | null;
}

export interface QualysSearchMatch {
  qid: number; severity: number; hosts: number; servers: number; overdue: number;
  first_found: string | null; title: string | null; cves: string | null; flags: number;
}

export interface QualysSearch {
  query: string; date: string | null; matches: QualysSearchMatch[]; trend: { date: string; hosts: number }[];
}

export interface QualysProbe {
  module: string; label: string; purpose: string; status: "ok" | "refused" | "unknown" | "error"; detail: string; count?: number | null;
}

export interface QualysDiagnostic { checkedAt: string; apiBase: string; gateway: string; results: QualysProbe[] }

export const FLAGS = { kev: 1, ransomware: 2, patchable: 4, activeAttacks: 8, exploitPublic: 16 } as const;

export const ASSET_TYPE_LABELS: Record<AssetType, string> = { server: "Serveurs", workstation: "Postes de travail", other: "Autres équipements" };

export const AGE_LABELS = ["< 30 j", "30 à 90 j", "90 à 180 j", "> 180 j"] as const;

export const SEVERITY_LABELS: Record<number, string> = { 5: "Critiques (5)", 4: "Élevées (4)", 3: "Modérées (3)" };

/** Délai de remédiation d'une sévérité, en clair. */
export const slaText = (s: { slaDays: number; slaLabel?: string }) => s.slaLabel ?? `${s.slaDays} jours`;

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
  if (r.phase === "detections") return r.expected ? `vulnérabilités ouvertes : page ${r.pages} sur ${r.expected}` : `vulnérabilités ouvertes : page ${r.pages}`;
  if (r.phase === "fixed") return "vulnérabilités corrigées (délais de correction)";
  if (r.phase === "policies" || r.phase === "posture") return "conformité (Policy Audit)";
  if (r.phase === "csam") return "inventaire des actifs (CSAM)";
  if (r.phase === "was") return "applications web (WAS)";
  if (r.phase === "kb") return "base de connaissances Qualys";
  return "finalisation";
}

export const HISTORY_METRICS: { key: keyof Omit<QualysHistoryPoint, "date">; label: string; lowerIsBetter: boolean; unit?: string }[] = [
  { key: "truriskAvg", label: "Score de risque moyen", lowerIsBetter: true },
  { key: "armed", label: "Vulnérabilités exploitables", lowerIsBetter: true },
  { key: "slaRate", label: "Respect des délais (SLA)", lowerIsBetter: false, unit: "%" },
  { key: "mttr5", label: "MTTR critiques", lowerIsBetter: true, unit: "j" },
  { key: "overdue", label: "Hors délai", lowerIsBetter: true },
  { key: "ignored", label: "Dérogations", lowerIsBetter: true },
  { key: "coverage", label: "Couverture des scans", lowerIsBetter: false, unit: "%" },
  { key: "eolHosts", label: "Actifs en fin de support", lowerIsBetter: true },
  { key: "complianceRate", label: "Taux de conformité", lowerIsBetter: false, unit: "%" },
  { key: "unmanaged", label: "Shadow IT", lowerIsBetter: true },
  { key: "webAppsCritical", label: "Applications : vulnérabilités critiques", lowerIsBetter: true },
];

/** Écart entre la valeur actuelle et la plus ancienne des `days` derniers jours (null si moins de deux points). */
export function trendOver(points: QualysHistoryPoint[], key: keyof Omit<QualysHistoryPoint, "date">, days = 30, now = Date.now()): number | null {
  const series = points.filter((p) => p[key] !== null && p[key] !== undefined && now - Date.parse(p.date) <= days * 86400000);
  if (series.length < 2) return null;
  return Number(series[series.length - 1][key]) - Number(series[0][key]);
}

/** Avancement de la correction d'une faille : part des actifs corrigés depuis le pic observé. */
export function remediationProgress(trend: { hosts: number }[]): { peak: number; now: number; pct: number | null } {
  const peak = Math.max(0, ...trend.map((t) => t.hosts));
  const current = trend.length ? trend[trend.length - 1].hosts : 0;
  return { peak, now: current, pct: peak ? Math.round(((peak - current) / peak) * 100) : null };
}
