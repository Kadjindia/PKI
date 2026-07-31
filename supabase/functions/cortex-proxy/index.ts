import { createClient } from "npm:@supabase/supabase-js@2";

const CORTEX_FQDN = Deno.env.get("CORTEX_FQDN");
const CORTEX_API_KEY_ID = Deno.env.get("CORTEX_API_KEY_ID");
const CORTEX_API_KEY = Deno.env.get("CORTEX_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("=== NOUVELLE REQUÊTE CORTEX ===");

  try {
    // 2. Auth Supabase
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

    // 3. Secrets Cortex (AVEC .trim() POUR NETTOYER LES ESPACES CACHÉS)
    if (!CORTEX_FQDN || !CORTEX_API_KEY_ID || !CORTEX_API_KEY) {
      console.error("Erreur: Secrets Cortex manquants");
      return new Response(JSON.stringify({ error: "Configuration serveur manquante" }), { status: 500, headers: corsHeaders });
    }

    const cleanApiKey = CORTEX_API_KEY.trim();
    const cleanApiId = CORTEX_API_KEY_ID.trim();
    const cleanFqdn = CORTEX_FQDN.trim();

    // 4. Extraction du body
    const reqBodyText = await req.text();
    let reqBody: any = {};
    if (reqBodyText) {
      try {
        reqBody = JSON.parse(reqBodyText);
      } catch (e) {
        console.error("Erreur parsing JSON:", e);
      }
    }

    const targetPath = reqBody.path || "";
    const payload = reqBody.payload || {};

    // 5. Hash Cryptographique (AVEC LE GÉNÉRATEUR EXACT DE VOTRE FRONTEND)
    const nonce = Array.from({length: 64}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
    const timestamp = Date.now().toString();

    const authString = `${cleanApiKey}${nonce}${timestamp}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(authString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedAuthKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 6. Appel Cortex
    const cortexUrl = `https://${cleanFqdn}${targetPath}`;
    console.log(`Envoi à Cortex : ${cortexUrl}`);

    const cortexResponse = await fetch(cortexUrl, {
      method: "POST",
      headers: {
        "x-xdr-timestamp": timestamp,
        "x-xdr-nonce": nonce,
        "x-xdr-auth-id": cleanApiId,
        "Authorization": hashedAuthKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await cortexResponse.text();

    if (!cortexResponse.ok) {
      console.error(`Erreur Cortex (${cortexResponse.status}):`, responseText);
    } else {
      console.log(`Succès Cortex (${cortexResponse.status})`);
    }

    return new Response(responseText, {
      status: cortexResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Crash global Edge Function:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});