import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Secrets configurés côté Supabase (Project Settings > Edge Functions > Secrets) ---
const VARONIS_BASE_URL = Deno.env.get("VARONIS_BASE_URL"); // ex: https://tenant.varonis.io
const VARONIS_API_KEY = Deno.env.get("VARONIS_API_KEY");
// Secret partagé avec la tâche planifiée (pg_cron) qui calcule la posture
const POSTURE_CRON_SECRET = Deno.env.get("POSTURE_CRON_SECRET");

// Confirmé via la doc officielle Varonis (API Reference > Authentication / Alerts)
const AUTH_ENDPOINT = "/api/authentication/api_keys/token";
const GRAPHQL_ENDPOINT = "/api/graphql";

// Le job Varonis peut prendre plusieurs minutes : la fonction ne l'attend pas.
// Elle lance le job (ou vérifie un job existant) et répond tout de suite :
//   { status: "pending", jobId, jobProgress }   -> le front rappelle avec { jobId }
//   { status: "done", jobStatus, jobProgress, alerts }
const JOB_ID_PATTERN = /^[\w-]{1,128}$/;
const TYPE_NAME_PATTERN = /^[A-Za-z_]\w{0,63}$/;

// IMPORTANT (confirmé par le support Varonis) : les champs doivent être
// demandés dans alertsAsync ET dans alertsQueryJob, sinon ils reviennent
// null dans alertsQueryJob même s'ils y sont bien listés.
const ALERT_RESULT_FIELDS = `
  id
  status
  eventsCount
  hasSensitiveResource
  hasTaggedResource
  isAssignedToVaronis
  generationTime { dateTimeUtc }
  policy {
    id
    name
    severity
    category
  }
  closeReason { id name }
  closedBy { name }
  dataSource { id name type }
  escalationType
  url
`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // à restreindre en prod
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Erreur Varonis avec le code HTTP, pour reconnaître la limite de requêtes. */
class VaronisError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Vrai si Varonis refuse parce que trop de requêtes ont été envoyées. */
function isRateLimited(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return (e instanceof VaronisError && e.status === 429) || /too many requests|rate.?limit|throttl|quota/i.test(msg);
}

/** Étape 1 : échange la clé API Varonis contre un bearer token de courte durée. */
async function getVaronisAccessToken(baseUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${baseUrl}${AUTH_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": apiKey,
    },
    body: "grant_type=varonis_custom",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new VaronisError(`Échec authentification Varonis (${res.status}): ${text}`, res.status);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Réponse d'authentification Varonis sans access_token");
  }
  return data.access_token as string;
}

/** Appel générique à l'API GraphQL Varonis, une fois authentifié. */
async function callVaronisGraphQL(baseUrl: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${GRAPHQL_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await res.json().catch(() => ({ errors: [`Réponse HTTP ${res.status} illisible`] }));

  if (!res.ok || data.errors) {
    throw new VaronisError(`Erreur GraphQL Varonis: ${JSON.stringify(data.errors ?? data)}`, res.status);
  }

  return data.data;
}

/** Étape 2 : lance le job de récupération des alertes. */
async function startAlertsJob(baseUrl: string, token: string): Promise<string> {
  const query = `
    query alertsAsync($where: Alert_FilterInput!) {
      alertsAsync(where: $where) {
        jobId
        jobStatus
        jobProgress
        results {
          ${ALERT_RESULT_FIELDS}
        }
      }
    }
  `;
  // NOTE: filtre vide volontairement — la syntaxe exacte des opérateurs
  // (eq/in/gte...) des sous-types de filtre n'est pas encore confirmée.
  // On récupère tout et on filtre côté client si besoin.
  const data = await callVaronisGraphQL(baseUrl, token, query, { where: {} });
  return data.alertsAsync.jobId;
}

/**
 * Mode diagnostic (lecture seule) : liste les champs d'un type GraphQL
 * Varonis (ex. "Alert"), pour connaître les noms exacts avant de les
 * demander dans les requêtes d'alertes.
 */
async function describeType(baseUrl: string, token: string, typeName: string) {
  const query = `
    query describe($name: String!) {
      __type(name: $name) {
        name
        kind
        fields {
          name
          description
          type { name kind ofType { name kind ofType { name kind } } }
          args { name type { name kind ofType { name kind ofType { name kind } } } }
        }
        inputFields { name type { name kind ofType { name kind ofType { name kind } } } }
        enumValues { name }
      }
    }
  `;
  const data = await callVaronisGraphQL(baseUrl, token, query, { name: typeName });
  return data.__type;
}

/**
 * Mode diagnostic (lecture seule) : recherches planifiées Varonis et résultat
 * de leur dernière exécution (nombre de lignes exact). Le lien de
 * téléchargement (dataUrl, utilisable sans jeton) n'est volontairement pas lu.
 */
async function listScheduledSearches(baseUrl: string, token: string) {
  const query = `
    query scheduled {
      scheduledSearches {
        id
        name
        enabled
        nextExecutionTime
        lastExecution {
          id
          status
          time
          results {
            id
            name
            status
            rowCount
            size
            containsData
            time
            linkedSavedSearch { id name }
          }
        }
      }
    }
  `;
  const data = await callVaronisGraphQL(baseUrl, token, query, {});
  const searches: Row[] = data.scheduledSearches ?? [];

  // Détail des exécutions (les résultats ne sont pas toujours fournis par lastExecution)
  const ids = searches.map((s) => String(s.id)).filter((id) => /^[\w-]{1,64}$/.test(id));
  let executions: unknown = null;
  if (ids.length > 0) {
    try {
      const execQuery = `
        query executions {
          scheduledSearchExecutions(scheduledSearchIds: ${JSON.stringify(ids)}) {
            id
            status
            time
            scheduledSearch { id name }
            results {
              id
              name
              status
              rowCount
              size
              containsData
              time
              linkedSavedSearch { id name }
            }
          }
        }
      `;
      executions = (await callVaronisGraphQL(baseUrl, token, execQuery, {})).scheduledSearchExecutions;
    } catch (e) {
      executions = { error: (e as Error).message.slice(0, 500) };
    }
  }
  return { searches, executions };
}

/** Étape 3 : interroge une fois l'état du job (sans attendre). */
async function checkAlertsJob(baseUrl: string, token: string, jobId: string) {
  const query = `
    query alertsQueryJob($jobId: ID!) {
      alertsQueryJob(jobId: $jobId) {
        jobId
        jobStatus
        jobProgress
        results {
          ${ALERT_RESULT_FIELDS}
        }
      }
    }
  `;

  const data = await callVaronisGraphQL(baseUrl, token, query, { jobId });
  const job = data.alertsQueryJob;

  if (job.jobStatus === "FAILED" || job.jobStatus === "CANCELED") {
    throw new Error(`Le job Varonis a échoué (statut: ${job.jobStatus})`);
  }
  return job;
}

// ---------------------------------------------------------------------------
// Posture des données (étape 3) : requêtes fixes, exécutées par étapes (voir plus bas).
// Le proxy calcule lui-même les totaux et les tops : le navigateur ne reçoit
// qu'un résumé. Les champs sont demandés dans la requête *Async ET dans la
// requête *QueryJob (consigne du support Varonis).
// ---------------------------------------------------------------------------

/**
 * Plafond de résultats de l'API par requête (10 000 à 15 000 selon la requête) :
 * à partir de 10 000 lignes reçues, le total est affiché comme un minimum.
 */
const RESULT_CAP = 10000;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface PostureQuery {
  asyncName: string;
  jobName: string;
  where: Record<string, unknown>;
  fields: string;
  /** Résumé des lignes reçues ; ref = heure de début de la photo (référence des dates). */
  summarize: (rows: Row[], ref: number) => Record<string, unknown>;
  /** Complète le filtre au lancement (ex. valeur d'énumération lue dans le schéma). */
  resolveWhere?: (baseUrl: string, token: string, ref: number) => Promise<Record<string, unknown>>;
}

/**
 * Valeur d'une énumération GraphQL Varonis choisie par motif (ex. « Expired »),
 * lue dans le schéma du tenant pour ne pas dépendre de son orthographe exacte.
 */
async function enumValue(baseUrl: string, token: string, typeName: string, pattern: RegExp): Promise<string> {
  const data = await callVaronisGraphQL(baseUrl, token, `query e($n: String!) { __type(name: $n) { enumValues { name } } }`, { n: typeName });
  const values: string[] = (data.__type?.enumValues ?? []).map((v: Row) => v.name);
  const found = values.find((v) => pattern.test(v));
  if (!found) throw new Error(`Valeur introuvable dans ${typeName} (valeurs : ${values.join(", ") || "aucune"})`);
  return found;
}

const yes = { eq: true };
const enabledOnly = { in: [false] }; // filtre isDisabled : s'écrit avec « in », pas « eq »
const count = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).length;

