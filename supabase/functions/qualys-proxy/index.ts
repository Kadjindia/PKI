import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  hostsPage, detectionsPage, fixedPage, kbPage, policiesPage, posturePage, mergePosture, buildResults, summaryOf, vulnIndex, qualysError, nextPageUrl,
  csamPage, wasPage, splitHosts, fixedRowsOfPages, qualysDate, FIXED_WINDOW_DAYS, TOP_RISK,
  type FixedRow,
} from "./parse.ts";
import { runDiagnostic, gatewayToken, gatewayUrl } from "./diagnostic.ts";

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
// Étapes : hosts (liste des actifs, couverture, TruRisk) -> detections (vulnérabilités
// de sévérité 3 à 5 ouvertes, dérogations comprises) -> fixed (vulnérabilités corrigées
// sur 90 jours : délais réels) -> kb (titres, CISA KEV, ransomware, exploit public,
// corrigeable) -> policies et posture (conformité Policy Audit ; une erreur à ces étapes
// n'empêche pas la photo) -> csam (inventaire : agents, Shadow IT, fin de support des systèmes)
// -> was (applications web) -> photo, et index des vulnérabilités pour la recherche d'exposition.
// CSAM et WAS sont appelés directement (réponses rapides) ; une erreur y est notée sans
// empêcher la photo.
// ---------------------------------------------------------------------------

const HOST_PAGE = 1000; // actifs par page de la liste des actifs (~1 s par actif chez Qualys)
const DETECTION_PAGE = 100; // actifs par page de vulnérabilités (sévérités 3 à 5 : pages de taille comparable à 150 actifs en 4-5)
const KB_CHUNK = 400; // vulnérabilités par appel à la base de connaissances
const POSTURE_PAGE = 200; // actifs par page de l'état de conformité
const MAX_POLICIES = 20; // politiques de conformité suivies au plus
const KEEP_INDEX = 60; // photos dont on garde l'index des vulnérabilités (recherche, tendance)

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // attente maximale d'une réponse de Qualys
const CONCURRENCY_WAIT_MS = 3 * 60 * 1000; // pause si les 2 appels simultanés sont pris
const MAX_ATTEMPTS = 3;
const RUN_TIMEOUT_MS = 12 * 60 * 60 * 1000;
// La conformité (Policy Audit) est lente : budget par nuit. Les politiques non évaluées
// sont reprises en priorité la nuit suivante ; leur dernier résultat reste affiché.
const COMPLIANCE_BUDGET_MS = 3 * 60 * 60 * 1000;
// CSAM et WAS : appel direct depuis la fonction, attente limitée au temps restant du passage
const DIRECT_TIMEOUT_MS = 100_000;
const CSAM_PAGE = 100;
// Champs volumineux dont le tableau de bord n'a pas besoin (logiciels installés surtout) : réponse plus légère.
// Si Qualys refuse ce paramètre, la lecture reprend sans lui.
const CSAM_EXCLUDE = "software,openPort,volume,networkInterface,service,userAccount,processor";
// Lecture de conformité interrompue (budget de temps) : reprise à cet endroit la nuit suivante
const PC_PROGRESS_KEY = "pc_progress";
const PC_PROGRESS_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const WAS_PAGE = 1000;
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
  detections: (range: { min?: number; max?: number } = {}) => `${QUALYS_BASE_URL}/api/5.0/fo/asset/host/vm/detection/?action=list&severities=3-5&status=New,Active,Re-Opened&include_ignored=1&show_results=0&show_qds=1&truncation_limit=${DETECTION_PAGE}${range.min != null ? `&id_min=${range.min}` : ""}${range.max != null ? `&id_max=${range.max}` : ""}`,
  fixed: (sinceIso: string) => `${QUALYS_BASE_URL}/api/5.0/fo/asset/host/vm/detection/?action=list&severities=3-5&status=Fixed&detection_updated_since=${sinceIso}&show_results=0&truncation_limit=${DETECTION_PAGE}`,
  policies: () => `${QUALYS_BASE_URL}/api/2.0/fo/compliance/policy/?action=list&details=Basic`,
  posture: (policyId: string) => `${QUALYS_BASE_URL}/api/2.0/fo/compliance/posture/info/?action=list&policy_id=${encodeURIComponent(policyId)}&details=Basic&truncation_limit=${POSTURE_PAGE}`,
  kb: (ids: string[]) => `${QUALYS_BASE_URL}/api/2.0/fo/knowledge_base/vuln/?action=list&details=All&ids=${ids.join(",")}`,
};

