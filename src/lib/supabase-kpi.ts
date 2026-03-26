import { supabase } from "@/integrations/supabase/client";
import { KpiDefinition, KpiEntry, DataSourceMeta, KpiDetailRow } from "@/types/kpi";

// --- Mappers ---
function mapDefinition(row: any): KpiDefinition {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    thresholdWarning: row.threshold_warning ?? undefined,
    thresholdDanger: row.threshold_danger ?? undefined,
    target: row.target ?? undefined,
  };
}

function mapEntry(row: any): KpiEntry {
  const source: DataSourceMeta | undefined = row.source_type
    ? {
        type: row.source_type,
        label: row.source_label || "Saisie manuelle",
        fileName: row.source_file_name ?? undefined,
        fileUrl: row.source_file_path ?? undefined,
        embedUrl: row.source_embed_url ?? undefined,
        apiEndpoint: row.source_api_endpoint ?? undefined,
        lastSync: row.updated_at || row.created_at,
        rawData: row.raw_data ?? undefined,
        columns: row.raw_data?.[0] ? Object.keys(row.raw_data[0]) : undefined,
        aggregation: row.aggregation ?? undefined,
        selectedColumn: row.selected_column ?? undefined,
        selectedSheet: row.selected_sheet ?? undefined,
      }
    : undefined;

  return {
    id: row.id,
    kpiId: row.kpi_id,
    value: Number(row.value),
    period: row.period,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    source,
    details: (row.detail_rows as KpiDetailRow[]) ?? undefined,
  };
}

// --- KPI Definitions ---
export async function fetchKpiDefinitions(): Promise<KpiDefinition[]> {
  const { data, error } = await supabase
    .from("kpi_definitions")
    .select("*")
    .order("category", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapDefinition);
}

export async function upsertKpiDefinition(kpi: Omit<KpiDefinition, "id"> & { id?: string }): Promise<KpiDefinition> {
  const payload: any = {
    name: kpi.name,
    category: kpi.category,
    unit: kpi.unit,
    description: kpi.description ?? null,
    icon: kpi.icon ?? null,
    threshold_warning: kpi.thresholdWarning ?? null,
    threshold_danger: kpi.thresholdDanger ?? null,
    target: kpi.target ?? null,
  };
  if (kpi.id) payload.id = kpi.id;

  const { data, error } = await supabase
    .from("kpi_definitions")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return mapDefinition(data);
}

// --- KPI Entries ---
export async function fetchKpiEntries(): Promise<KpiEntry[]> {
  const { data, error } = await supabase
    .from("kpi_entries")
    .select("*")
    .order("period", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapEntry);
}

export async function addKpiEntry(entry: {
  kpiId: string;
  value: number;
  period: string;
  sourceType?: string;
  sourceLabel?: string;
}): Promise<KpiEntry> {
  // Upsert: same kpi + period + manual source
  const { data: existing } = await supabase
    .from("kpi_entries")
    .select("id")
    .eq("kpi_id", entry.kpiId)
    .eq("period", entry.period)
    .eq("source_type", entry.sourceType || "manual")
    .is("source_file_name", null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("kpi_entries")
      .update({ value: entry.value })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapEntry(data);
  }

  const { data, error } = await supabase
    .from("kpi_entries")
    .insert({
      kpi_id: entry.kpiId,
      value: entry.value,
      period: entry.period,
      source_type: entry.sourceType || "manual",
      source_label: entry.sourceLabel || "Saisie manuelle",
    })
    .select()
    .single();
  if (error) throw error;
  return mapEntry(data);
}

export async function updateKpiEntry(id: string, value: number): Promise<void> {
  const { error } = await supabase
    .from("kpi_entries")
    .update({ value })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteKpiEntry(id: string): Promise<void> {
  const { error } = await supabase.from("kpi_entries").delete().eq("id", id);
  if (error) throw error;
}

// --- File upload via edge function ---
export async function uploadFileForKpi(params: {
  file: File;
  kpiId: string;
  period: string;
  selectedColumn: string;
  aggregation: string;
  selectedSheet?: string;
}): Promise<{ entry: KpiEntry; computedValue: number; fileUrl: string; rowsParsed: number; columns: string[] }> {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("kpi_id", params.kpiId);
  formData.append("period", params.period);
  formData.append("selected_column", params.selectedColumn);
  formData.append("aggregation", params.aggregation);
  if (params.selectedSheet) formData.append("selected_sheet", params.selectedSheet);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/process-file`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: formData,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Upload failed");

  return {
    entry: mapEntry(json.entry),
    computedValue: json.computed_value,
    fileUrl: json.file_url,
    rowsParsed: json.rows_parsed,
    columns: json.columns,
  };
}

// --- Seed defaults ---
export async function seedDefaultKpis(defaults: Omit<KpiDefinition, "">[]): Promise<void> {
  const { data: existing } = await supabase
    .from("kpi_definitions")
    .select("id")
    .limit(1);
  if (existing && existing.length > 0) return; // Already seeded

  const rows = defaults.map((kpi) => ({
    id: kpi.id,
    name: kpi.name,
    category: kpi.category,
    unit: kpi.unit,
    description: kpi.description ?? null,
    icon: kpi.icon ?? null,
    threshold_warning: kpi.thresholdWarning ?? null,
    threshold_danger: kpi.thresholdDanger ?? null,
    target: kpi.target ?? null,
  }));

  const { error } = await supabase.from("kpi_definitions").insert(rows);
  if (error) throw error;
}