/** Seuil d'inactivité des comptes (jours sans connexion). */
const INACTIVE_DAYS = 90;
const DAY = 24 * 3600 * 1000;
const inactiveSince = (lastLogon?: string | null) =>
  !lastLogon || Date.now() - new Date(lastLogon).getTime() > INACTIVE_DAYS * DAY;

/**
 * Profondeur des « zones » : dossiers de niveau 3, c'est-à-dire les partages
 * métier et les dossiers personnels (ex. D:\Shares\Partage_Finance, D:\Users\ALEX).
 * À cette maille, les volumes restent loin du plafond de l'API : chiffres exacts.
 */
const ZONE_DEPTH = 3;

/**
 * Dédoublonne les ressources par couple source de données + chemin (précaution :
 * en pratique chaque ligne est une ressource distincte). Le total correspond aux
 * « Results » de la console ; « Unique resources » y désigne autre chose
 * (dossiers à permissions propres, non héritées).
 */
function uniqueResources(rows: Row[]): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.dataSource?.id ?? ""}|${r.path ?? r.id}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/** Total d'un ensemble de zones : nombre, taille et nombre de fichiers. */
function zoneTotals(rows: Row[]) {
  return {
    count: rows.length,
    sizeBytes: rows.reduce((t, r) => t + (r.sizeOfResourceAndNestedResources ?? 0), 0),
    files: rows.reduce((t, r) => t + (r.numberOfNestedFiles ?? 0), 0),
  };
}

/**
 * Comptes activés sans connexion récente, par tranche d'ancienneté. Chaque tranche
 * est une recherche distincte (sous le plafond) filtrée par « between » ; la tranche
 * est revérifiée ici sur la date de dernière connexion.
 */
const INACTIVE_BUCKETS: { key: string; from: number; to: number | null }[] = [
  { key: "inactive90", from: 90, to: 180 },
  { key: "inactive180", from: 180, to: 365 },
  { key: "inactive365", from: 365, to: 730 },
  { key: "inactive730", from: 730, to: null },
];

/**
 * Inventaire des comptes : champs lus pour chaque identité (types simples
 * uniquement, d'après le schéma User du tenant) et format compact enregistré.
 */
const IDENTITY_FIELDS = "id name samAccountName userPrincipalName email department jobTitle company description distinguishedName "
  + "lastLogonTime lastActivityDate passwordLastSet passwordExpirationStatus expirationDate expirationStatus creationDate "
  + "isDisabled isStale isLockedOut privilegedIdentityType mfaMethod type entraIDRole { name } exoRoleGroup { name }";

function toAccount(r: Row) {
  const out: Row = {
    name: r.name, sam: r.samAccountName, upn: r.userPrincipalName, email: r.email,
    department: r.department, jobTitle: r.jobTitle, company: r.company, description: r.description,
    dn: r.distinguishedName, lastLogon: r.lastLogonTime, lastActivity: r.lastActivityDate,
    pwdLastSet: r.passwordLastSet, pwdStatus: r.passwordExpirationStatus,
    expiration: r.expirationDate, expirationStatus: r.expirationStatus, created: r.creationDate,
    stale: r.isStale, lockedOut: r.isLockedOut, privileged: r.privilegedIdentityType, mfa: r.mfaMethod, type: r.type,
    // Rôles d'administration Microsoft 365 (Entra ID) et groupes de rôles Exchange Online
    entraRoles: (r.entraIDRole ?? []).map((x: Row) => x?.name).filter(Boolean),
    exchangeRoles: (r.exoRoleGroup ?? []).map((x: Row) => x?.name).filter(Boolean),
  };
  // Champs vides retirés : l'inventaire peut compter des milliers de comptes
  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined || (Array.isArray(out[k]) && out[k].length === 0)) delete out[k];
  return out;
}

/** Borne basse de la dernière tranche (« plus de 2 ans ») : 30 ans. */
const OLDEST_LOGON_DAYS = 30 * 365;
const daysAgoIso = (ref: number, days: number) => new Date(ref - days * DAY).toISOString();

function inactiveBucketQuery(from: number, to: number | null): PostureQuery {
  return {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isDisabled: enabledOnly },
    // Tranche exacte : dernière connexion entre (début de la photo - to) et (début de la
    // photo - from). Toutes les tranches partent de la même heure : elles sont jointives.
    resolveWhere: (_baseUrl, _token, ref) => Promise.resolve({
      isDisabled: enabledOnly,
      lastLogonTime: { between: { from: daysAgoIso(ref, to ?? OLDEST_LOGON_DAYS), to: daysAgoIso(ref, from) } },
    }),
    fields: IDENTITY_FIELDS,
    summarize: (rows, ref) => {
      const now = ref;
      const ageOf = (r: Row) => (now - new Date(r.lastLogonTime).getTime()) / DAY;
      const dated = rows.filter((r) => r.lastLogonTime);
      const ages = dated.map(ageOf).sort((a, b) => a - b);
      const inBucket = rows.filter((r) => {
        if (r.isDisabled || !r.lastLogonTime) return false;
        const days = ageOf(r);
        return days > from && (to === null || days <= to);
      });
      return {
        count: inBucket.length,
        items: inBucket.map(toAccount),
        // Diagnostic : ce que Varonis a réellement renvoyé pour cette tranche
        diag: {
          received: rows.length,
          noLogonDate: rows.length - dated.length,
          disabled: count(rows, (r) => r.isDisabled),
          newerThanRange: ages.filter((d) => d <= from).length,
          olderThanRange: to === null ? 0 : ages.filter((d) => d > to).length,
          youngestDays: ages.length ? Math.round(ages[0]) : null,
          oldestDays: ages.length ? Math.round(ages[ages.length - 1]) : null,
        },
      };
    },
  };
}

const ZONE_FIELDS = "id name path sharePaths url dataSource { id name type } sizeOfResourceAndNestedResources numberOfNestedFiles isStaleIncludingSubfolders hasStaleAccess "
  + "resourceOwner { isStale isDisabled name samAccountName userPrincipalName email department jobTitle company }";

