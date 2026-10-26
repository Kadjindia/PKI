// Posture des données Varonis (étape 3) : types des résumés renvoyés par
// varonis-proxy ({ action: "posture" }) et mise en forme pour l'affichage.

export type InactiveKey = "inactive90" | "inactive180" | "inactive365" | "inactive730";

export type ZoneIssueKey = "zonesStale" | "zonesStaleAccess" | "zonesStaleOwner" | "zonesDisabledOwner";

export type PostureKey =
  | "sensitiveExposed" | ZoneIssueKey | "dataSources" | "privileged" | InactiveKey | "expiredEnabled";

export const POSTURE_KEYS: PostureKey[] = [
  "sensitiveExposed", "zonesStale", "zonesStaleAccess", "zonesStaleOwner", "zonesDisabledOwner", "dataSources",
  "privileged", "inactive90", "inactive180", "inactive365", "inactive730", "expiredEnabled",
];

/** Préfixe des résultats « total des dossiers sensibles », un par source de données. */
export const ZONES_TOTAL_PREFIX = "zonesTotal:";

/** Tranches d'ancienneté des comptes activés sans connexion récente. */
export const INACTIVE_BUCKETS: { key: InactiveKey; label: string }[] = [
  { key: "inactive90", label: "3 à 6 mois" },
  { key: "inactive180", label: "6 à 12 mois" },
  { key: "inactive365", label: "1 à 2 ans" },
  { key: "inactive730", label: "Plus de 2 ans" },
];

/** Profondeur des zones (dossiers de niveau 3 : partages métier, dossiers personnels). */
export const ZONE_DEPTH = 3;

/** Seuil d'inactivité utilisé par le proxy pour les comptes (jours sans connexion). */
export const INACTIVE_DAYS = 90;

interface Base {
  status: "queued" | "pending" | "done" | "error";
  error?: string; code?: "unauthorized" | "filter" | "timeout" | "other"; field?: string;
  progress?: number | null; partial?: boolean; capped?: boolean; count?: number;
  /** Valeur reprise d'une photo précédente (date de celle-ci) faute de résultat cette fois. */
  carriedFrom?: string; lastError?: string;
}

export interface ExposedFolder {
  name?: string | null; path?: string | null; sharePath?: string | null; url?: string | null;
  source?: string | null; sourceName?: string | null;
  objects?: number | null; sizeBytes?: number | null;
  ownerIssue: boolean; isStale: boolean; lastEventDate?: string | null;
}

/** Total d'un ensemble de zones. */
export interface ZoneTotals { count: number; sizeBytes: number; files: number }

export interface Zone {
  name?: string | null; path?: string | null; sharePath?: string | null; url?: string | null;
  source?: string | null; sourceName?: string | null;
  sizeBytes?: number | null; files?: number | null;
  isStale: boolean; staleAccess: boolean; ownerIssue: boolean;
  staleOwner?: boolean; disabledOwner?: boolean;
}

/** Résultat d'une recherche de dossiers (nombre unique et volume). */
export type ZoneResult = Base & Partial<ZoneTotals> & { lines?: number; top?: Zone[]; split?: boolean };

export interface PostureResults {
  sensitiveExposed?: Base & { withoutValidOwner?: number; top?: ExposedFolder[] };
  zonesStale?: ZoneResult;
  zonesStaleAccess?: ZoneResult;
  zonesStaleOwner?: ZoneResult;
  zonesDisabledOwner?: ZoneResult;
  dataSources?: Base & { sources?: { id: string; name?: string | null; type?: string | null }[]; expanded?: boolean };
  privileged?: Base & {
    byType?: { type: string; count: number }[];
    admins?: number;
    stale?: number;
    services?: number;
    servicesStale?: number;
    staleList?: { name?: string | null; types: string[]; lastLogonTime?: string | null }[];
  };
  inactive90?: Base;
  inactive180?: Base;
  inactive365?: Base;
  inactive730?: Base;
  expiredEnabled?: Base;
  /** Total des dossiers sensibles, une entrée par source de données (« zonesTotal:<id> »). */
  [key: `zonesTotal:${string}`]: ZoneResult | undefined;
}

/**
 * Total des dossiers sensibles (somme des recherches par source de données) et
 * les plus volumineux toutes sources confondues. En cours tant que la liste des
 * sources ou l'une des recherches n'est pas terminée.
 */
