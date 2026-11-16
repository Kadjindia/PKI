import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hostsPage, detectionsPage, kbPage, buildResults, summaryOf, qualysError, nextPageUrl } from "./parse.ts";

// --- Secrets configurés côté Supabase (Project Settings > Edge Functions > Secrets) ---
const QUALYS_BASE_URL = (Deno.env.get("QUALYS_BASE_URL") ?? "https://qualysapi.qg2.apps.qualys.eu").trim().replace(/\/$/, "");
const QUALYS_USERNAME = Deno.env.get("QUALYS_USERNAME");
const QUALYS_PASSWORD = Deno.env.get("QUALYS_PASSWORD");
// Même secret que la tâche planifiée de la posture Varonis
const CRON_SECRET = Deno.env.get("POSTURE_CRON_SECRET");

// ---------------------------------------------------------------------------
// Qualys VMDR : une photo des vulnérabilités chaque nuit.
//
// Qualys met ~1 min 30 à préparer chaque page de résultats : la base fait l'appel
// (pg_net, voir la migration qualys_snapshots) et la fonction, appelée toutes les
// 2 min par la tâche planifiée, lit la réponse, en extrait les chiffres de la page
// puis demande la suivante. Un seul appel à Qualys à la fois (l'abonnement en
// autorise 2 simultanés et 300 par heure). Lecture seule.
//
// Étapes : hosts (liste des actifs, couverture) -> detections (vulnérabilités de
// sévérité 4 et 5 ouvertes) -> kb (titres, CISA KEV, ransomware, corrigeable)
// -> photo.
// ---------------------------------------------------------------------------

