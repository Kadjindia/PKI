import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const contentType = req.headers.get("content-type") || "";

    // Handle JSON payload (client-side parsed data + file upload)
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { kpi_id, period, value, source_type, source_label, source_file_name,
              aggregation, selected_column, selected_sheet, raw_data, detail_rows,
              file_base64, file_content_type, file_name } = body;

      if (!kpi_id || !period || value === undefined) {
        return new Response(
          JSON.stringify({ error: "Missing kpi_id, period, or value" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let fileUrl: string | null = null;

      // Upload file if provided as base64
      if (file_base64 && file_name) {
        const binaryStr = atob(file_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const filePath = `${kpi_id}/${period}/${Date.now()}-${file_name}`;
        const { error: uploadError } = await supabase.storage
          .from("kpi-files")
          .upload(filePath, bytes, { contentType: file_content_type || "application/octet-stream", upsert: true });

        if (uploadError) {
          console.error("Upload error:", uploadError);
        } else {
          const { data: urlData } = supabase.storage.from("kpi-files").getPublicUrl(filePath);
          fileUrl = urlData.publicUrl;
        }
      }

      // Insert entry
      const { data: entry, error: insertError } = await supabase
        .from("kpi_entries")
        .insert({
          kpi_id,
          value,
          period,
          source_type: source_type || "manual",
          source_label: source_label || "Saisie manuelle",
          source_file_name: source_file_name || null,
          source_file_path: fileUrl,
          aggregation: aggregation || null,
          selected_column: selected_column || null,
          selected_sheet: selected_sheet || null,
          raw_data: raw_data || null,
          detail_rows: detail_rows || null,
        })
        .select()
        .single();

      if (insertError) {
        return new Response(
          JSON.stringify({ error: "Insert failed", details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, entry, file_url: fileUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unsupported content type" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
