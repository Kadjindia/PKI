// Gateway Qualys (API par jeton) : utilisée pour l'inventaire CSAM.

const TIMEOUT_MS = 20_000;

/** Adresse de la Gateway Qualys déduite de l'adresse de l'API classique (ou fixée par QUALYS_GATEWAY_URL). */
export function gatewayUrl(apiBase: string, override?: string | null): string {
  if (override) return override.trim().replace(/\/$/, "");
  const u = new URL(apiBase);
  return `${u.protocol}//${u.host.replace(/^qualysapi\./, "gateway.")}`;
}

/** Jeton de la Gateway, obtenu avec le compte de service. */
export async function gatewayToken(gateway: string, username: string, password: string): Promise<{ token: string | null; detail: string }> {
  try {
    const res = await fetch(`${gateway}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, token: "true" }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.text()).trim();
    if (res.ok && body.split(".").length === 3) return { token: body, detail: "" };
    return { token: null, detail: `Connexion à la Gateway refusée (HTTP ${res.status})` };
  } catch (e) {
    return { token: null, detail: `Gateway injoignable : ${(e as Error).message}` };
  }
}