export function zoneTotal(r: PostureResults, topSize = 15): ZoneResult {
  const ds = r.dataSources;
  if (!ds || ds.status === "queued" || ds.status === "pending") return { status: ds?.status ?? "queued" };
  if (ds.status === "error") return ds;
  // Une partition redécoupée par taille est remplacée par ses deux moitiés
  const parts = Object.keys(r).filter((k) => k.startsWith(ZONES_TOTAL_PREFIX))
    .map((k) => r[k as `zonesTotal:${string}`]!).filter((p) => !p.split);
  if (!ds.expanded || parts.some((p) => p.status === "queued" || p.status === "pending")) {
    return { status: "pending", progress: null };
  }
  const failed = parts.find((p) => p.status === "error");
  if (failed) return failed;
  return {
    status: "done",
    count: parts.reduce((t, p) => t + (p.count ?? 0), 0),
    sizeBytes: parts.reduce((t, p) => t + (p.sizeBytes ?? 0), 0),
    files: parts.reduce((t, p) => t + (p.files ?? 0), 0),
    capped: parts.some((p) => p.capped),
    top: parts.flatMap((p) => p.top ?? []).sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)).slice(0, topSize),
  };
}

/** Total des comptes inactifs encore activés (toutes tranches), si toutes sont terminées. */
export function inactiveTotal(r: PostureResults): { count?: number; capped: boolean } {
  const parts = INACTIVE_BUCKETS.map((b) => r[b.key]);
  if (parts.some((p) => p?.status !== "done")) return { count: undefined, capped: false };
  return { count: parts.reduce((t, p) => t + (p!.count ?? 0), 0), capped: parts.some((p) => p!.capped) };
}

/** Nombre affiché : « 15 000 ou plus » quand l'API a plafonné les résultats. */
export function formatCount(n: number | undefined, capped?: boolean): string {
  if (n === undefined) return "—";
  return `${n.toLocaleString("fr-FR")}${capped && n > 0 ? " ou plus" : ""}`;
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

/** Photo de posture enregistrée côté serveur (table varonis_posture_snapshots). */
export interface PostureSnapshot {
  id: string;
  status: "running" | "done";
  trigger: "manual" | "schedule";
  results: PostureResults;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PostureState {
  latest: PostureSnapshot | null;
  running: PostureSnapshot | null;
  /** Vrai si la tâche planifiée est configurée (le calcul continue sans l'écran). */
  scheduled: boolean;
}

/** Avancement d'une photo : recherches terminées (ou en échec) sur le total prévu. */
export function snapshotProgress(results: PostureResults): { done: number; total: number } {
  const entries = Object.values(results).filter(Boolean) as Base[];
  return { done: entries.filter((e) => e.status === "done" || e.status === "error").length, total: entries.length };
}

/** Vrai si toutes les requêtes terminées ont échoué faute de droits sur la clé d'API. */
export function allUnauthorized(results: PostureResults): boolean {
  const finished = POSTURE_KEYS.map((k) => results[k]).filter((r) => r && (r.status === "done" || r.status === "error"));
  return finished.length > 0 && finished.every((r) => r!.status === "error" && (r!.code === "unauthorized" || r!.code === "filter"));
}

/** Message court affiché dans un bloc en erreur. */
export function shortError(r: { code?: string; field?: string; error?: string }): string {
  if (r.code === "unauthorized") return "Droits Varonis insuffisants";
  if (r.code === "filter") return `Filtre « ${r.field} » refusé par Varonis`;
  if (r.code === "timeout") return "Varonis n'a pas répondu à temps";
  return r.error ?? "Erreur";
}

/** Durée lisible : « 45 s », « 3 min 05 s ». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60), sec = total % 60;
  return m === 0 ? `${sec} s` : `${m} min ${String(sec).padStart(2, "0")} s`;
}

/** Ancienneté lisible : « il y a 5 min », « il y a 3 h », « il y a 2 j ». */
export function formatAge(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 48 * 60) return `il y a ${Math.floor(min / 60)} h`;
  return `il y a ${Math.floor(min / 1440)} j`;
}

/** Libellé lisible du type de source Varonis (SharePoint, OneDrive, partage de fichiers…). */
export function sourceLabel(type?: string | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes("onedrive")) return "OneDrive";
  if (t.includes("sharepoint") || t === "spo") return "SharePoint";
  if (t.includes("exchange") || t.includes("mail")) return "Messagerie";
  if (t.includes("teams")) return "Teams";
  if (t.includes("windows") || t.includes("cifs") || t.includes("smb") || t.includes("nas") || t.includes("file")) return "Partage de fichiers";
  return type;
}
