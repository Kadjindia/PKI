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
  summarize: (rows: Row[]) => Record<string, unknown>;
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
 * Dédoublonne les ressources. Varonis renvoie souvent plusieurs lignes pour une
 * même ressource, chacune avec un identifiant différent (comme les « Results »
 * de la console) : on compte une ressource par couple source de données + chemin,
 * ce qui correspond aux « Unique resources » de la console.
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

/** Borne basse de la dernière tranche (« plus de 2 ans ») : 30 ans. */
const OLDEST_LOGON_DAYS = 30 * 365;
const daysAgoIso = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function inactiveBucketQuery(from: number, to: number | null): PostureQuery {
  return {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: {
      isDisabled: enabledOnly,
      // Tranche exacte : dernière connexion entre (aujourd'hui - to) et (aujourd'hui - from)
      lastLogonTime: { between: { from: daysAgoIso(to ?? OLDEST_LOGON_DAYS), to: daysAgoIso(from) } },
    },
    fields: "id isDisabled lastLogonTime",
    summarize: (rows) => {
      const now = Date.now();
      const ageOf = (r: Row) => (now - new Date(r.lastLogonTime).getTime()) / DAY;
      const dated = rows.filter((r) => r.lastLogonTime);
      const ages = dated.map(ageOf).sort((a, b) => a - b);
      return {
        count: count(rows, (r) => {
          if (r.isDisabled || !r.lastLogonTime) return false;
          const days = ageOf(r);
          return days > from && (to === null || days <= to);
        }),
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

const ZONE_FIELDS = "id name path sharePaths url dataSource { id name type } sizeOfResourceAndNestedResources numberOfNestedFiles isStaleIncludingSubfolders hasStaleAccess hasStaleOwner hasDisabledOwner";

/** Dossiers sensibles de niveau 3 présentant un point à traiter : nombre unique et volume. */
function zoneIssueQuery(extra: Record<string, unknown>): PostureQuery {
  return {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes, pathDepth: { eq: ZONE_DEPTH }, ...extra },
    fields: "id path dataSource { id } sizeOfResourceAndNestedResources numberOfNestedFiles",
    summarize: (rows) => ({ ...zoneTotals(uniqueResources(rows)), lines: rows.length }),
  };
}

/** Préfixe des recherches « total des dossiers sensibles », une par source de données. */
const ZONES_TOTAL_PREFIX = "zonesTotal:";

/** Dossiers sensibles de niveau 3 d'une source de données : total, volume et les plus gros. */
function zonesTotalQuery(sourceId: number): PostureQuery {
  return {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes, pathDepth: { eq: ZONE_DEPTH }, dataSource: { id: { eq: sourceId } } },
    fields: ZONE_FIELDS,
    summarize: (all) => {
      const rows = uniqueResources(all);
      return {
        ...zoneTotals(rows),
        lines: all.length,
        top: [...rows]
          .sort((a, b) => (b.sizeOfResourceAndNestedResources ?? 0) - (a.sizeOfResourceAndNestedResources ?? 0))
          .slice(0, 15)
          .map((r) => ({
            name: r.name, path: r.path, sharePath: (r.sharePaths ?? [])[0] ?? null, url: r.url,
            source: r.dataSource?.type ?? null, sourceName: r.dataSource?.name ?? null,
            sizeBytes: r.sizeOfResourceAndNestedResources, files: r.numberOfNestedFiles,
            isStale: Boolean(r.isStaleIncludingSubfolders), staleAccess: Boolean(r.hasStaleAccess),
            staleOwner: Boolean(r.hasStaleOwner), disabledOwner: Boolean(r.hasDisabledOwner),
            ownerIssue: Boolean(r.hasStaleOwner || r.hasDisabledOwner),
          })),
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
    fields: "id name path sharePaths url sizeOfResourceAndNestedResources totalNumberOfNestedObjects hasStaleOwner hasDisabledOwner isStale lastEventDate dataSource { id name type }",
    summarize: (all) => {
      const rows = uniqueResources(all); // une même ressource peut remonter par plusieurs chemins
      return {
        count: rows.length,
        withoutValidOwner: count(rows, (r) => r.hasStaleOwner || r.hasDisabledOwner),
        top: [...rows]
          .sort((a, b) => (b.totalNumberOfNestedObjects ?? 0) - (a.totalNumberOfNestedObjects ?? 0))
          .slice(0, 10)
          .map((r) => ({
            name: r.name, path: r.path, sharePath: (r.sharePaths ?? [])[0] ?? null, url: r.url,
            source: r.dataSource?.type ?? null, sourceName: r.dataSource?.name ?? null,
            objects: r.totalNumberOfNestedObjects, sizeBytes: r.sizeOfResourceAndNestedResources,
            ownerIssue: Boolean(r.hasStaleOwner || r.hasDisabledOwner), isStale: Boolean(r.isStale),
            lastEventDate: r.lastEventDate,
          })),
      };
    },
  },
  // Dossiers sensibles de niveau 3, une recherche par point à traiter (filtrée
  // chez Varonis : chaque résultat reste loin du plafond)
  zonesStale: zoneIssueQuery({ isStaleIncludingSubfolders: yes }),
  zonesStaleAccess: zoneIssueQuery({ hasStaleAccess: yes }),
  zonesStaleOwner: zoneIssueQuery({ hasStaleOwner: yes }),
  zonesDisabledOwner: zoneIssueQuery({ hasDisabledOwner: yes }),
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
    fields: "id name privilegedIdentityType isDisabled lastLogonTime",
    summarize: (all) => {
      const rows = all.filter((r) => !r.isDisabled);
      const types = (r: Row) => (r.privilegedIdentityType ?? []) as string[];
      const byType = new Map<string, number>();
      for (const r of rows) for (const t of types(r)) byType.set(t, (byType.get(t) ?? 0) + 1);
      const admins = rows.filter((r) => types(r).includes("ADMIN"));
      const services = rows.filter((r) => types(r).includes("SERVICE") && !types(r).includes("ADMIN"));
      const inactiveAdmins = admins.filter((r) => inactiveSince(r.lastLogonTime));
      return {
        count: rows.length,
        byType: [...byType.entries()].map(([type, n]) => ({ type, count: n })).sort((a, b) => b.count - a.count),
        admins: admins.length,
        stale: inactiveAdmins.length,
        services: services.length,
        servicesStale: count(services, (r) => inactiveSince(r.lastLogonTime)),
        staleList: inactiveAdmins
          .sort((a, b) => String(a.lastLogonTime ?? "").localeCompare(String(b.lastLogonTime ?? "")))
          .slice(0, 10)
          .map((r) => ({ name: r.name, types: types(r), lastLogonTime: r.lastLogonTime ?? null })),
      };
    },
  },
  // Comptes activés sans connexion récente, par ancienneté
  ...Object.fromEntries(INACTIVE_BUCKETS.map((b) => [b.key, inactiveBucketQuery(b.from, b.to)])),
  // Comptes activés qui ne se sont jamais connectés
  neverLogged: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isDisabled: enabledOnly, lastLogonTime: { hasValue: false } },
    fields: "id isDisabled",
    summarize: (rows) => ({ count: count(rows, (r) => !r.isDisabled) }),
  },
  // Comptes expirés mais toujours activés
  expiredEnabled: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isEnabledExpired: yes },
    fields: "id",
    summarize: (rows) => ({ count: rows.length }),
  },
};

