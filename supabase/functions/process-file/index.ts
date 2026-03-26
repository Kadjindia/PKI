import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type AggMethod = "sum" | "average" | "count" | "max" | "min" | "last";

function aggregate(values: number[], method: AggMethod): number {
  if (values.length === 0) return 0;
  switch (method) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "count":
      return values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "last":
      return values[values.length - 1] ?? 0;
    default:
      return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const kpiId = formData.get("kpi_id") as string;
    const period = formData.get("period") as string;
    const selectedColumn = formData.get("selected_column") as string;
    const aggMethod = (formData.get("aggregation") as AggMethod) || "sum";
    const selectedSheet = formData.get("selected_sheet") as string | null;

    if (!file || !kpiId || !period || !selectedColumn) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload file to storage
    const filePath = `${kpiId}/${period}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("kpi-files")
      .upload(filePath, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      return new Response(
        JSON.stringify({ error: "Upload failed", details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse file
    const buffer = await file.arrayBuffer();
    const ext = file.name.split(".").pop()?.toLowerCase();
    let rawData: Record<string, unknown>[] = [];
    let columns: string[] = [];
    let sheetName = selectedSheet;

    if (ext === "csv") {
      // Simple CSV parse
      const text = new TextDecoder().decode(buffer);
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        const sep = lines[0].includes(";") ? ";" : ",";
        columns = lines[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
        for (let i = 1; i < Math.min(lines.length, 101); i++) {
          const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, unknown> = {};
          columns.forEach((col, j) => { row[col] = vals[j] ?? ""; });
          rawData.push(row);
        }
      }
    } else {
      // Excel
      const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
      sheetName = selectedSheet || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (rawData.length > 0) columns = Object.keys(rawData[0]);
      rawData = rawData.slice(0, 100);
    }

    // Compute aggregation
    const numericValues = rawData
      .map((r) => Number(r[selectedColumn]))
      .filter((v) => !isNaN(v));
    const computedValue = Math.round(aggregate(numericValues, aggMethod) * 100) / 100;

    // Build detail rows
    const detailRows = rawData.slice(0, 20).map((row) => ({
      label: String(Object.values(row)[0] || ""),
      value: Number(row[selectedColumn]) || 0,
      metadata: Object.fromEntries(
        Object.entries(row)
          .filter(([k]) => k !== selectedColumn)
          .slice(0, 3)
          .map(([k, v]) => [k, String(v)])
      ),
    }));

    // Get public URL
    const { data: urlData } = supabase.storage.from("kpi-files").getPublicUrl(filePath);

    // Insert entry
    const { data: entry, error: insertError } = await supabase
      .from("kpi_entries")
      .insert({
        kpi_id: kpiId,
        value: computedValue,
        period,
        source_type: ext === "csv" ? "csv" : "excel",
        source_label: file.name,
        source_file_name: file.name,
        source_file_path: urlData.publicUrl,
        aggregation: aggMethod,
        selected_column: selectedColumn,
        selected_sheet: sheetName,
        raw_data: rawData.slice(0, 20),
        detail_rows: detailRows,
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
      JSON.stringify({
        success: true,
        entry,
        computed_value: computedValue,
        file_url: urlData.publicUrl,
        rows_parsed: rawData.length,
        columns,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
