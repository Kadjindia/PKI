// Diagnostic des accès Qualys : un petit appel en lecture seule par module, pour savoir
// ce que le compte configuré peut interroger par l'API. L'API voit exactement ce que
// voit le compte dans la console : un module absent de ses droits répond « refusé ».
// Aucune donnée n'est renvoyée à l'écran, seulement un statut (et un nombre quand l'API
// en donne un).

export type ProbeStatus = "ok" | "refused" | "unknown" | "error";

export interface ProbeResult {
  module: string;
  label: string;
  /** À quoi sert le module dans le tableau de bord. */
  purpose: string;
  status: ProbeStatus;
  detail: string;
  count?: number | null;
}

const TIMEOUT_MS = 20_000;

/** Adresse de la Gateway Qualys (API par jeton) déduite de l'adresse de l'API classique. */
export function gatewayUrl(apiBase: string, override?: string | null): string {
  if (override) return override.trim().replace(/\/$/, "");
  const u = new URL(apiBase);
  return `${u.protocol}//${u.host.replace(/^qualysapi\./, "gateway.")}`;
}

/** Statut d'une réponse Qualys, quel que soit le format (XML classique, QPS, JSON). */
export function classify(httpStatus: number, body: string): { status: ProbeStatus; detail: string; count: number | null } {
  const text = body.slice(0, 4000);
  const code = /<CODE>(\d+)<\/CODE>/.exec(text)?.[1];
  const msg = /<TEXT>([\s\S]*?)<\/TEXT>/.exec(text)?.[1]?.trim();
  const qps = /<responseCode>([A-Z_]+)<\/responseCode>/.exec(text)?.[1] ?? /"responseCode"\s*:\s*"([A-Z_]+)"/.exec(text)?.[1];
  const countRaw = /<count>(\d+)<\/count>/.exec(text)?.[1] ?? /"count"\s*:\s*(\d+)/.exec(text)?.[1] ?? /"totalElements"\s*:\s*(\d+)/.exec(text)?.[1];
  const count = countRaw ? Number(countRaw) : null;
  const refusedText = /not authorized|unauthori[sz]ed|forbidden|permission|not (?:enabled|subscribed)|subscription|access denied|bad login/i;

  if (httpStatus === 401 || httpStatus === 403) return { status: "refused", detail: msg ?? `Accès refusé (HTTP ${httpStatus})`, count: null };
  if (qps && /UNAUTHORIZED|INVALID_CREDENTIALS|NOT_AUTHORIZED|PERMISSION/.test(qps)) return { status: "refused", detail: `Accès refusé (${qps})`, count: null };
  if (code && msg && refusedText.test(msg)) return { status: "refused", detail: `${msg} (code ${code})`, count: null };
  if (httpStatus === 404) return { status: "unknown", detail: "Point d'accès introuvable : version d'API à vérifier", count: null };
  if (httpStatus === 409 || httpStatus === 429) return { status: "error", detail: "Qualys est occupé (limite d'appels) : relancer plus tard", count: null };
  if (httpStatus >= 200 && httpStatus < 300) {
    if (qps && qps !== "SUCCESS") return { status: "error", detail: `Réponse ${qps}`, count };
    if (code && msg && text.includes("<SIMPLE_RETURN>")) return { status: "error", detail: `${msg} (code ${code})`, count };
    return { status: "ok", detail: "Autorisé", count };
  }
  return { status: "error", detail: msg ?? `Réponse inattendue (HTTP ${httpStatus})`, count: null };
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.text() };
}

interface Probe {
  module: string; label: string; purpose: string;
  gateway: boolean;
  path: string;
  method?: "GET" | "POST";
  contentType?: string;
  body?: string;
}

