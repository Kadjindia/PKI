// Posture des données Varonis (étape 3) : types des résumés renvoyés par
// varonis-proxy ({ action: "posture" }) et mise en forme pour l'affichage.

export type PostureKey =
  | "sensitiveExposed" | "sensitive" | "sensitiveStaleOwner" | "sensitiveDisabledOwner" | "sensitiveStale"
  | "privileged" | "staleUsers" | "expiredEnabled" | "staleMemberships" | "stalePermissions";

export const POSTURE_KEYS: PostureKey[] = [
  "sensitiveExposed", "sensitive", "sensitiveStaleOwner", "sensitiveDisabledOwner", "sensitiveStale",
  "privileged", "staleUsers", "expiredEnabled", "staleMemberships", "stalePermissions",
];

/** Seuil d'inactivité utilisé par le proxy pour les comptes (jours sans connexion). */
export const INACTIVE_DAYS = 90;

interface Base { status: "pending" | "done" | "error"; error?: string; code?: "unauthorized" | "filter" | "timeout" | "other"; field?: string; jobId?: string; progress?: number | null; partial?: boolean; capped?: boolean; count?: number }

export interface ExposedFolder {
  name?: string | null; path?: string | null; sharePath?: string | null; url?: string | null;
  objects?: number | null; sizeBytes?: number | null;
  ownerIssue: boolean; isStale: boolean; lastEventDate?: string | null;
}

export interface PostureResults {
  sensitiveExposed?: Base & { withoutValidOwner?: number; top?: ExposedFolder[] };
  sensitive?: Base;
  sensitiveStaleOwner?: Base;
  sensitiveDisabledOwner?: Base;
  sensitiveStale?: Base;
  privileged?: Base & {
    byType?: { type: string; count: number }[];
    stale?: number;
    staleList?: { name?: string | null; types: string[]; lastLogonTime?: string | null }[];
  };
  staleUsers?: Base;
  expiredEnabled?: Base;
  staleMemberships?: Base;
  stalePermissions?: Base;
}

/** Nombre affiché : « 15 000 ou plus » quand l'API a plafonné les résultats. */
export function formatCount(n: number | undefined, capped?: boolean): string {
  if (n === undefined) return "—";
  return `${n.toLocaleString("fr-FR")}${capped && n > 0 ? " ou plus" : ""}`;
}

/** Somme de deux indicateurs (plafonnée si l'un l'est). */
export function sumCounts(a?: Base, b?: Base): { count?: number; capped: boolean } {
  if (a?.status !== "done" || b?.status !== "done") return { count: undefined, capped: false };
  return { count: (a.count ?? 0) + (b.count ?? 0), capped: Boolean(a.capped || b.capped) };
}

/** Chemin le plus parlant d'un dossier : partage réseau (\\SERVEUR\partage) ou chemin local. */
export function displayPath(f: { sharePath?: string | null; path?: string | null }): string {
  return f.sharePath || f.path || "";
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

const PRIVILEGED_LABELS: Record<string, string> = {
  ADMIN: "Administrateurs",
  ADMINISTRATOR: "Administrateurs",
  SERVICE: "Comptes de service",
  SERVICE_ACCOUNT: "Comptes de service",
  EXECUTIVE: "Dirigeants",
  EXECUTIVES: "Dirigeants",
};

export function privilegedLabel(type: string): string {
  return PRIVILEGED_LABELS[type.toUpperCase()] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Part en %, arrondie (null si total nul). */
export function share(part?: number, total?: number): number | null {
  if (!total || part === undefined) return null;
  return Math.round((part / total) * 100);
}

/** Lien externe utilisable seulement s'il est en http(s). */
export function safeUrl(u?: string | null): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

/** Fusionne une réponse de vérification dans les résultats déjà obtenus. */
export function mergePosture(prev: PostureResults, next: PostureResults): PostureResults {
  return { ...prev, ...next };
}

/** Jobs encore en cours, à revérifier : { clé: jobId }. */
export function pendingJobs(results: PostureResults): Record<string, string> {
  const jobs: Record<string, string> = {};
  for (const key of POSTURE_KEYS) {
    const r = results[key];
    if (r?.status === "pending" && r.jobId) jobs[key] = r.jobId;
  }
  return jobs;
}

/** Vrai si toutes les requêtes terminées ont échoué faute de droits sur la clé d'API. */
export function allUnauthorized(results: PostureResults): boolean {
  const finished = POSTURE_KEYS.map((k) => results[k]).filter((r) => r && r.status !== "pending");
  return finished.length > 0 && finished.every((r) => r!.status === "error" && (r!.code === "unauthorized" || r!.code === "filter"));
}

/** Message court affiché dans un bloc en erreur. */
export function shortError(r: { code?: string; field?: string; error?: string }): string {
  if (r.code === "unauthorized") return "Droits Varonis insuffisants";
  if (r.code === "filter") return `Filtre « ${r.field} » refusé par Varonis`;
  if (r.code === "timeout") return "Toujours en cours chez Varonis : réessayez plus tard";
  return r.error ?? "Erreur";
}

/** Passe en erreur « délai dépassé » les indicateurs encore en cours. */
export function expirePending(results: PostureResults): PostureResults {
  const out: PostureResults = { ...results };
  for (const key of POSTURE_KEYS) {
    if (out[key]?.status === "pending") out[key] = { status: "error", code: "timeout" };
  }
  return out;
}

/** Durée lisible : « 45 s », « 3 min 05 s ». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60), sec = total % 60;
  return m === 0 ? `${sec} s` : `${m} min ${String(sec).padStart(2, "0")} s`;
}