/** Propriétaires des dossiers : un élément par compte, avec ses dossiers (les 50 plus gros). */
function ownersOf(rows: Row[]) {
  const byOwner = new Map<string, { owner: Row; folders: Row[] }>();
  for (const r of rows) {
    const o = r.resourceOwner ?? {};
    const key = String(o.samAccountName || o.userPrincipalName || o.name || "?");
    if (!byOwner.has(key)) byOwner.set(key, { owner: o, folders: [] });
    byOwner.get(key)!.folders.push(r);
  }
  return [...byOwner.values()].map(({ owner, folders }) => ({
    name: owner.name, sam: owner.samAccountName, upn: owner.userPrincipalName, email: owner.email,
    department: owner.department, jobTitle: owner.jobTitle, company: owner.company,
    stale: owner.isStale, disabled: owner.isDisabled,
    folderCount: folders.length,
    sizeBytes: folders.reduce((t, f) => t + (f.sizeOfResourceAndNestedResources ?? 0), 0),
    folders: [...folders]
      .sort((a, b) => (b.sizeOfResourceAndNestedResources ?? 0) - (a.sizeOfResourceAndNestedResources ?? 0))
      .slice(0, 50)
      .map((f) => ({ path: (f.sharePaths ?? [])[0] ?? f.path, sizeBytes: f.sizeOfResourceAndNestedResources })),
  })).sort((a, b) => b.folderCount - a.folderCount);
}

/** Propriétaire du dossier (compte du système de fichiers) inactif ou désactivé. */
const ownerStale = (r: Row) => Boolean(r.resourceOwner?.isStale);
const ownerDisabled = (r: Row) => Boolean(r.resourceOwner?.isDisabled);

/**
 * Champs réduits pour la recherche « droits inutilisés » : avec les champs
 * complets (propriétaire détaillé, indicateurs calculés), Varonis ne la termine
 * pas. Le filtre garantit déjà que ces dossiers ont des droits inutilisés.
 */
const LIGHT_ZONE_FIELDS = "id name path sharePaths dataSource { id name type } sizeOfResourceAndNestedResources numberOfNestedFiles";

/** Les plus volumineux d'une liste de dossiers, au format affiché par l'écran. */
function topZones(rows: Row[], size = 15, known: Row = {}) {
  return [...rows]
    .sort((a, b) => (b.sizeOfResourceAndNestedResources ?? 0) - (a.sizeOfResourceAndNestedResources ?? 0))
    .slice(0, size)
    .map((r) => ({
      name: r.name, path: r.path, sharePath: (r.sharePaths ?? [])[0] ?? null, url: r.url,
      source: r.dataSource?.type ?? null, sourceName: r.dataSource?.name ?? null,
      sizeBytes: r.sizeOfResourceAndNestedResources, files: r.numberOfNestedFiles,
      isStale: Boolean(r.isStaleIncludingSubfolders), staleAccess: Boolean(r.hasStaleAccess),
      staleOwner: ownerStale(r), disabledOwner: ownerDisabled(r),
      ownerIssue: ownerStale(r) || ownerDisabled(r),
      ...known, // ce que le filtre de la recherche garantit
    }));
}

/** Dossiers sensibles de niveau 3 présentant un point à traiter : nombre, volume et les plus gros. */
function zoneIssueQuery(extra: Record<string, unknown>, withOwners = false, light: Row | null = null): PostureQuery {
  return {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes, pathDepth: { eq: ZONE_DEPTH }, ...extra },
    fields: light ? LIGHT_ZONE_FIELDS : ZONE_FIELDS,
    summarize: (all) => {
      const rows = uniqueResources(all);
      return { ...zoneTotals(rows), lines: all.length, top: topZones(rows, 15, light ?? {}), ...(withOwners ? { owners: ownersOf(rows) } : {}) };
    },
  };
}

/** Préfixe des recherches « total des dossiers sensibles », une par source de données. */
const ZONES_TOTAL_PREFIX = "zonesTotal:";

/**
 * Bornes de taille d'une partition (octets, intervalle ]lo ; hi[). Une source qui
 * atteint le plafond est redécoupée en deux par taille de dossier, à mi-chemin
 * sur une échelle logarithmique, jusqu'à passer sous le plafond.
 */
const SIZE_MIN = -1;
const SIZE_MAX = Number.MAX_SAFE_INTEGER;

/** Clé d'une partition : « zonesTotal:<source> » ou « zonesTotal:<source>:<lo>:<hi> ». */
function parseZonesTotalKey(key: string): { source: number; lo: number; hi: number; sized: boolean } | null {
  const m = key.slice(ZONES_TOTAL_PREFIX.length).match(/^(\d+)(?::(-?\d+):(\d+))?$/);
  if (!m) return null;
  return { source: Number(m[1]), lo: m[2] ? Number(m[2]) : SIZE_MIN, hi: m[3] ? Number(m[3]) : SIZE_MAX, sized: Boolean(m[2]) };
}

/**
 * Découpage par taille de la dernière photo terminée : source → clés des partitions.
 * N'est retenu que s'il couvre toute l'échelle de tailles sans trou (sinon on repart
 * de zéro pour cette source).
 */
async function previousPartitions(admin: Admin): Promise<Map<number, string[]>> {
  const { data } = await admin.from("varonis_posture_snapshots").select("summary")
    .eq("status", "done").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const bySource = new Map<number, { lo: number; hi: number; key: string }[]>();
  for (const key of (data?.summary?.partitions ?? []) as string[]) {
    const k = parseZonesTotalKey(String(key));
    if (!k?.sized) continue;
    if (!bySource.has(k.source)) bySource.set(k.source, []);
    bySource.get(k.source)!.push({ lo: k.lo, hi: k.hi, key: String(key) });
  }
  const result = new Map<number, string[]>();
  for (const [source, parts] of bySource) {
    parts.sort((a, b) => a.lo - b.lo);
    // Contiguïté : chaque tranche ]lo ; hi[ enchaîne avec la suivante (hi - 1 = lo suivant)
    const covers = parts[0].lo === SIZE_MIN && parts[parts.length - 1].hi === SIZE_MAX
      && parts.every((p, i) => i === 0 || parts[i - 1].hi - 1 === p.lo);
    if (covers) result.set(source, parts.map((p) => p.key));
  }
  return result;
}

/** Coupe ]lo ; hi[ en deux (moyenne géométrique), ou null si l'intervalle ne se coupe plus. */
function splitSizeRange(lo: number, hi: number): [number, number, number] | null {
  const mid = Math.round(Math.sqrt(Math.max(1, lo + 1) * hi));
  return mid > lo + 1 && mid < hi ? [lo, mid, hi] : null;
}

/** Dossiers sensibles de niveau 3 d'une source (et d'une tranche de taille) : total, volume, les plus gros. */
function zonesTotalQuery(sourceId: number, lo = SIZE_MIN, hi = SIZE_MAX, sized = false): PostureQuery {
  return {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: {
      isSensitive: yes, pathDepth: { eq: ZONE_DEPTH }, dataSource: { id: { eq: sourceId } },
      ...(sized ? { sizeOfResourceAndNestedResources: { gt: lo, lt: hi } } : {}),
    },
    fields: ZONE_FIELDS,
    summarize: (all) => {
      const rows = uniqueResources(all);
      return {
        ...zoneTotals(rows),
        lines: all.length,
        top: topZones(rows),
      };
    },
  };
}