// Chaque appel ne lit qu'un élément ou un nombre
const PROBES: Probe[] = [
  { module: "VMDR", label: "Vulnerability Management (VMDR)", purpose: "Axes 2 et 3 : vulnérabilités, délais de correction", gateway: false,
    path: "/api/5.0/fo/asset/host/?action=list&truncation_limit=1" },
  { module: "CA", label: "Cloud Agent", purpose: "Axe 1 : déploiement de l'agent", gateway: false,
    path: "/qps/rest/2.0/count/am/hostasset", method: "POST", contentType: "text/xml", body: "<ServiceRequest></ServiceRequest>" },
  { module: "CSAM", label: "CyberSecurity Asset Management", purpose: "Axe 1 : inventaire, obsolescence, Shadow IT", gateway: true,
    path: "/rest/2.0/count/am/asset", method: "POST", contentType: "application/json", body: "{}" },
  { module: "PA", label: "Policy Audit (conformité)", purpose: "Axe 4 : conformité CIS / ANSSI", gateway: false,
    path: "/api/2.0/fo/compliance/policy/?action=list&details=Basic" },
  { module: "WAS", label: "Web Application Scanning (TotalAppSec)", purpose: "Axe 5 : sécurité applicative", gateway: false,
    path: "/qps/rest/3.0/count/was/webapp", method: "POST", contentType: "text/xml", body: "<ServiceRequest></ServiceRequest>" },
  { module: "TC", label: "TotalCloud", purpose: "Axe 4 : conformité des environnements cloud", gateway: true,
    path: "/cloudview-api/rest/v1/aws/connectors?pageNo=0&pageSize=1" },
  { module: "CS", label: "Container Security", purpose: "Axe 4 : conteneurs", gateway: true,
    path: "/csapi/v1.3/images?pageNumber=1&pageSize=1" },
];

/** Jeton de la Gateway (CSAM, TotalCloud, Container Security). */
async function gatewayToken(gateway: string, username: string, password: string): Promise<{ token: string | null; detail: string; refused: boolean }> {
  try {
    const res = await call(`${gateway}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, token: "true" }).toString(),
    });
    if (res.status >= 200 && res.status < 300 && res.body.trim().split(".").length === 3) return { token: res.body.trim(), detail: "", refused: false };
    return { token: null, detail: `Connexion à la Gateway refusée (HTTP ${res.status})`, refused: res.status === 401 || res.status === 403 };
  } catch (e) {
    return { token: null, detail: `Gateway injoignable : ${(e as Error).message}`, refused: false };
  }
}

export async function runDiagnostic(apiBase: string, username: string, password: string, gatewayOverride?: string | null) {
  const gateway = gatewayUrl(apiBase, gatewayOverride);
  const basic = `Basic ${btoa(`${username}:${password}`)}`;
  let gw: Awaited<ReturnType<typeof gatewayToken>> | null = null;
  const results: ProbeResult[] = [];
  // Un appel à la fois : l'abonnement n'en autorise que 2 simultanés (le calcul de nuit peut en utiliser un)
  for (const p of PROBES) {
    const base = { module: p.module, label: p.label, purpose: p.purpose };
    try {
      let auth = basic;
      if (p.gateway) {
        gw ??= await gatewayToken(gateway, username, password);
        if (!gw.token) { results.push({ ...base, status: gw.refused ? "refused" : "error", detail: gw.detail }); continue; }
        auth = `Bearer ${gw.token}`;
      }
      const res = await call(`${p.gateway ? gateway : apiBase}${p.path}`, {
        method: p.method ?? "GET",
        headers: { Authorization: auth, "X-Requested-With": "pki-dashboard", Accept: p.gateway ? "application/json" : "application/xml", ...(p.contentType ? { "Content-Type": p.contentType } : {}) },
        body: p.body,
      });
      const c = classify(res.status, res.body);
      results.push({ ...base, status: c.status, detail: c.detail, count: c.count });
    } catch (e) {
      results.push({ ...base, status: "error", detail: `Pas de réponse : ${(e as Error).message}` });
    }
  }
  return { checkedAt: new Date().toISOString(), apiBase, gateway, results };
}
