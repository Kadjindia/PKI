import { supabase } from "@/integrations/supabase/client";
import { KpiDefinition, KpiEntry, DataSourceMeta, KpiDetailRow } from "@/types/kpi";

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
  // 1. Récupérer d'abord les infos de l'entrée qu'on veut supprimer
  const { data: entry } = await supabase
    .from("kpi_entries")
    .select("source_file_name, period")
    .eq("id", id)
    .single();

  // 2. Si l'entrée a un nom de fichier, on supprime tout ce qui vient de ce fichier pour ce mois
  if (entry?.source_file_name) {
    const { error } = await supabase
      .from("kpi_entries")
      .delete()
      .eq("source_file_name", entry.source_file_name)
      .eq("period", entry.period);

    if (error) throw error;
  } else {
    // 3. Sinon (saisie manuelle sans fichier), on ne supprime que l'unité
    const { error } = await supabase
      .from("kpi_entries")
      .delete()
      .eq("id", id);

    if (error) throw error;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // Remove data:...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadFileForKpi(params: {
  file: File;
  kpiId: string;
  period: string;
  selectedColumn: string;
  aggregation: string;
  selectedSheet?: string;
  computedValue: number;
  rawData: Record<string, unknown>[];
  detailRows: any[];
}): Promise<{ entry: KpiEntry; fileUrl: string | null }> {
  const base64 = await fileToBase64(params.file);
  const ext = params.file.name.split(".").pop()?.toLowerCase();

  const body = {
    kpi_id: params.kpiId,
    period: params.period,
    value: params.computedValue,
    source_type: ext === "csv" ? "csv" : "excel",
    source_label: params.file.name,
    source_file_name: params.file.name,
    aggregation: params.aggregation,
    selected_column: params.selectedColumn,
    selected_sheet: params.selectedSheet || null,
    raw_data: params.rawData.slice(0, 20),
    detail_rows: params.detailRows,
    file_base64: base64,
    file_name: params.file.name,
    file_content_type: params.file.type || "application/octet-stream",
  };

  const { data, error } = await supabase.functions.invoke("process-file", {
    body,
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || "Processing failed");

  return {
    entry: mapEntry(data.entry),
    fileUrl: data.file_url,
  };
}

export async function seedDefaultKpis(defaults: KpiDefinition[]): Promise<void> {
  const { data: existing } = await supabase
    .from("kpi_definitions")
    .select("id")
    .limit(1);
  if (existing && existing.length > 0) return;

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