/** Début de la période d'observation des vulnérabilités corrigées. */
const fixedSince = () => new Date(Date.now() - FIXED_WINDOW_DAYS * 24 * 3600 * 1000);
/** Corrections comptées avec un jour de décalage : Qualys peut traiter un scan quelques heures après coup. */
const FIXED_LAG_MS = 24 * 3600 * 1000;
/** Conformité : une politique est réévaluée au plus une fois par semaine. */
const COMPLIANCE_REFRESH_MS = 6 * 24 * 3600 * 1000;

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

/** Index des vulnérabilités de la photo (recherche d'exposition), et ménage des anciens index. */
async function saveIndex(admin: Admin, snapId: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    // upsert : l'étape finale peut être rejouée après une interruption
    const { error } = await admin.from("qualys_vulns").upsert(rows.slice(i, i + 1000).map((r) => ({ snapshot_id: snapId, ...r })), { onConflict: "snapshot_id,qid" });
    if (error) throw new Error(`Index des vulnérabilités : ${error.message}`);
  }
  const { data: old } = await admin.from("qualys_snapshots").select("id").eq("status", "done")
    .order("started_at", { ascending: false }).range(KEEP_INDEX - 1, KEEP_INDEX + 500);
  const ids = (old ?? []).map((r: Row) => r.id);
  if (ids.length) await admin.from("qualys_vulns").delete().in("snapshot_id", ids);
}

/** Vulnérabilités « fin de vie » connues d'après la dernière photo (titres EOL/Obsolete de son index). */
async function knownEolQids(admin: Admin): Promise<string[]> {
  const { data: last } = await admin.from("qualys_snapshots").select("id").eq("status", "done")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) return [];
  const { data } = await admin.from("qualys_vulns").select("qid").eq("snapshot_id", last.id).ilike("title", "EOL%Obsolete%").limit(5000);
  return (data ?? []).map((r: Row) => String(r.qid));
}

/** Jeton de la Gateway (CSAM), gardé le temps de son utilisation (valable 4 h chez Qualys). */
let gwCache: { token: string; until: number } | null = null;
async function gatewayAuth(): Promise<string> {
  if (gwCache && gwCache.until > Date.now()) return gwCache.token;
  const gw = await gatewayToken(gatewayUrl(QUALYS_BASE_URL, Deno.env.get("QUALYS_GATEWAY_URL")), QUALYS_USERNAME!, QUALYS_PASSWORD!);
  if (!gw.token) throw new Error(gw.detail);
  gwCache = { token: gw.token, until: Date.now() + 3 * 3600 * 1000 };
  return gw.token;
}

async function directFetch(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.text() };
}

