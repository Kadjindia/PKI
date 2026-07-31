import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BITSIGHT_TOKEN = Deno.env.get("BITSIGHT_TOKEN");
const BITSIGHT_COMPANY_GUID = Deno.env.get("BITSIGHT_COMPANY_GUID");
const BITSIGHT_BASE_URL = "https://api.bitsighttech.com/ratings/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // à restreindre à le domaine interne en prod
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Vérifier que l'utilisateur est authentifié (JWT Supabase valide)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Non authentifié" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Session invalide" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Vérifier que les secrets serveur sont bien configurés
  if (!BITSIGHT_TOKEN || !BITSIGHT_COMPANY_GUID) {
    return new Response(JSON.stringify({ error: "BitSight non configuré côté serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Relayer vers BitSight — le endpoint et les query params sont transmis par le front
  const url = new URL(req.url);
  const targetPath = url.searchParams.get("path"); // ex: "assets", "findings"
  const extraParams = new URLSearchParams(url.search);
  extraParams.delete("path");

  const bitsightUrl = `${BITSIGHT_BASE_URL}/companies/${BITSIGHT_COMPANY_GUID}${targetPath ? "/" + targetPath : ""}?${extraParams.toString()}`;

  const credentials = btoa(`${BITSIGHT_TOKEN}:`);
  const bitsightResponse = await fetch(bitsightUrl, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });

  const data = await bitsightResponse.text();

  return new Response(data, {
    status: bitsightResponse.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});