import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Secrets configurés côté Supabase (Project Settings > Edge Functions > Secrets) ---
const VARONIS_BASE_URL = Deno.env.get("VARONIS_BASE_URL"); // ex: https://tenant.varonis.io
const VARONIS_API_KEY = Deno.env.get("VARONIS_API_KEY");

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
    throw new Error(`Échec authentification Varonis (${res.status}): ${text}`);
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

  const data = await res.json();

  if (!res.ok || data.errors) {
    throw new Error(`Erreur GraphQL Varonis: ${JSON.stringify(data.errors ?? data)}`);
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
// Posture des données (étape 3) : requêtes fixes, lancées en parallèle.
// Le proxy calcule lui-même les totaux et les tops : le navigateur ne reçoit
// qu'un résumé. Les champs sont demandés dans la requête *Async ET dans la
// requête *QueryJob (consigne du support Varonis).
// ---------------------------------------------------------------------------

/** Plafond de résultats de l'API par requête : au-delà, le total est « au moins ». */
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
const no = { eq: false };
const count = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).length;

const POSTURE_QUERIES: Record<string, PostureQuery> = {
  // Dossiers sensibles exposés à toute l'organisation (racines d'accès ouvert)
  sensitiveExposed: {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes, isRootOrgWideExposed: yes },
    fields: "id name path url sizeOfResourceAndNestedResources totalNumberOfNestedObjects hasStaleOwner hasDisabledOwner isStale lastEventDate",
    summarize: (rows) => ({
      count: rows.length,
      withoutValidOwner: count(rows, (r) => r.hasStaleOwner || r.hasDisabledOwner),
      top: [...rows]
        .sort((a, b) => (b.totalNumberOfNestedObjects ?? 0) - (a.totalNumberOfNestedObjects ?? 0))
        .slice(0, 10)
        .map((r) => ({
          name: r.name, path: r.path, url: r.url,
          objects: r.totalNumberOfNestedObjects, sizeBytes: r.sizeOfResourceAndNestedResources,
          ownerIssue: Boolean(r.hasStaleOwner || r.hasDisabledOwner), isStale: Boolean(r.isStale),
          lastEventDate: r.lastEventDate,
        })),
    }),
  },
  // Ensemble des ressources sensibles : propriétaire et obsolescence
  sensitive: {
    asyncName: "resourcesAsync",
    jobName: "resourcesQueryJob",
    where: { isSensitive: yes },
    fields: "id hasStaleOwner hasDisabledOwner isStale",
    summarize: (rows) => ({
      count: rows.length,
      withoutValidOwner: count(rows, (r) => r.hasStaleOwner || r.hasDisabledOwner),
      stale: count(rows, (r) => r.isStale),
    }),
  },
  // Comptes privilégiés actifs (admin, service, dirigeant…)
  privileged: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { privilegedIdentityType: { hasValue: true }, isDisabled: no },
    fields: "id name privilegedIdentityType isStale lastLogonTime",
    summarize: (rows) => {
      const byType = new Map<string, number>();
      for (const r of rows) {
        for (const t of (r.privilegedIdentityType ?? []) as string[]) byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      const stale = rows.filter((r) => r.isStale);
      return {
        count: rows.length,
        byType: [...byType.entries()].map(([type, n]) => ({ type, count: n })).sort((a, b) => b.count - a.count),
        stale: stale.length,
        staleList: stale
          .sort((a, b) => String(a.lastLogonTime ?? "").localeCompare(String(b.lastLogonTime ?? "")))
          .slice(0, 10)
          .map((r) => ({ name: r.name, types: r.privilegedIdentityType ?? [], lastLogonTime: r.lastLogonTime ?? null })),
      };
    },
  },
  // Comptes inactifs mais toujours activés
  staleUsers: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isStale: yes, isDisabled: no },
    fields: "id",
    summarize: (rows) => ({ count: rows.length }),
  },
  // Comptes expirés mais toujours activés
  expiredEnabled: {
    asyncName: "identitiesAsync",
    jobName: "identitiesQueryJob",
    where: { isEnabledExpired: yes },
    fields: "id",
    summarize: (rows) => ({ count: rows.length }),
  },
  // Appartenances à des groupes devenues obsolètes
  staleMemberships: {
    asyncName: "membershipsAsync",
    jobName: "membershipsQueryJob",
    where: { isStaleMembership: yes },
    fields: "isStaleMembership",
    summarize: (rows) => ({ count: rows.length }),
  },
  // Permissions jamais utilisées (candidates au retrait)
  stalePermissions: {
    asyncName: "physicalPermissionsAsync",
    jobName: "physicalPermissionsQueryJob",
    where: { isStalePermission: yes },
    fields: "aceId",
    summarize: (rows) => ({ count: rows.length }),
  },
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // 2. Vérification des secrets serveur
    if (!VARONIS_BASE_URL || !VARONIS_API_KEY) {
      return jsonResponse({ error: "Varonis non configuré côté serveur (secrets manquants)" }, 500);
    }

    const baseUrl = VARONIS_BASE_URL.trim().replace(/\/$/, "");

    // 3. Lancement du job, ou vérification d'un job déjà lancé
    let body: { jobId?: unknown; action?: unknown; typeName?: unknown; typeNames?: unknown; jobs?: unknown } = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      // corps vide : lancement d'un nouveau job
    }
    if (body.jobId !== undefined && (typeof body.jobId !== "string" || !JOB_ID_PATTERN.test(body.jobId))) {
      return jsonResponse({ error: "Identifiant de job invalide" }, 400);
    }

    // Posture des données : { action: "posture" } lance les requêtes ;
    // { action: "posture", jobs: { clé: jobId } } vérifie celles en cours.
    if (body.action === "posture") {
      const postureToken = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
      const given = (body.jobs && typeof body.jobs === "object") ? body.jobs as Record<string, unknown> : null;
      const results: Record<string, unknown> = {};
      await Promise.all(Object.entries(POSTURE_QUERIES).map(async ([key, q]) => {
        try {
          let jobId = given ? given[key] : undefined;
          if (given && jobId === undefined) return; // déjà terminée lors d'un appel précédent
          if (jobId !== undefined && (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId))) {
            results[key] = { status: "error", error: "Identifiant de job invalide" };
            return;
          }
          if (jobId === undefined) jobId = await startPostureJob(baseUrl, postureToken, q);
          const job = await checkPostureJob(baseUrl, postureToken, q, jobId as string);
          if (job.jobStatus === "COMPLETED" || job.jobStatus === "PARTIAL_RESULTS") {
            const rows = (job.results ?? []) as Row[];
            results[key] = {
              status: "done",
              partial: job.jobStatus === "PARTIAL_RESULTS",
              capped: rows.length >= RESULT_CAP,
              ...q.summarize(rows),
            };
          } else if (job.jobStatus === "FAILED" || job.jobStatus === "CANCELED") {
            results[key] = { status: "error", error: `Job Varonis ${job.jobStatus}` };
          } else {
            results[key] = { status: "pending", jobId, progress: job.jobProgress ?? null };
          }
        } catch (e) {
          results[key] = { status: "error", ...classifyVaronisError((e as Error).message) };
        }
      }));
      return jsonResponse({ results });
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