/** Une page de CSAM ou de WAS. Une erreur persistante est notée (csamerror / waserror) et l'on passe à la suite. */
async function directStep(admin: Admin, snapId: string, state: Row, save: (patch?: Row) => Promise<unknown>, deadline: number): Promise<StepOutcome> {
  const phase = state.phase as "csam" | "was";
  // Pas assez de temps dans ce passage pour attendre une réponse : le suivant s'en charge
  const timeoutMs = Math.min(DIRECT_TIMEOUT_MS, deadline - Date.now() - 5_000);
  if (timeoutMs < 30_000) { await save(); return "waiting"; }
  const nextPhase = () => {
    state.phase = phase === "csam" ? "was" : "policies";
    if (state.phase === "policies") state.pcStartedAt = new Date().toISOString();
    state.page = 0; state.next = null; state.attempts = 0;
  };
  try {
    const now = Date.now();
    if (phase === "csam") {
      const gw = gatewayUrl(QUALYS_BASE_URL, Deno.env.get("QUALYS_GATEWAY_URL"));
      const url = `${gw}/rest/2.0/search/am/asset?pageSize=${CSAM_PAGE}${state.csamPlain ? "" : `&excludeFields=${CSAM_EXCLUDE}`}${state.next ? `&lastSeenAssetId=${encodeURIComponent(state.next)}` : ""}`;
      const res = await directFetch(url, { method: "POST", headers: { Authorization: `Bearer ${await gatewayAuth()}`, "Content-Type": "application/json", Accept: "application/json" }, body: "{}" }, timeoutMs);
      if (res.status === 401) gwCache = null;
      if (res.status === 400 && !state.csamPlain) { state.csamPlain = true; await save(); return "waiting"; }
      if (res.status < 200 || res.status >= 300) throw new Error(`CSAM : HTTP ${res.status}`);
      const json = JSON.parse(res.body);
      if (json.responseCode && json.responseCode !== "SUCCESS") throw new Error(`CSAM : ${json.responseCode} ${json.responseMessage ?? ""}`.trim());
      const { agg, next } = csamPage(json, now);
      await savePage(admin, snapId, "csam", state.page, agg);
      state.page++;
      state.next = next;
    } else {
      const filters = `<Criteria field="type" operator="EQUALS">VULNERABILITY</Criteria>${state.next ? `<Criteria field="id" operator="GREATER">${Number(state.next)}</Criteria>` : ""}`;
      const body = `<ServiceRequest><preferences><limitResults>${WAS_PAGE}</limitResults></preferences><filters>${filters}</filters></ServiceRequest>`;
      const res = await directFetch(`${QUALYS_BASE_URL}/qps/rest/3.0/search/was/finding`, {
        method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "text/xml", Accept: "application/xml", "X-Requested-With": "pki-dashboard" }, body,
      }, timeoutMs);
      const code = /<responseCode>([A-Z_]+)<\/responseCode>/.exec(res.body)?.[1];
      if (res.status < 200 || res.status >= 300 || (code && code !== "SUCCESS")) throw new Error(`WAS : ${code ?? `HTTP ${res.status}`}`);
      const { agg, next } = wasPage(res.body, now, fixedSince().getTime());
      await savePage(admin, snapId, "was", state.page, agg);
      state.page++;
      state.next = next;
    }
    state.attempts = 0;
    if (!state.next) nextPhase();
    await save();
    return "advanced";
  } catch (e) {
    if (++state.attempts < MAX_ATTEMPTS) { await save(); return "waiting"; }
    await savePage(admin, snapId, `${phase}error`, 0, { message: (e as Error).message });
    nextPhase();
    await save();
    return "advanced";
  }
}

/** Liste des vulnérabilités rencontrées, pour la base de connaissances (titres, menaces). */
async function enterKb(admin: Admin, snapId: string, state: Row) {
  const { data: pages } = await admin.from("qualys_pages").select("agg").eq("snapshot_id", snapId).eq("kind", "detections");
  const ids = [...new Set((pages ?? []).flatMap((p: Row) => Object.keys(p.agg.qids ?? {})))].sort((a, b) => Number(a) - Number(b));
  state.kbIds = ids;
  state.kbChunks = Math.ceil(ids.length / KB_CHUNK);
  state.phase = ids.length ? "kb" : "csam";
  state.page = 0;
}

/** Début de la lecture des vulnérabilités corrigées : depuis le dernier calcul (curseur), ou 90 jours au premier passage. */
async function enterFixed(admin: Admin, state: Row) {
  let cursor: string | null = null;
  try {
    const { data } = await admin.from("qualys_meta").select("value").eq("key", "fixed_cursor").maybeSingle();
    cursor = data?.value ?? null;
  } catch { cursor = null; }
  // Dates toujours ramenées à la forme ISO « …Z » (la base renvoie « …+00:00 »)
  const cursorMs = cursor ? Date.parse(String(cursor)) : NaN;
  const floorMs = fixedSince().getTime();
  const untilMs = Date.now() - FIXED_LAG_MS;
  const sinceMs = Math.min(Number.isFinite(cursorMs) && cursorMs > floorMs ? cursorMs : floorMs, untilMs - 1000);
  state.fixedSince = new Date(sinceMs).toISOString();
  state.fixedUntil = new Date(untilMs).toISOString();
  state.phase = "fixed";
  state.page = 0;
  state.next = null;
}

/**
 * Ajoute les corrections lues à la table cumulée et avance le curseur (une transaction, idempotente
 * par photo), puis renvoie l'historique (13 mois). Si la table n'existe pas (migration non appliquée),
 * on se contente des corrections lues pendant la photo.
 */