const POSTURE_QUERIES: Record<string, PostureQuery> = {
  // Dossiers sensibles exposés à toute l'organisation (racines d'accès ouvert)
  sensitiveExposed: {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes, isRootOrgWideExposed: yes },
    fields: "id name path sharePaths url sizeOfResourceAndNestedResources totalNumberOfNestedObjects resourceOwner { isStale isDisabled } isStale lastEventDate dataSource { id name type }",
    summarize: (all) => {
      const rows = uniqueResources(all); // une même ressource peut remonter par plusieurs chemins
      return {
        count: rows.length,
        withoutValidOwner: count(rows, (r) => ownerStale(r) || ownerDisabled(r)),
        top: [...rows]
          .sort((a, b) => (b.totalNumberOfNestedObjects ?? 0) - (a.totalNumberOfNestedObjects ?? 0))
          .slice(0, 10)
          .map((r) => ({
            name: r.name, path: r.path, sharePath: (r.sharePaths ?? [])[0] ?? null, url: r.url,
            source: r.dataSource?.type ?? null, sourceName: r.dataSource?.name ?? null,
            objects: r.totalNumberOfNestedObjects, sizeBytes: r.sizeOfResourceAndNestedResources,
            ownerIssue: ownerStale(r) || ownerDisabled(r), isStale: Boolean(r.isStale),
            lastEventDate: r.lastEventDate,
          })),
      };
    },
  },
  // Dossiers sensibles de niveau 3, une recherche par point à traiter (filtrée
  // chez Varonis : chaque résultat reste loin du plafond)
  zonesStale: zoneIssueQuery({ isStaleIncludingSubfolders: yes }),
  zonesStaleAccess: zoneIssueQuery({ hasStaleAccess: yes }, false, { staleAccess: true }),
  // Propriétaire du dossier (compte du système de fichiers) inactif ou désactivé,
  // comme « Stale / Disabled account (Resource owner) » dans la console
  zonesStaleOwner: zoneIssueQuery({ resourceOwner: { isStale: yes } }, true), // « eq » ici, « in » pour isDisabled
  zonesDisabledOwner: zoneIssueQuery({ resourceOwner: { isDisabled: { in: [true] } } }, true),
  // Liste des sources de données : sert à découper le total des dossiers
  // sensibles (trop de lignes pour une seule recherche), voir zonesTotalQuery
  dataSources: {
    asyncName: "dataSourcesAsync",
    jobName: "dataSourcesQueryJob",
    where: {},
    fields: "id name type isDecommissioned",
    summarize: (rows) => {
      const active = rows.filter((r) => !r.isDecommissioned && r.id !== null && r.id !== undefined);
      return { count: active.length, sources: active.map((r) => ({ id: String(r.id), name: r.name ?? null, type: r.type ?? null })) };
    },
  },
  // Comptes privilégiés activés : administrateurs et comptes de service, séparés
  privileged: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { privilegedIdentityType: { hasValue: true }, isDisabled: enabledOnly },
    fields: IDENTITY_FIELDS,
    summarize: (all) => {
      const rows = all.filter((r) => !r.isDisabled);
      const types = (r: Row) => (r.privilegedIdentityType ?? []) as string[];
      const byType = new Map<string, number>();
      for (const r of rows) for (const t of types(r)) byType.set(t, (byType.get(t) ?? 0) + 1);
      const admins = rows.filter((r) => types(r).includes("ADMIN"));
      const services = rows.filter((r) => types(r).includes("SERVICE") && !types(r).includes("ADMIN"));
      const inactiveAdmins = admins.filter((r) => inactiveSince(r.lastLogonTime));
      const noLogonAdmins = count(admins, (r) => !r.lastLogonTime);
      return {
        count: rows.length,
        byType: [...byType.entries()].map(([type, n]) => ({ type, count: n })).sort((a, b) => b.count - a.count),
        admins: admins.length,
        stale: inactiveAdmins.length,
        staleOld: inactiveAdmins.length - noLogonAdmins, // dernière connexion il y a plus de 90 j
        staleNoLogon: noLogonAdmins, // aucune date de connexion
        services: services.length,
        servicesStale: count(services, (r) => inactiveSince(r.lastLogonTime)),
        staleList: inactiveAdmins
          .sort((a, b) => String(a.lastLogonTime ?? "").localeCompare(String(b.lastLogonTime ?? "")))
          .slice(0, 10)
          .map((r) => ({ name: r.name, types: types(r), lastLogonTime: r.lastLogonTime ?? null })),
        // Inventaire : administrateurs (avec indicateur d'inactivité) et comptes de service
        items: admins.map((r) => ({ ...toAccount(r), inactive: inactiveSince(r.lastLogonTime) })),
        serviceItems: services.map((r) => ({ ...toAccount(r), inactive: inactiveSince(r.lastLogonTime) })),
      };
    },
  },
  // Groupes des administrateurs (directs et hérités) et applications connectées
  adminMemberships: {
    asyncName: "membershipsAsync",
    jobName: "membershipsQueryJob",
    where: { member: { privilegedIdentityType: { includesAny: ["ADMIN"] } } },
    fields: "inheritanceDepth member { name samAccountName userPrincipalName isDisabled } "
      + "group { name samAccountName description connectedApp type }",
    summarize: (rows) => {
      // Compte administrateur → ses groupes (une entrée par groupe, profondeur la plus faible)
      const byAdmin: Record<string, Record<string, Row>> = {};
      for (const r of rows) {
        const m = r.member ?? {};
        if (m.isDisabled) continue;
        const who = String(m.samAccountName || m.userPrincipalName || m.name || "");
        const g = r.group ?? {};
        const gname = String(g.name || g.samAccountName || "");
        if (!who || !gname) continue;
        const groups = (byAdmin[who] ??= {});
        const prev = groups[gname];
        if (!prev || (r.inheritanceDepth ?? 99) < (prev.depth ?? 99)) {
          groups[gname] = {
            name: gname, depth: r.inheritanceDepth ?? null, description: g.description ?? null,
            apps: (g.connectedApp ?? []).filter(Boolean), type: g.type ?? null,
          };
        }
      }
      return {
        count: Object.keys(byAdmin).length,
        groupsByAdmin: Object.fromEntries(Object.entries(byAdmin).map(([k, v]) => [k, Object.values(v).sort((a, b) => (a.depth ?? 99) - (b.depth ?? 99) || a.name.localeCompare(b.name))])),
      };
    },
  },
  // Comptes activés sans connexion récente, par ancienneté
  ...Object.fromEntries(INACTIVE_BUCKETS.map((b) => [b.key, inactiveBucketQuery(b.from, b.to)])),
  // Comptes expirés mais toujours activés, comme « Account expiration status =
  // Expired » + « Disabled account = No » dans la console
  expiredEnabled: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isDisabled: enabledOnly },
    resolveWhere: async (baseUrl, token) => ({
      isDisabled: enabledOnly,
      expirationStatus: { eq: await enumValue(baseUrl, token, "ExpirationStatus", /^expired$/i) },
    }),
    fields: IDENTITY_FIELDS,
    summarize: (rows) => {
      const enabled = rows.filter((r) => !r.isDisabled);
      return { count: enabled.length, items: enabled.map(toAccount) };
    },
  },
};

/** Requête associée à une clé de résultat (y compris les partitions par source). */
function queryFor(key: string): PostureQuery | undefined {
  if (key.startsWith(ZONES_TOTAL_PREFIX)) {
    const k = parseZonesTotalKey(key);
    return k ? zonesTotalQuery(k.source, k.lo, k.hi, k.sized) : undefined;
  }
  return POSTURE_QUERIES[key];
}

/**
 * Traduit une erreur GraphQL Varonis en cause lisible :
 * droits insuffisants de la clé d'API, filtre refusé, ou autre.
 */
function classifyVaronisError(message: string): { code: string; error: string; field?: string } {
  if (message.includes("AUTH_NOT_AUTHORIZED") || /not authorized/i.test(message)) {
    return { code: "unauthorized", error: "La clé d'API Varonis n'a pas le droit de lire ces données." };
  }
  const field = message.match(/"path":\["where","(\w+)"\]/)?.[1];
  if (field) {
    return { code: "filter", field, error: `Varonis a rejeté le filtre « ${field} » (erreur interne, souvent liée aux droits).` };
  }
  return { code: "other", error: message.slice(0, 300) };
}

