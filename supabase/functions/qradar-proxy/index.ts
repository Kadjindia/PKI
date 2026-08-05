import { createClient } from "npm:@supabase/supabase-js@2";

const QRADAR_BASE_URL = Deno.env.get("QRADAR_BASE_URL");
const QRADAR_SEC_TOKEN = Deno.env.get("QRADAR_SEC_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("=== NOUVELLE REQUÊTE QRADAR ===");

  try {
    // 2. Vérification de l'authentification Supabase (JWT)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Erreur: Header Authorization manquant");
      return new Response(JSON.stringify({ error: "Non authentifié" }), { status: 401, headers: corsHeaders });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error("Erreur Auth Supabase:", authError);
      return new Response(JSON.stringify({ error: "Session invalide" }), { status: 401, headers: corsHeaders });
    }

    // 3. Vérification des secrets QRadar
    if (!QRADAR_BASE_URL || !QRADAR_SEC_TOKEN) {
      console.error("Erreur: Secrets QRadar manquants");
      return new Response(JSON.stringify({ error: "Configuration QRadar manquante côté serveur" }), { status: 500, headers: corsHeaders });
    }

    const cleanBaseUrl = QRADAR_BASE_URL.trim().replace(/\/$/, "");
    const cleanToken = QRADAR_SEC_TOKEN.trim();

    // 4. Extraction du body (path, method, query params, etc.)
    const reqBodyText = await req.text();
    let reqBody: any = {};
    if (reqBodyText) {
      try {
        reqBody = JSON.parse(reqBodyText);
      } catch (e) {
        console.error("Erreur parsing JSON:", e);
      }
    }

    const targetPath = reqBody.path || ""; // ex: "/siem/offenses"
    const method = reqBody.method || "GET";
    const payload = reqBody.payload || null;
    const queryParams = reqBody.queryParams || {};

    // Construction de l'URL cible avec sécurisation du typage des query params
    const urlObj = new URL(`${cleanBaseUrl}${targetPath}`);
    Object.entries(queryParams).forEach(([key, val]) => {
      if (val !== null && val !== undefined) {
        // Sérialisation propre pour éviter le comportement par défaut "[object Object]"
        const stringValue = typeof val === "object" ? JSON.stringify(val) : String(val);
        urlObj.searchParams.append(key, stringValue);
      }
    });

    console.log(`Relais QRadar [${method}] : ${urlObj.toString()}`);

    // 5. Appel vers l'API QRadar
    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        "SEC": cleanToken,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    };

    if (payload && (method === "POST" || method === "PUT")) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const qradarResponse = await fetch(urlObj.toString(), fetchOptions);
    const responseText = await qradarResponse.text();

    if (!qradarResponse.ok) {
      console.error(`Erreur QRadar (${qradarResponse.status}):`, responseText);
    } else {
      console.log(`Succès QRadar (${qradarResponse.status})`);
    }

    return new Response(responseText, {
      status: qradarResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Crash global Edge Function QRadar:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});