async function mergeFixed(admin: Admin, snapId: string, pages: { kind: string; agg: Row }[], state: Row): Promise<FixedRow[] | undefined> {
  if (state.fixedUntil) {
    const { error } = await admin.rpc("qualys_merge_fixed", { snapshot: snapId, rows: fixedRowsOfPages(pages), new_cursor: state.fixedUntil });
    if (error) { console.error("Cumul des corrections :", error.message); return undefined; }
  }
  // Sans lecture cette nuit (erreur Qualys), l'historique déjà en base sert aux indicateurs
  const since = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows: FixedRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await admin.from("qualys_fixed_daily").select("day, severity, asset_type, n, in_sla, days_sum, hist").gte("day", since).range(from, from + 999);
    if (e) { console.error("Lecture des corrections :", e.message); return undefined; }
    rows.push(...((data ?? []) as FixedRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** Vulnérabilités ouvertes, deux plages d'actifs à la fois (l'abonnement autorise deux appels simultanés). */
async function advanceLanes(admin: Admin, snapId: string, state: Row, save: (patch?: Row) => Promise<unknown>, fail: (m: string) => Promise<StepOutcome>): Promise<StepOutcome> {
  let progressed = false;
  for (const [i, lane] of (state.lanes as Row[]).entries()) {
    if (lane.done) continue;
    if (lane.request) {
      const res = await response(admin, lane.request);
      if (!res) {
        if (Date.now() - Date.parse(lane.requestedAt) > REQUEST_TIMEOUT_MS + 5 * 60_000) {
          lane.request = null;
          if (++lane.attempts >= MAX_ATTEMPTS) return await fail("Qualys ne répond pas.");
        }
        continue;
      }
      const content = String(res.content ?? "");
      const id = lane.request;
      lane.request = null;
      await admin.rpc("qualys_http_forget", { request_id: id });
      if (res.status_code === 409 || /concurrency|rate limit/i.test(qualysError(content) ?? "")) {
        lane.waitUntil = new Date(Date.now() + CONCURRENCY_WAIT_MS).toISOString();
        continue;
      }
      const err = res.timed_out ? "Délai dépassé" : res.error_msg ? String(res.error_msg)
        : res.status_code !== 200 ? (qualysError(content) ?? `HTTP ${res.status_code}`) : qualysError(content);
      if (err) {
        if (res.status_code === 401 || /login|password/i.test(err)) return await fail(`Identifiants Qualys refusés : ${err}`);
        if (++lane.attempts >= MAX_ATTEMPTS) return await fail(`Qualys : ${err}`);
        continue;
      }
      lane.attempts = 0;
      await savePage(admin, snapId, "detections", i * 100_000 + lane.page, detectionsPage(content, Date.now(), state.watch ?? [], state.eolQids ?? []));
      lane.page++;
      state.pages++;
      lane.next = nextPageUrl(content, QUALYS_BASE_URL);
      if (!lane.next) lane.done = true;
      progressed = true;
    }
    if (!lane.done && !lane.request && !(lane.waitUntil && Date.parse(lane.waitUntil) > Date.now())) {
      lane.request = await request(admin, lane.next ?? firstUrl.detections(lane.range));
      lane.requestedAt = new Date().toISOString();
      lane.waitUntil = null;
      progressed = true;
    }
  }
  if ((state.lanes as Row[]).every((l) => l.done)) {
    state.lanes = undefined;
    await enterFixed(admin, state);
  }
  await save();
  return progressed ? "advanced" : "waiting";
}

/** Conformité de la dernière photo, par politique (reprise pour les politiques non réévaluées). */
async function previousPolicies(admin: Admin): Promise<Row[]> {
  const { data } = await admin.from("qualys_snapshots").select("results").eq("status", "done")
    .not("results->compliance", "is", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.results?.compliance?.policies ?? []) as Row[];
}

/** Date de dernière évaluation de chaque politique. */
async function lastPolicyDates(admin: Admin): Promise<Record<string, string>> {
  return Object.fromEntries((await previousPolicies(admin)).map((p) => [p.id, p.evaluatedAt ?? ""]));
}

/** Lecture de conformité interrompue : politique, page suivante et chiffres déjà lus. */
async function pcProgress(admin: Admin): Promise<Row | null> {
  const { data } = await admin.from("qualys_meta").select("value").eq("key", PC_PROGRESS_KEY).maybeSingle();
  const v = data?.value as Row | undefined;
  if (!v?.policyId || !v.next || !v.agg || !(Date.now() - Date.parse(v.savedAt ?? "") < PC_PROGRESS_MAX_AGE_MS)) return null;
  return v;
}

async function setPcProgress(admin: Admin, value: Row | null) {
  const { error } = value
    ? await admin.from("qualys_meta").upsert({ key: PC_PROGRESS_KEY, value })
    : await admin.from("qualys_meta").delete().eq("key", PC_PROGRESS_KEY);
  if (error) throw new Error(`Reprise de la conformité : ${error.message}`);
}

/** Budget écoulé au milieu d'une politique : on note où reprendre et ce qui est déjà lu. */
async function savePcProgress(admin: Admin, snapId: string, state: Row) {
  const policyId = state.policyIds?.[state.policyIdx];
  if (state.phase !== "posture" || !policyId || !state.next) return;
  const { data } = await admin.from("qualys_pages").select("agg").eq("snapshot_id", snapId).eq("kind", "posture");
  const agg = mergePosture((data ?? []).map((p: Row) => p.agg).filter((a: Row) => a.policyId === policyId));
  if (agg) await setPcProgress(admin, { policyId, next: state.next, agg, savedAt: new Date().toISOString() });
}

type StepOutcome = "advanced" | "waiting" | "skipped" | "finished";

/**
 * Fait avancer la photo en cours d'une étape. Verrou (step_lock_until) : deux passages
 * ne travaillent jamais en même temps sur la même photo.
 */
async function advance(admin: Admin, snapId: string, deadline: number): Promise<StepOutcome> {
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

  // Le temps manque pendant les dernières étapes : on garde tout ce qui est fini plutôt que de tout perdre
  const elapsed = Date.now() - Date.parse(snap.started_at);
  const nearEnd = elapsed > RUN_TIMEOUT_MS - 20 * 60_000;
  const pcOver = (state.phase === "policies" || state.phase === "posture") && state.pcStartedAt && Date.now() - Date.parse(state.pcStartedAt) > COMPLIANCE_BUDGET_MS;
  if (pcOver || (nearEnd && ["csam", "was", "policies", "posture"].includes(state.phase))) {
    if (state.request) await admin.rpc("qualys_http_forget", { request_id: state.request });
    state.request = null;
    await savePcProgress(admin, snapId, state);
    if (state.phase === "policies" || state.phase === "posture") {
      await savePage(admin, snapId, "pcmeta", 0, { done: state.pcDone ?? [], total: state.pcTotal ?? state.policyIds?.length ?? 0, stopped: true });
    } else {
      await savePage(admin, snapId, `${state.phase}error`, 0, { message: "Interrompu : durée maximale du calcul atteinte." });
    }
    state.phase = "final";
    await save();
    return "advanced";
  }
  if (elapsed > RUN_TIMEOUT_MS) return await fail("Calcul abandonné : durée maximale dépassée.");

  // Vulnérabilités ouvertes : deux lectures en parallèle
  if (state.phase === "detections" && state.lanes) return await advanceLanes(admin, snapId, state, save, fail);

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
    if (err && state.phase === "fixed") {
      // Vulnérabilités corrigées illisibles cette nuit : on le note, le curseur n'avance pas (rien n'est
      // perdu pour le calcul suivant) et l'historique déjà en base sert aux indicateurs
      if (++state.attempts < MAX_ATTEMPTS && !/invalid|unsupported|parameter/i.test(err)) { await save(); return "waiting"; }
      await savePage(admin, snapId, "fixederror", 0, { message: err });
      await admin.from("qualys_pages").delete().eq("snapshot_id", snapId).eq("kind", "fixed");
      state.fixedUntil = undefined;
      state.attempts = 0;
      state.next = null;
      await enterKb(admin, snapId, state);
      await save();
      return "advanced";
    }
    if (err && (state.phase === "policies" || state.phase === "posture")) {
      // Conformité indisponible (droits, module) : on le note et on termine la photo
      if (++state.attempts < MAX_ATTEMPTS && !/not authorized|permission|subscri|401|403/i.test(`${err} ${res.status_code}`)) { await save(); return "waiting"; }
      await savePage(admin, snapId, "pcerror", 0, { message: err });
      // Une reprise devenue illisible ne doit pas bloquer les nuits suivantes
      await setPcProgress(admin, null);
      state.attempts = 0;
      state.phase = "final";
      await save();
      return "advanced";
    }
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
      if (state.page >= state.kbChunks) { state.phase = "csam"; state.page = 0; }
    } else if (state.phase === "policies") {
      const list = policiesPage(content).slice(0, MAX_POLICIES);
      await savePage(admin, snapId, "policies", 0, { list });
      // Les politiques évaluées le moins récemment passent en premier
      // Réévaluation hebdomadaire : seules les politiques évaluées il y a plus de 6 jours (ou jamais) sont relues
      const last = await lastPolicyDates(admin);
      const due = list.map((x) => x.id).filter((id) => !last[id] || Date.now() - Date.parse(last[id]) > COMPLIANCE_REFRESH_MS);
      state.policyIds = due.sort((a, b) => (last[a] ?? "").localeCompare(last[b] ?? ""));
      state.pcTotal = list.length;
      state.policyIdx = 0;
      state.pcDone = [];
      state.page = 0;
      state.next = null;
      // Politique interrompue la nuit précédente : reprise en premier, là où la lecture s'était arrêtée
      const prog = await pcProgress(admin);
      if (prog && list.some((x) => x.id === prog.policyId)) {
        state.policyIds = [prog.policyId, ...state.policyIds.filter((id: string) => id !== prog.policyId)];
        state.next = prog.next;
        await savePage(admin, snapId, "posture", 0, prog.agg);
        state.page = 1;
      }
      if (!state.policyIds.length) { await savePage(admin, snapId, "pcmeta", 0, { done: [], total: list.length, stopped: false }); state.phase = "final"; }
      else state.phase = "posture";
    } else if (state.phase === "posture") {
      await savePage(admin, snapId, "posture", state.page, posturePage(content, state.policyIds[state.policyIdx]));
      state.page++;
      state.next = nextPageUrl(content, QUALYS_BASE_URL);
      if (!state.next) {
        state.pcDone = [...(state.pcDone ?? []), state.policyIds[state.policyIdx]];
        if (state.policyIdx === 0) await setPcProgress(admin, null);
        if (++state.policyIdx >= state.policyIds.length) {
          await savePage(admin, snapId, "pcmeta", 0, { done: state.pcDone, total: state.pcTotal ?? state.policyIds.length, stopped: false });
          state.phase = "final";
        }
      }
    } else {
      const agg = state.phase === "hosts" ? hostsPage(content, now)
        : state.phase === "detections" ? detectionsPage(content, now, state.watch ?? [], state.eolQids ?? [])
        : fixedPage(content, Date.parse(state.fixedSince ?? fixedSince().toISOString()), Date.parse(state.fixedUntil ?? new Date().toISOString()));
      await savePage(admin, snapId, state.phase, state.page, agg);
      state.page++;
      state.pages++;
      if (state.phase === "hosts") state.hostsTotal = (state.hostsTotal ?? 0) + (agg as Row).total;
      state.next = nextPageUrl(content, QUALYS_BASE_URL);
      if (!state.next) {
        if (state.phase === "hosts") {
          // Actifs les plus risqués : leurs vulnérabilités seront relevées au passage
          const { data: hp } = await admin.from("qualys_pages").select("agg").eq("snapshot_id", snapId).eq("kind", "hosts");
          state.watch = (hp ?? []).flatMap((p: Row) => p.agg.topRisk ?? [])
            .sort((a: Row, b: Row) => b.trurisk - a.trurisk).slice(0, TOP_RISK).map((h: Row) => h.id).filter(Boolean);
          state.eolQids = await knownEolQids(admin);
          // Vulnérabilités ouvertes : deux moitiés du parc lues en parallèle
          const ids = (hp ?? []).flatMap((p: Row) => (p.agg.ids ?? []) as number[]);
          state.lanes = splitHosts(ids).map((range) => ({ range, next: null, request: null, requestedAt: null, attempts: 0, page: 0, done: false, waitUntil: null }));
          state.phase = "detections";
          state.page = 0;
        } else if (state.phase === "detections") {
          await enterFixed(admin, state);
        } else {
          await enterKb(admin, snapId, state);
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
    const fixedDaily = await mergeFixed(admin, snapId, pages ?? [], state);
    const results = buildResults(pages ?? [], Date.now(), { previousPolicies: await previousPolicies(admin), fixedDaily });
    await saveIndex(admin, snapId, vulnIndex(pages ?? []));
    state.kbIds = undefined;
    state.watch = undefined;
    state.eolQids = undefined;
    state.policyIds = undefined;
    state.pcDone = undefined;
    state.lanes = undefined;
    await save({ status: "done", results, summary: summaryOf(results), finished_at: new Date().toISOString() });
    await admin.from("qualys_pages").delete().eq("snapshot_id", snapId);
    return "finished";
  }

  // 3. Inventaire (CSAM) et applications web (WAS) : appels directs
  if (state.phase === "csam" || state.phase === "was") return await directStep(admin, snapId, state, save, deadline);

  // 4. Demande suivante
  const url = state.phase === "kb"
    ? firstUrl.kb(state.kbIds.slice(state.page * KB_CHUNK, (state.page + 1) * KB_CHUNK))
    : state.phase === "policies" ? firstUrl.policies()
    : state.phase === "posture" ? state.next ?? firstUrl.posture(state.policyIds[state.policyIdx])
    : state.phase === "fixed" ? state.next ?? firstUrl.fixed(qualysDate(state.fixedSince))
    : state.phase === "detections" ? state.next ?? firstUrl.detections()
    : state.next ?? firstUrl.hosts();
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
    const outcome = await advance(admin, snap.id, deadline);
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

/** Recherche d'exposition : une CVE, un QID ou un mot du titre, dans la dernière photo, et sa tendance. */
async function handleSearch(admin: Admin, raw: unknown) {
  const q = String(raw ?? "").trim().slice(0, 100);
  if (q.length < 3) return jsonResponse({ error: "Saisir au moins 3 caractères (CVE, QID ou mot du titre)." }, 400);
  const { data: snaps } = await admin.from("qualys_snapshots").select("id, started_at").eq("status", "done")
    .order("started_at", { ascending: false }).limit(KEEP_INDEX);
  const latest = snaps?.[0];
  if (!latest) return jsonResponse({ query: q, date: null, matches: [], trend: [] });
  const cols = "qid, severity, hosts, servers, overdue, first_found, title, cves, flags";
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const found = new Map<number, Row>();
  if (/^\d+$/.test(q)) {
    const { data } = await admin.from("qualys_vulns").select(cols).eq("snapshot_id", latest.id).eq("qid", Number(q));
    for (const r of data ?? []) found.set(r.qid, r);
  }
  for (const col of ["cves", "title"]) {
    const { data, error } = await admin.from("qualys_vulns").select(cols).eq("snapshot_id", latest.id).ilike(col, like)
      .order("hosts", { ascending: false }).limit(25);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.set(r.qid, r);
  }
  const matches = [...found.values()].sort((a, b) => b.hosts - a.hosts).slice(0, 25);
  // Évolution du nombre d'actifs touchés, photo après photo, pour les vulnérabilités trouvées
  const qids = matches.slice(0, 10).map((m) => m.qid);
  const dates = new Map<string, string>((snaps ?? []).map((s: Row) => [s.id, s.started_at]));
  const trend: Row[] = [];
  if (qids.length) {
    const { data } = await admin.from("qualys_vulns").select("snapshot_id, hosts")
      .in("snapshot_id", [...dates.keys()]).in("qid", qids).limit(10000);
    const bySnap = new Map<string, number>();
    for (const r of data ?? []) bySnap.set(r.snapshot_id, (bySnap.get(r.snapshot_id) ?? 0) + r.hosts);
    // Photos sans ligne : plus aucun actif touché (après la première apparition)
    const ordered = [...dates.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    let seen = false;
    for (const [id, date] of ordered) {
      const n = bySnap.get(id) ?? 0;
      if (n) seen = true;
      if (seen) trend.push({ date, hosts: n });
    }
  }
  return jsonResponse({ query: q, date: latest.started_at, matches, trend });
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
    if (body.action === "search") return await handleSearch(adminClient(), body.q);
    if (body.action === "diagnostic") return jsonResponse(await runDiagnostic(QUALYS_BASE_URL, QUALYS_USERNAME, QUALYS_PASSWORD, Deno.env.get("QUALYS_GATEWAY_URL")));
    return await handleStatus(adminClient());
  } catch (err) {
    console.error("Erreur qualys-proxy:", (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