async function startPostureJob(baseUrl: string, token: string, q: PostureQuery, ref: number): Promise<string> {
  const query = `
    query start($where: ${filterTypeOf(q.asyncName)}!) {
      ${q.asyncName}(where: $where) { jobId jobStatus jobProgress results { ${q.fields} } }
    }
  `;
  const where = q.resolveWhere ? await q.resolveWhere(baseUrl, token, ref) : q.where;
  const data = await callVaronisGraphQL(baseUrl, token, query, { where });
  return data[q.asyncName].jobId;
}

/** Type GraphQL du filtre de chaque requête (lu sur le schéma du tenant). */
function filterTypeOf(asyncName: string): string {
  return {
    resourcesAsync: "Resource_FilterInput",
    identitiesAsync: "User_FilterInput",
    membershipsAsync: "GroupMembership_FilterInput",
    physicalPermissionsAsync: "PhysicalPermission_FilterInput",
    dataSourcesAsync: "FileServer_FilterInput",
  }[asyncName]!;
}

async function checkPostureJob(baseUrl: string, token: string, q: PostureQuery, jobId: string) {
  const query = `
    query check($jobId: ID!) {
      ${q.jobName}(jobId: $jobId) { jobId jobStatus jobProgress results { ${q.fields} } }
    }
  `;
  const data = await callVaronisGraphQL(baseUrl, token, query, { jobId });
  return data[q.jobName];
}

// ---------------------------------------------------------------------------
// Photos de posture : le calcul est fait côté serveur, enregistré dans la table
// varonis_posture_snapshots, et l'écran lit la dernière photo terminée.
// Pour ménager la limite de requêtes de Varonis, chaque « étape » ne fait que
// quelques appels (au plus MAX_RUNNING_JOBS jobs en cours à la fois) et deux
// étapes sont espacées d'au moins STEP_INTERVAL_MS. Les étapes sont déclenchées
// par la tâche planifiée (toutes les 2 min) et par l'écran ouvert.
// ---------------------------------------------------------------------------

const MAX_RUNNING_JOBS = 3;
const STEP_INTERVAL_MS = 15_000;
const STEP_LEASE_MS = 120_000; // verrou pendant une étape (évite deux étapes simultanées)
const RATE_LIMIT_BACKOFF_MS = 120_000; // pause après un refus « trop de requêtes »
const MAX_ATTEMPTS = 3; // essais par indicateur en cas d'erreur passagère
// Recherche que Varonis n'a pas terminée dans ce délai : relancée une seule fois.
// Les recherches sur les dossiers prennent plus de 5 min chez Varonis (millions de
// dossiers) : le délai ne doit couper qu'une recherche réellement bloquée.
const JOB_TIMEOUT_MS = 60 * 60 * 1000; // « données / droits inutilisés » dépassent 20 min
const TIMEOUT_ATTEMPTS = 2;
// Recalcul rapide (comptes) : toutes ses recherches lancées ensemble, pas de relance
// d'une recherche bloquée (la valeur précédente est reprise)
const MANUAL_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const MANUAL_TIMEOUT_ATTEMPTS = 1;
const MANUAL_MAX_RUNNING_JOBS = 7;
const RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000; // au-delà, ce qui reste est abandonné (une recherche par source de données)
const MANUAL_COOLDOWN_MS = 15 * 60 * 1000; // délai minimal entre deux calculs demandés
// Durée de travail d'un passage de la tâche planifiée (sous la limite d'exécution
// des Edge Functions, 150 s) et marge laissée pour finir une étape
const CRON_BUDGET_MS = 100_000;
const STEP_MARGIN_MS = 30_000;
const SNAPSHOT_COLUMNS = "id, status, trigger, results, last_error, started_at, finished_at";

// deno-lint-ignore no-explicit-any
type Admin = any;
interface Snapshot {
  id: string; status: "running" | "done"; trigger: string; results: Record<string, Row>;
  last_error: string | null; started_at: string; finished_at: string | null;
}

