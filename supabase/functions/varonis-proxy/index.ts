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
        }
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
    let body: { jobId?: unknown; action?: unknown; typeName?: unknown } = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      // corps vide : lancement d'un nouveau job
    }
    if (body.jobId !== undefined && (typeof body.jobId !== "string" || !JOB_ID_PATTERN.test(body.jobId))) {
      return jsonResponse({ error: "Identifiant de job invalide" }, 400);
    }

    // Mode diagnostic : { action: "schema", typeName: "Alert" }
    if (body.action === "schema") {
      const typeName = typeof body.typeName === "string" ? body.typeName : "Alert";
      if (!TYPE_NAME_PATTERN.test(typeName)) {
        return jsonResponse({ error: "Nom de type invalide" }, 400);
      }
      const schemaToken = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
      return jsonResponse({ type: await describeType(baseUrl, schemaToken, typeName) });
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