const HOST_PAGE = 1000; // actifs par page de la liste des actifs (~1 s par actif chez Qualys)
const DETECTION_PAGE = 150; // actifs par page de vulnérabilités (~100 000 lignes, ~15 Mo)
const KB_CHUNK = 400; // vulnérabilités par appel à la base de connaissances

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // attente maximale d'une réponse de Qualys
const CONCURRENCY_WAIT_MS = 3 * 60 * 1000; // pause si les 2 appels simultanés sont pris
const MAX_ATTEMPTS = 3;
const RUN_TIMEOUT_MS = 8 * 60 * 60 * 1000;
// Un passage de la tâche planifiée travaille au plus ~110 s (limite des fonctions : 150 s)
const CRON_BUDGET_MS = 110_000;
const POLL_MS = 8_000;
const STEP_LEASE_MS = 140_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function adminClient(): Admin {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// Moteur : une étape = lire la réponse attendue, en tirer les chiffres, demander la suite
// ---------------------------------------------------------------------------

const firstUrl = {
  hosts: () => `${QUALYS_BASE_URL}/api/5.0/fo/asset/host/?action=list&details=All&show_trurisk=1&truncation_limit=${HOST_PAGE}`,
  detections: () => `${QUALYS_BASE_URL}/api/5.0/fo/asset/host/vm/detection/?action=list&severities=4-5&status=New,Active,Re-Opened&show_results=0&show_qds=1&truncation_limit=${DETECTION_PAGE}`,
  kb: (ids: string[]) => `${QUALYS_BASE_URL}/api/2.0/fo/knowledge_base/vuln/?action=list&details=All&ids=${ids.join(",")}`,
};

const basicAuth = () => `Basic ${btoa(`${QUALYS_USERNAME}:${QUALYS_PASSWORD}`)}`;

async function request(admin: Admin, url: string): Promise<number> {
  const { data, error } = await admin.rpc("qualys_http_get", { url, auth: basicAuth(), timeout_ms: REQUEST_TIMEOUT_MS });
  if (error) throw new Error(`Appel Qualys : ${error.message}`);
  return Number(data);
}

async function response(admin: Admin, id: number): Promise<Row | null> {
  const { data, error } = await admin.rpc("qualys_http_response", { request_id: id });
  if (error) throw new Error(`Réponse Qualys : ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

async function savePage(admin: Admin, snapshotId: string, kind: string, page: number, agg: unknown) {
  const { error } = await admin.from("qualys_pages").upsert({ snapshot_id: snapshotId, kind, page, agg });
  if (error) throw new Error(`Enregistrement de la page : ${error.message}`);
}

type StepOutcome = "advanced" | "waiting" | "skipped" | "finished";

/**
 * Fait avancer la photo en cours d'une étape. Verrou (step_lock_until) : deux passages
 * ne travaillent jamais en même temps sur la même photo.
 */
async function advance(admin: Admin, snapId: string): Promise<StepOutcome> {
  const nowIso = new Date().toISOString();
  const { data: snap } = await admin.from("qualys_snapshots")
    .update({ step_lock_until: new Date(Date.now() + STEP_LEASE_MS).toISOString() })
    .eq("id", snapId).eq("status", "running").lt("step_lock_until", nowIso)
    .select("id, state, started_at").maybeSingle();
  if (!snap) return "skipped";

  const state: Row = { phase: "hosts", page: 0, pages: 0, attempts: 0, ...snap.state };
  const save = async (patch: Row = {}) => {
    const { error } = await admin.from("qualys_snapshots").update({ state, step_lock_until: "epoch", ...patch }).eq("id", snapId);
    if (error) throw new Error(error.message);
  };
  const fail = async (message: string) => {
    if (state.request) await admin.rpc("qualys_http_forget", { request_id: state.request });
    await save({ status: "error", last_error: message, finished_at: new Date().toISOString() });
    return "finished" as const;
  };

  if (Date.now() - Date.parse(snap.started_at) > RUN_TIMEOUT_MS) return await fail("Calcul abandonné : durée maximale dépassée.");

  // 1. Une réponse est attendue
  if (state.request) {
    const res = await response(admin, state.request);
    if (!res) {
      if (Date.now() - Date.parse(state.requestedAt) > REQUEST_TIMEOUT_MS + 5 * 60_000) {
        state.request = null;
        if (++state.attempts >= MAX_ATTEMPTS) return await fail("Qualys ne répond pas.");
      }
      await save();
      return "waiting";
    }
    const content = String(res.content ?? "");
    const id = state.request;
    state.request = null;
    if (res.status_code === 409 || /concurrency|rate limit/i.test(qualysError(content) ?? "")) {
      // Limite d'appels simultanés ou horaire atteinte : on repassera plus tard
      state.waitUntil = new Date(Date.now() + CONCURRENCY_WAIT_MS).toISOString();
      await admin.rpc("qualys_http_forget", { request_id: id });
      await save();
      return "waiting";
    }
    const err = res.timed_out ? "Délai dépassé" : res.error_msg ? String(res.error_msg)
      : res.status_code !== 200 ? (qualysError(content) ?? `HTTP ${res.status_code}`) : qualysError(content);
    await admin.rpc("qualys_http_forget", { request_id: id });
    if (err) {
      if (res.status_code === 401 || /login|password/i.test(err)) return await fail(`Identifiants Qualys refusés : ${err}`);
      if (++state.attempts >= MAX_ATTEMPTS) return await fail(`Qualys : ${err}`);
      await save();
      return "waiting";
    }
    // Chiffres de la page, puis page suivante ou étape suivante
    const now = Date.now();
    state.attempts = 0;
    if (state.phase === "kb") {
      await savePage(admin, snapId, "kb", state.page, kbPage(content));
      state.page++;
      state.next = null;
      if (state.page >= state.kbChunks) state.phase = "final";
    } else {
      const agg = state.phase === "hosts" ? hostsPage(content, now) : detectionsPage(content, now);
      await savePage(admin, snapId, state.phase, state.page, agg);
      state.page++;
      state.pages++;
      if (state.phase === "hosts") state.hostsTotal = (state.hostsTotal ?? 0) + (agg as Row).total;
      state.next = nextPageUrl(content, QUALYS_BASE_URL);
      if (!state.next) {
        if (state.phase === "hosts") {
          state.phase = "detections";
          state.page = 0;
        } else {
          // Liste des vulnérabilités rencontrées, pour la base de connaissances
          const { data: pages } = await admin.from("qualys_pages").select("agg").eq("snapshot_id", snapId).eq("kind", "detections");
          const ids = [...new Set((pages ?? []).flatMap((p: Row) => Object.keys(p.agg.qids ?? {})))].sort((a, b) => Number(a) - Number(b));
          state.kbIds = ids;
          state.kbChunks = Math.ceil(ids.length / KB_CHUNK);
          state.phase = ids.length ? "kb" : "final";
          state.page = 0;
        }
      }
    }
    await save();
    return "advanced";
  }

  if (state.waitUntil && Date.parse(state.waitUntil) > Date.now()) {
    await save();
    return "waiting";
  }
  state.waitUntil = null;

  // 2. Fin : photo
  if (state.phase === "final") {
    const { data: pages, error } = await admin.from("qualys_pages").select("kind, agg").eq("snapshot_id", snapId);
    if (error) throw new Error(error.message);
    const results = buildResults(pages ?? [], Date.now());
    state.kbIds = undefined;
    await save({ status: "done", results, summary: summaryOf(results), finished_at: new Date().toISOString() });
    await admin.from("qualys_pages").delete().eq("snapshot_id", snapId);
    return "finished";
  }

  // 3. Demande suivante
  const url = state.phase === "kb"
    ? firstUrl.kb(state.kbIds.slice(state.page * KB_CHUNK, (state.page + 1) * KB_CHUNK))
    : state.next ?? firstUrl[state.phase as "hosts" | "detections"]();
  state.request = await request(admin, url);
  state.requestedAt = new Date().toISOString();
  await save();
  return "advanced";
}

async function runningSnapshot(admin: Admin): Promise<Row | null> {
  const { data } = await admin.from("qualys_snapshots").select("id, started_at").eq("status", "running").limit(1).maybeSingle();
  return data;
}

/** Tâche planifiée : démarre une photo (start) et la fait avancer pendant ~110 s. */
async function handleCron(admin: Admin, start: boolean) {
  if (start && !(await runningSnapshot(admin))) {
    const { error } = await admin.from("qualys_snapshots").insert({ state: { phase: "hosts", page: 0, pages: 0, attempts: 0 } });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  const deadline = Date.now() + CRON_BUDGET_MS;
  let snap = await runningSnapshot(admin);
  while (snap && Date.now() < deadline) {
    const outcome = await advance(admin, snap.id);
    if (outcome === "skipped" || outcome === "finished") break;
    // Réponse attendue : Qualys met ~1 min 30, on repasse régulièrement tant que le budget le permet
    if (outcome === "waiting") {
      if (Date.now() + POLL_MS > deadline) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    snap = await runningSnapshot(admin);
  }
  return jsonResponse({ running: Boolean(await runningSnapshot(admin)) });
}

/** Écran : dernière photo terminée et avancement du calcul en cours. */
async function handleStatus(admin: Admin) {
  const { data: latest } = await admin.from("qualys_snapshots").select("started_at, finished_at, results")
    .eq("status", "done").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const { data: running } = await admin.from("qualys_snapshots").select("started_at, state").eq("status", "running").limit(1).maybeSingle();
  const { data: failed } = await admin.from("qualys_snapshots").select("started_at, last_error")
    .eq("status", "error").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const progress = running && {
    startedAt: running.started_at,
    phase: running.state?.phase ?? "hosts",
    pages: running.state?.pages ?? 0,
    // Nombre de pages attendu : liste des actifs + vulnérabilités (une page pour 150 actifs)
    expected: running.state?.hostsTotal ? Math.ceil(running.state.hostsTotal / HOST_PAGE) + Math.ceil(running.state.hostsTotal / DETECTION_PAGE) : null,
  };
  return jsonResponse({
    latest: latest ? { date: latest.finished_at ?? latest.started_at, ...latest.results } : null,
    running: progress,
    // Dernier échec, s'il est plus récent que la dernière photo
    lastError: failed && (!latest || failed.started_at > latest.started_at) ? failed.last_error : null,
  });
}

/** Évolution : la dernière photo de chaque jour. */
async function handleHistory(admin: Admin) {
  const { data, error } = await admin.from("qualys_snapshots").select("started_at, summary")
    .eq("status", "done").not("summary", "is", null).order("started_at", { ascending: true }).limit(400);
  if (error) throw new Error(error.message);
  const byDay = new Map<string, Row>();
  for (const s of data ?? []) byDay.set(String(s.started_at).slice(0, 10), { date: s.started_at, ...s.summary });
  return jsonResponse({ points: [...byDay.values()] });
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body: Row = await req.json().catch(() => ({}));
    if (!QUALYS_USERNAME || !QUALYS_PASSWORD) return jsonResponse({ error: "Qualys non configuré côté serveur (secrets manquants)" }, 500);

    // Tâche planifiée : authentifiée par un secret partagé
    if (body.action === "cron") {
      if (!CRON_SECRET || !sameSecret(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return jsonResponse({ error: "Non autorisé" }, 401);
      return await handleCron(adminClient(), body.start === true);
    }

    // Écran : utilisateur connecté
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Non authentifié" }, 401);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Session invalide" }, 401);

    if (body.action === "history") return await handleHistory(adminClient());
    return await handleStatus(adminClient());
  } catch (err) {
    console.error("Erreur qualys-proxy:", (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