function adminClient(): Admin {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function latestSnapshots(admin: Admin): Promise<{ latest: Snapshot | null; running: Snapshot | null }> {
  const [done, running] = await Promise.all([
    admin.from("varonis_posture_snapshots").select(SNAPSHOT_COLUMNS).eq("status", "done")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("varonis_posture_snapshots").select(SNAPSHOT_COLUMNS).eq("status", "running")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (done.error) throw new Error(done.error.message);
  if (running.error) throw new Error(running.error.message);
  return { latest: done.data, running: running.data };
}

/** Photo en cours (id et début seulement, sans les résultats volumineux). */
async function runningSnapshot(admin: Admin): Promise<Snapshot | null> {
  const { data, error } = await admin.from("varonis_posture_snapshots").select("id, status, started_at")
    .eq("status", "running").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Recherches sur les comptes : seules refaites par le recalcul rapide (3 à 6 min seules). */
const ACCOUNT_KEYS = ["privileged", "inactive90", "inactive180", "inactive365", "inactive730", "expiredEnabled", "adminMemberships"];

/**
 * Recalcul rapide = les comptes. Les recherches sur les dossiers prennent de 8 à
 * plus de 20 min chez Varonis : leurs résultats sont repris de la dernière photo
 * terminée, avec leur date. Le calcul complet (manuel ou de nuit) refait tout.
 */
async function quickReuse(admin: Admin): Promise<Record<string, Row>> {
  const { data } = await admin.from("varonis_posture_snapshots").select("started_at, results")
    .eq("status", "done").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const prev = (data?.results ?? {}) as Record<string, Row>;
  if (prev.dataSources?.status !== "done") return {}; // pas de photo complète exploitable : calcul complet
  const reused: Record<string, Row> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (ACCOUNT_KEYS.includes(k) || v.status !== "done" || v.split) continue;
    reused[k] = { ...v, carriedFrom: v.carriedFrom ?? data!.started_at };
  }
  reused.dataSources = { ...reused.dataSources, expanded: true };
  return reused;
}

/** Recalcul rapide : photo manuelle dont les dossiers sont repris (dataSources repris). */
const isQuick = (snap: { trigger: string; results: Record<string, Row> }) =>
  snap.trigger === "manual" && Boolean(snap.results.dataSources?.carriedFrom);

/** Démarre une nouvelle photo (tous les indicateurs en attente). Une seule à la fois. */
async function createSnapshot(admin: Admin, trigger: "manual" | "schedule", userId: string | null, full = false) {
  const results: Record<string, Row> = Object.fromEntries(Object.keys(POSTURE_QUERIES).map((k) => [k, { status: "queued", attempts: 0 }]));
  if (trigger === "manual" && !full) Object.assign(results, await quickReuse(admin));
  const { error } = await admin.from("varonis_posture_snapshots").insert({ trigger, requested_by: userId, results });
  // 23505 : une photo est déjà en cours (index unique), rien à faire
  if (error && error.code !== "23505") throw new Error(error.message);
}

/** Erreur passagère : on réessaie plus tard ; sinon (droits, filtre) on abandonne l'indicateur. */
function failOrRetry(entry: Row, e: unknown): Row {
  const info = classifyVaronisError((e as Error).message);
  const attempts = (entry.attempts ?? 0) + 1;
  if (info.code === "other" && attempts < MAX_ATTEMPTS) return { status: "queued", attempts, lastError: info.error };
  return { status: "error", attempts, ...info };
}

/** Reprend, pour un indicateur en échec, la dernière valeur connue (avec sa date). */
// ---------------------------------------------------------------------------
// Évolution dans le temps : chiffres clés de chaque photo terminée
// ---------------------------------------------------------------------------

/**
 * Début de l'historique : définitions des indicateurs stabilisées (dédoublonnage,
 * propriétaires, tranches d'ancienneté, comptes expirés). Les photos antérieures
 * ne sont pas comparables.
 */
const HISTORY_FROM = "2026-10-27T00:00:00Z";

/** Valeur exploitable d'un indicateur : terminé, non plafonné, non reprise d'une photo antérieure. */
function reliable(r: Row | undefined, field = "count"): number | null {
  if (!r || r.status !== "done" || r.capped || r.carriedFrom) return null;
  const v = r[field];
  return typeof v === "number" ? v : null;
}

/** Chiffres clés d'une photo (null quand la valeur n'est pas fiable). */
function snapshotSummary(results: Record<string, Row>): Record<string, unknown> {
  const parts = Object.entries(results).filter(([k, v]) => k.startsWith(ZONES_TOTAL_PREFIX) && !v.split).map(([, v]) => v);
  const zonesTotal = results.dataSources?.status === "done" && parts.length > 0 && parts.every((p) => reliable(p) !== null)
    ? parts.reduce((t, p) => t + (p.count ?? 0), 0)
    : null;
  const buckets = INACTIVE_BUCKETS.map((b) => reliable(results[b.key]));
  return {
    exposed: reliable(results.sensitiveExposed),
    zonesTotal,
    zonesStale: reliable(results.zonesStale),
    zonesStaleAccess: reliable(results.zonesStaleAccess),
    zonesStaleOwner: reliable(results.zonesStaleOwner),
    zonesDisabledOwner: reliable(results.zonesDisabledOwner),
    admins: reliable(results.privileged, "admins"),
    adminsInactive: reliable(results.privileged, "stale"),
    inactiveAccounts: buckets.every((v) => v !== null) ? buckets.reduce((t, v) => t + (v ?? 0), 0) : null,
    expired: reliable(results.expiredEnabled),
    // Découpage final par taille des sources trop grosses : réutilisé par la photo suivante
    partitions: Object.entries(results)
      .filter(([k, v]) => k.startsWith(ZONES_TOTAL_PREFIX) && parseZonesTotalKey(k)?.sized && v.status === "done" && !v.split)
      .map(([k]) => k),
  };
}

/**
 * Historique : une photo par jour (la dernière), depuis HISTORY_FROM. Le résumé
 * manquant d'une photo ancienne est calculé puis enregistré au passage.
 */
async function postureHistory(admin: Admin) {
  const { data, error } = await admin.from("varonis_posture_snapshots")
    .select("id, started_at, summary").eq("status", "done").gte("started_at", HISTORY_FROM)
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  for (const row of rows.filter((x) => !x.summary)) {
    const { data: full, error: e } = await admin.from("varonis_posture_snapshots").select("results").eq("id", row.id).single();
    if (e) throw new Error(e.message);
    row.summary = snapshotSummary(full.results ?? {});
    await admin.from("varonis_posture_snapshots").update({ summary: row.summary }).eq("id", row.id);
  }
  // Par jour : la dernière valeur fiable de chaque indicateur (un calcul manuel rapide
  // ne refait pas le total des dossiers sensibles : on garde celui de la nuit)
  const byDay = new Map<string, { date: string; values: Row }>();
  for (const row of rows) {
    const day = String(row.started_at).slice(0, 10);
    const cur = byDay.get(day) ?? { date: row.started_at, values: {} as Row };
    for (const [k, v] of Object.entries(row.summary ?? {})) if (typeof v === "number") cur.values[k] = v;
    cur.date = row.started_at;
    byDay.set(day, cur);
  }
  return [...byDay.values()];
}

async function carryOverFailures(admin: Admin, results: Record<string, Row>) {
  const failed = Object.keys(results).filter((k) => results[k].status === "error" && results[k].code !== "unauthorized");
  if (failed.length === 0) return;
  const { data } = await admin.from("varonis_posture_snapshots").select("results, started_at")
    .eq("status", "done").order("started_at", { ascending: false }).limit(10);
  for (const key of failed) {
    const prev = (data ?? []).find((s: Row) => s.results?.[key]?.status === "done" && !s.results[key].carriedFrom);
    if (prev) results[key] = { ...prev.results[key], carriedFrom: prev.started_at, lastError: shortReason(results[key]) };
  }
}

const shortReason = (r: Row) => r.code === "timeout" ? "Délai dépassé" : (r.error ?? "Erreur");

/**
 * Fait avancer d'une étape la photo en cours : vérifie les jobs lancés, en lance
 * de nouveaux dans la limite autorisée, puis enregistre. Ne fait rien si une
 * autre étape est en cours ou trop récente.
 */
/**
 * Priorité de lancement (plus petit = plus tôt), d'après les durées mesurées chez
 * Varonis : dossiers (plus de 5 min) puis comptes (3 à 6 min), le reste ensuite.
 */
const LAUNCH_PRIORITY = [
  "dataSources", "zonesStaleAccess", "zonesStale", "zonesStaleOwner", "zonesDisabledOwner", "sensitiveExposed",
  "inactive90", "inactive180", "inactive365", "inactive730", "expiredEnabled", "privileged", "adminMemberships",
];
function launchRank(key: string): number {
  if (key.startsWith(ZONES_TOTAL_PREFIX)) return 5.5; // total par source : avec les dossiers
  const i = LAUNCH_PRIORITY.indexOf(key);
  return i === -1 ? LAUNCH_PRIORITY.length : i;
}

/** Résultat d'une étape : avancée, ou rien fait (étape en cours ailleurs, pause « trop de requêtes »). */
type StepOutcome = "advanced" | "skipped" | "backoff";

async function advanceSnapshot(admin: Admin, baseUrl: string, apiKey: string, snap: Snapshot): Promise<StepOutcome> {
  const now = Date.now();
  const { data: claimed, error: claimError } = await admin.from("varonis_posture_snapshots")
    .update({ step_lock_until: new Date(now + STEP_LEASE_MS).toISOString() })
    .eq("id", snap.id).eq("status", "running").lt("step_lock_until", new Date(now).toISOString())
    .select(SNAPSHOT_COLUMNS).maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return "skipped"; // étape déjà en cours ailleurs, ou trop tôt

  const results: Record<string, Row> = { ...claimed.results };
  const ref = new Date(claimed.started_at).getTime(); // référence commune des dates de la photo
  let lastError: string | null = null;
  let nextStepIn = STEP_INTERVAL_MS;

  try {
    const token = await getVaronisAccessToken(baseUrl, apiKey);

    // 1. Jobs déjà lancés
    for (const [key, entry] of Object.entries(results)) {
      if (entry.status !== "pending") continue;
      const q = queryFor(key);
      if (!q) { results[key] = { status: "error", error: "Indicateur inconnu" }; continue; }
      try {
        const job = await checkPostureJob(baseUrl, token, q, entry.jobId);
        if (job.jobStatus === "COMPLETED" || job.jobStatus === "PARTIAL_RESULTS") {
          const rows = (job.results ?? []) as Row[];
          const seconds = entry.startedAt ? Math.round((now - new Date(entry.startedAt).getTime()) / 1000) : null;
          results[key] = { status: "done", partial: job.jobStatus === "PARTIAL_RESULTS", capped: rows.length >= RESULT_CAP, seconds, doneAt: new Date(now).toISOString(), ...q.summarize(rows, ref) };
        } else if (job.jobStatus === "FAILED" || job.jobStatus === "CANCELED") {
          results[key] = failOrRetry(entry, new Error(`Job Varonis ${job.jobStatus}`));
        } else {
          // Heure de lancement inconnue (photo antérieure) : début de la photo
          const launched = new Date(entry.startedAt ?? claimed.started_at).getTime();
          if (now - launched > (isQuick(claimed) ? MANUAL_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS)) {
            const attempts = (entry.attempts ?? 0) + 1;
            const error = `Varonis n'a pas terminé la recherche en ${(isQuick(claimed) ? MANUAL_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS) / 60000} min`;
            results[key] = attempts < (isQuick(claimed) ? MANUAL_TIMEOUT_ATTEMPTS : TIMEOUT_ATTEMPTS)
              ? { status: "queued", attempts, lastError: error }
              : { status: "error", code: "timeout", attempts, error };
          } else {
            results[key] = { ...entry, progress: job.jobProgress ?? null };
          }
        }
      } catch (e) {
        if (isRateLimited(e)) throw e;
        results[key] = failOrRetry(entry, e);
      }
    }

    // 1 bis. Sources de données connues : une recherche « total » par source
    const ds = results.dataSources;
    if (ds?.status === "done" && !ds.expanded) {
      // Une source déjà découpée par taille lors de la photo précédente repart de ce
      // découpage (une partie redevenue trop grosse sera redécoupée normalement)
      const known = await previousPartitions(admin);
      for (const src of (ds.sources ?? []) as Row[]) {
        if (!/^\d+$/.test(src.id)) continue;
        const parts = known.get(Number(src.id));
        for (const key of parts ?? [`${ZONES_TOTAL_PREFIX}${src.id}`]) results[key] = { status: "queued", attempts: 0 };
      }
      results.dataSources = { ...ds, expanded: true };
    }

    // 1 ter. Partition plafonnée : redécoupée en deux tranches de taille de dossier
    for (const [key, entry] of Object.entries(results)) {
      if (!key.startsWith(ZONES_TOTAL_PREFIX) || entry.status !== "done" || !entry.capped || entry.split) continue;
      const k = parseZonesTotalKey(key);
      const parts = k && splitSizeRange(k.lo, k.hi);
      if (!k || !parts) continue; // ne se coupe plus : reste signalé comme plafonné
      const [lo, mid, hi] = parts;
      results[key] = { ...entry, split: true, top: undefined };
      // ]lo ; mid] et ]mid ; hi[ : « lt » est strict, d'où mid + 1
      results[`${ZONES_TOTAL_PREFIX}${k.source}:${lo}:${mid + 1}`] = { status: "queued", attempts: 0 };
      results[`${ZONES_TOTAL_PREFIX}${k.source}:${mid}:${hi}`] = { status: "queued", attempts: 0 };
    }

    // 2. Nouveaux jobs, dans la limite de MAX_RUNNING_JOBS. Les plus longs d'abord
    // (recherches sur les dossiers, puis les comptes) : les courts se glissent dans les
    // places libérées pendant que les longs tournent, la photo se termine plus tôt.
    const launchOrder = Object.entries(results).sort(([a], [b]) => launchRank(a) - launchRank(b));
    for (const [key, entry] of launchOrder) {
      if (Object.values(results).filter((r) => r.status === "pending").length >= (isQuick(claimed) ? MANUAL_MAX_RUNNING_JOBS : MAX_RUNNING_JOBS)) break;
      if (entry.status !== "queued") continue;
      try {
        const q = queryFor(key);
        if (!q) { results[key] = { status: "error", error: "Indicateur inconnu" }; continue; }
        const jobId = await startPostureJob(baseUrl, token, q, ref);
        results[key] = { status: "pending", jobId, attempts: entry.attempts ?? 0, progress: null, startedAt: new Date().toISOString() };
      } catch (e) {
        if (isRateLimited(e)) throw e;
        results[key] = failOrRetry(entry, e);
      }
    }
  } catch (e) {
    if (isRateLimited(e)) {
      lastError = "Limite de requêtes Varonis atteinte : reprise automatique dans 2 minutes";
      nextStepIn = RATE_LIMIT_BACKOFF_MS;
    } else {
      lastError = classifyVaronisError((e as Error).message).error;
    }
  }

  // 3. Calcul trop long : ce qui reste est abandonné
  if (now - new Date(claimed.started_at).getTime() > RUN_TIMEOUT_MS) {
    for (const [key, entry] of Object.entries(results)) {
      if (entry.status === "queued" || entry.status === "pending") results[key] = { status: "error", code: "timeout", attempts: entry.attempts };
    }
  }

  const finished = Object.values(results).every((r) => r.status === "done" || r.status === "error");
  if (finished) await carryOverFailures(admin, results);
  const { error } = await admin.from("varonis_posture_snapshots").update({
    results,
    last_error: lastError,
    step_lock_until: new Date(Date.now() + nextStepIn).toISOString(),
    ...(finished ? { status: "done", finished_at: new Date().toISOString(), summary: snapshotSummary(results) } : {}),
  }).eq("id", snap.id);
  if (error) throw new Error(error.message);
  if (finished) await pruneOldLists(admin, snap.id);
  return nextStepIn === RATE_LIMIT_BACKOFF_MS ? "backoff" : "advanced";
}

/** Listes de l'inventaire, chargées à part (action posture-inventory) : retirées ailleurs. */
const LIST_FIELDS = ["items", "serviceItems", "owners", "groupsByAdmin"];

/** Rattache à chaque administrateur ses groupes et les applications connectées. */
function withGroups(r: Record<string, Row>, items: Row[] | undefined): Row[] | undefined {
  const byAdmin = r.adminMemberships?.groupsByAdmin as Record<string, Row[]> | undefined;
  if (!items || !byAdmin) return items;
  return items.map((a) => {
    const raw: Row[] = byAdmin[a.sam] ?? byAdmin[a.upn] ?? byAdmin[a.name] ?? [];
    // Appartenance directe = profondeur la plus faible du compte (0 ou 1 selon le tenant)
    const direct = Math.min(...raw.map((g) => g.depth ?? 99));
    const groups: Row[] = raw.map((g) => ({ ...g, inherited: (g.depth ?? 99) > direct }));
    const apps = [...new Set(groups.flatMap((g) => g.apps ?? []))].sort();
    return { ...a, groups, groupNames: groups.map((g) => g.name), apps };
  });
}
function withoutLists({ jobId: _jobId, ...rest }: Row): Row {
  for (const f of LIST_FIELDS) delete rest[f];
  return rest;
}

/** Inventaire des comptes : une liste de la dernière photo terminée. */
const INVENTORY_LISTS: Record<string, (r: Record<string, Row>) => Row[] | undefined> = {
  admins: (r) => withGroups(r, r.privileged?.items),
  adminsInactive: (r) => withGroups(r, r.privileged?.items?.filter((a: Row) => a.inactive)),
  services: (r) => r.privileged?.serviceItems,
  expired: (r) => r.expiredEnabled?.items,
  inactive: (r) => {
    const parts = INACTIVE_BUCKETS.map((b) => (r[b.key]?.items as Row[] | undefined)?.map((a) => ({ ...a, bucket: b.key })));
    return parts.every(Boolean) ? parts.flat() as Row[] : undefined;
  },
  ownersStale: (r) => r.zonesStaleOwner?.owners,
  ownersDisabled: (r) => r.zonesDisabledOwner?.owners,
};

async function postureInventory(admin: Admin, list: string) {
  const pick = INVENTORY_LISTS[list];
  if (!pick) return jsonResponse({ error: "Liste inconnue" }, 400);
  // Calcul en cours : sa liste dès qu'elle est prête (non reprise), sinon la dernière photo
  for (const status of ["running", "done"]) {
    const { data, error } = await admin.from("varonis_posture_snapshots").select("started_at, results")
      .eq("status", status).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    const all = (data?.results ?? {}) as Record<string, Row>;
    // Calcul en cours : seulement les recherches terminées et non reprises d'une photo antérieure
    const results = status === "done" ? all
      : Object.fromEntries(Object.entries(all).filter(([, v]) => v.status === "done" && !v.carriedFrom));
    const items = data ? pick(results) : undefined;
    if (items) return jsonResponse({ date: data!.started_at, running: status === "running", available: true, items });
  }
  return jsonResponse({ date: null, available: false, items: [] });
}

/**
 * Les listes de l'inventaire ne sont gardées que sur les 3 dernières photos :
 * la 4e plus récente est allégée à chaque fin de calcul (ses chiffres restent).
 */
async function pruneOldLists(admin: Admin, keepId: string) {
  const { data } = await admin.from("varonis_posture_snapshots").select("id, results")
    .eq("status", "done").order("started_at", { ascending: false }).range(3, 3);
  for (const row of (data ?? []) as Row[]) {
    if (row.id === keepId) continue; // garde-fou : jamais la photo qui vient de se terminer
    const results = Object.fromEntries(Object.entries(row.results ?? {}).map(([k, v]) => {
      const copy = { ...(v as Row) };
      for (const f of LIST_FIELDS) delete copy[f];
      return [k, copy];
    }));
    await admin.from("varonis_posture_snapshots").update({ results }).eq("id", row.id);
  }
}

/** État renvoyé à l'écran : dernière photo terminée et photo en cours (sans les jobId). */
function publicState(state: { latest: Snapshot | null; running: Snapshot | null }) {
  const clean = (s: Snapshot | null) => s && {
    ...s,
    results: Object.fromEntries(Object.entries(s.results).map(([k, v]) => [k, withoutLists(v)])),
  };
  return { latest: clean(state.latest), running: clean(state.running), scheduled: Boolean(POSTURE_CRON_SECRET) };
}

/** Comparaison en temps constant du secret de la tâche planifiée. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Actions de posture : posture-status, posture-refresh (utilisateur) et posture-cron (tâche planifiée). */
async function handlePosture(action: string, body: Row, baseUrl: string, apiKey: string, userId: string | null) {
  const admin = adminClient();
  let state = await latestSnapshots(admin);

  if (action === "posture-refresh" && !state.running) {
    const last = state.latest ? new Date(state.latest.started_at).getTime() : 0;
    const wait = last + MANUAL_COOLDOWN_MS - Date.now();
    if (wait > 0) {
      return jsonResponse({
        error: `Dernier calcul lancé il y a moins de ${MANUAL_COOLDOWN_MS / 60000} min : nouveau calcul possible dans ${Math.ceil(wait / 60000)} min (limite de requêtes Varonis).`,
      }, 429);
    }
    await createSnapshot(admin, "manual", userId, body.full === true); // full : calcul complet demandé
    state = await latestSnapshots(admin);
  }
  if (action === "posture-cron" && body.start === true && !state.running) {
    await createSnapshot(admin, "schedule", null);
    state = await latestSnapshots(admin);
  }

  if (action === "posture-cron") {
    // Tâche planifiée (toutes les 2 min) : enchaîne les étapes pendant CRON_BUDGET_MS,
    // à STEP_INTERVAL_MS d'intervalle, au lieu d'une seule étape par passage
    const deadline = Date.now() + CRON_BUDGET_MS;
    let running = state.running;
    while (running) {
      const outcome = await advanceSnapshot(admin, baseUrl, apiKey, running);
      running = await runningSnapshot(admin);
      // Pause « trop de requêtes » ou étape tenue ailleurs : le passage suivant reprendra
      if (outcome !== "advanced" || !running || Date.now() + STEP_INTERVAL_MS + STEP_MARGIN_MS > deadline) break;
      await new Promise((r) => setTimeout(r, STEP_INTERVAL_MS + 500));
    }
    return jsonResponse({ running: Boolean(running) });
  }

  if (state.running) {
    await advanceSnapshot(admin, baseUrl, apiKey, state.running);
    state = await latestSnapshots(admin);
  }
  return jsonResponse(publicState(state));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: { jobId?: unknown; action?: unknown; typeName?: unknown; typeNames?: unknown; start?: unknown } = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      // corps vide : lancement d'un nouveau job d'alertes
    }

    if (!VARONIS_BASE_URL || !VARONIS_API_KEY) {
      return jsonResponse({ error: "Varonis non configuré côté serveur (secrets manquants)" }, 500);
    }
    const baseUrl = VARONIS_BASE_URL.trim().replace(/\/$/, "");

    // Tâche planifiée : authentifiée par un secret partagé, pas par un utilisateur
    if (body.action === "posture-cron") {
      const given = req.headers.get("x-cron-secret") ?? "";
      if (!POSTURE_CRON_SECRET || !sameSecret(given, POSTURE_CRON_SECRET)) {
        return jsonResponse({ error: "Non autorisé" }, 401);
      }
      return await handlePosture("posture-cron", body, baseUrl, VARONIS_API_KEY, null);
    }

    // 1. Authentification Supabase (JWT de l'utilisateur connecté)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Non authentifié" }, 401);
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Session invalide" }, 401);
    }

    // 2. Lancement du job d'alertes, ou vérification d'un job déjà lancé
    if (body.jobId !== undefined && (typeof body.jobId !== "string" || !JOB_ID_PATTERN.test(body.jobId))) {
      return jsonResponse({ error: "Identifiant de job invalide" }, 400);
    }

    // Posture des données : lecture de la dernière photo, ou nouveau calcul
    // Inventaire des comptes : { action: "posture-inventory", list: "admins" | … }
    if (body.action === "posture-inventory") {
      return await postureInventory(adminClient(), String((body as Row).list ?? ""));
    }

    // Évolution dans le temps : { action: "posture-history" }
    if (body.action === "posture-history") {
      return jsonResponse({ from: HISTORY_FROM, points: await postureHistory(adminClient()) });
    }

    if (body.action === "posture-status" || body.action === "posture-refresh") {
      return await handlePosture(body.action, body, baseUrl, VARONIS_API_KEY, user.id);
    }

    // Mode diagnostic : { action: "scheduledSearches" }
    if (body.action === "scheduledSearches") {
      const scheduledToken = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
      return jsonResponse({ scheduledSearches: await listScheduledSearches(baseUrl, scheduledToken) });
    }

    // Mode diagnostic : { action: "schema", typeName: "Alert" }
    if (body.action === "schema") {
      // Un type (typeName) ou plusieurs d'un coup (typeNames, 15 au maximum)
      const names = Array.isArray(body.typeNames)
        ? body.typeNames
        : [typeof body.typeName === "string" ? body.typeName : "Alert"];
      if (names.length === 0 || names.length > 15 || !names.every((n) => typeof n === "string" && TYPE_NAME_PATTERN.test(n))) {
        return jsonResponse({ error: "Noms de type invalides (15 au maximum)" }, 400);
      }
      const schemaToken = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
      const types = [];
      for (const n of names as string[]) {
        types.push((await describeType(baseUrl, schemaToken, n)) ?? { name: n, missing: true });
      }
      return Array.isArray(body.typeNames) ? jsonResponse({ types }) : jsonResponse({ type: types[0] });
    }

    const token = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
    const jobId = (body.jobId as string | undefined) ?? await startAlertsJob(baseUrl, token);
    const job = await checkAlertsJob(baseUrl, token, jobId);

    if (job.jobStatus === "COMPLETED" || job.jobStatus === "PARTIAL_RESULTS") {
      return jsonResponse({
        status: "done",
        jobStatus: job.jobStatus,
        jobProgress: job.jobProgress,
        alerts: job.results,
      });
    }

    // PENDING ou EXECUTING : le front rappellera avec ce jobId
    return jsonResponse({ status: "pending", jobId, jobStatus: job.jobStatus, jobProgress: job.jobProgress });
  } catch (err: any) {
    console.error("Erreur varonis-proxy:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
});