/** Requête associée à une clé de résultat (y compris les partitions par source). */
function queryFor(key: string): PostureQuery | undefined {
  if (key.startsWith(ZONES_TOTAL_PREFIX)) {
    const id = Number(key.slice(ZONES_TOTAL_PREFIX.length));
    return Number.isInteger(id) ? zonesTotalQuery(id) : undefined;
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

async function startPostureJob(baseUrl: string, token: string, q: PostureQuery): Promise<string> {
  const query = `
    query start($where: ${filterTypeOf(q.asyncName)}!) {
      ${q.asyncName}(where: $where) { jobId jobStatus jobProgress results { ${q.fields} } }
    }
  `;
  const data = await callVaronisGraphQL(baseUrl, token, query, { where: q.where });
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
const RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000; // au-delà, ce qui reste est abandonné (une recherche par source de données)
const MANUAL_COOLDOWN_MS = 15 * 60 * 1000; // délai minimal entre deux calculs demandés
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

/** Démarre une nouvelle photo (tous les indicateurs en attente). Une seule à la fois. */
async function createSnapshot(admin: Admin, trigger: "manual" | "schedule", userId: string | null) {
  const results = Object.fromEntries(Object.keys(POSTURE_QUERIES).map((k) => [k, { status: "queued", attempts: 0 }]));
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
async function advanceSnapshot(admin: Admin, baseUrl: string, apiKey: string, snap: Snapshot): Promise<void> {
  const now = Date.now();
  const { data: claimed, error: claimError } = await admin.from("varonis_posture_snapshots")
    .update({ step_lock_until: new Date(now + STEP_LEASE_MS).toISOString() })
    .eq("id", snap.id).eq("status", "running").lt("step_lock_until", new Date(now).toISOString())
    .select(SNAPSHOT_COLUMNS).maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return; // étape déjà en cours ailleurs, ou trop tôt

  const results: Record<string, Row> = { ...claimed.results };
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
          results[key] = { status: "done", partial: job.jobStatus === "PARTIAL_RESULTS", capped: rows.length >= RESULT_CAP, ...q.summarize(rows) };
        } else if (job.jobStatus === "FAILED" || job.jobStatus === "CANCELED") {
          results[key] = failOrRetry(entry, new Error(`Job Varonis ${job.jobStatus}`));
        } else {
          results[key] = { ...entry, progress: job.jobProgress ?? null };
        }
      } catch (e) {
        if (isRateLimited(e)) throw e;
        results[key] = failOrRetry(entry, e);
      }
    }

    // 1 bis. Sources de données connues : une recherche « total » par source
    const ds = results.dataSources;
    if (ds?.status === "done" && !ds.expanded) {
      for (const src of (ds.sources ?? []) as Row[]) {
        if (/^\d+$/.test(src.id)) results[`${ZONES_TOTAL_PREFIX}${src.id}`] = { status: "queued", attempts: 0 };
      }
      results.dataSources = { ...ds, expanded: true };
    }

    // 2. Nouveaux jobs, dans la limite de MAX_RUNNING_JOBS
    for (const [key, entry] of Object.entries(results)) {
      if (Object.values(results).filter((r) => r.status === "pending").length >= MAX_RUNNING_JOBS) break;
      if (entry.status !== "queued") continue;
      try {
        const q = queryFor(key);
        if (!q) { results[key] = { status: "error", error: "Indicateur inconnu" }; continue; }
        const jobId = await startPostureJob(baseUrl, token, q);
        results[key] = { status: "pending", jobId, attempts: entry.attempts ?? 0, progress: null };
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
    ...(finished ? { status: "done", finished_at: new Date().toISOString() } : {}),
  }).eq("id", snap.id);
  if (error) throw new Error(error.message);
}

/** État renvoyé à l'écran : dernière photo terminée et photo en cours (sans les jobId). */
function publicState(state: { latest: Snapshot | null; running: Snapshot | null }) {
  const clean = (s: Snapshot | null) => s && {
    ...s,
    results: Object.fromEntries(Object.entries(s.results).map(([k, { jobId: _jobId, ...rest }]) => [k, rest])),
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
    await createSnapshot(admin, "manual", userId);
    state = await latestSnapshots(admin);
  }
  if (action === "posture-cron" && body.start === true && !state.running) {
    await createSnapshot(admin, "schedule", null);
    state = await latestSnapshots(admin);
  }

  if (state.running) {
    await advanceSnapshot(admin, baseUrl, apiKey, state.running);
    state = await latestSnapshots(admin);
  }
  if (action === "posture-cron") {
    return jsonResponse({ running: Boolean(state.running), latest: state.latest?.started_at ?? null });
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