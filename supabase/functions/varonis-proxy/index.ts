import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Secrets configurés côté Supabase (Project Settings > Edge Functions > Secrets) ---
const VARONIS_BASE_URL = Deno.env.get("VARONIS_BASE_URL"); // ex: https://tenant.varonis.io
const VARONIS_API_KEY = Deno.env.get("VARONIS_API_KEY");

// Confirmé via la doc officielle Varonis (API Reference > Authentication / Alerts)
const AUTH_ENDPOINT = "/api/authentication/api_keys/token";
const GRAPHQL_ENDPOINT = "/api/graphql";

const POLL_MAX_ATTEMPTS = 12;   // ~ 12 x 1.5s = 18s de polling max
const POLL_INTERVAL_MS = 1500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // à restreindre en prod
  "Access-Control-Allow-Headers": "authorization, content-type",
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
          id
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

/** Étape 3 : interroge le job jusqu'à obtenir un résultat final (ou expiration du délai). */
async function pollAlertsJob(baseUrl: string, token: string, jobId: string) {
  const query = `
    query alertsQueryJob($jobId: ID!) {
      alertsQueryJob(jobId: $jobId) {
        jobId
        jobStatus
        jobProgress
        results {
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
        }
      }
    }
  `;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const data = await callVaronisGraphQL(baseUrl, token, query, { jobId });
    const job = data.alertsQueryJob;

    if (job.jobStatus === "COMPLETED" || job.jobStatus === "PARTIAL_RESULTS") {
      return job;
    }
    if (job.jobStatus === "FAILED" || job.jobStatus === "CANCELED") {
      throw new Error(`Le job Varonis a échoué (statut: ${job.jobStatus})`);
    }
    // PENDING ou EXECUTING → on retente après une pause
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Délai dépassé en attendant les résultats Varonis (job toujours en cours)");
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

    // 3. Flux complet : token -> job -> polling
    const token = await getVaronisAccessToken(baseUrl, VARONIS_API_KEY);
    const jobId = await startAlertsJob(baseUrl, token);
    const job = await pollAlertsJob(baseUrl, token, jobId);

    return jsonResponse({
      jobStatus: job.jobStatus,
      jobProgress: job.jobProgress,
      alerts: job.results,
    });
  } catch (err: any) {
    console.error("Erreur varonis-proxy:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
});