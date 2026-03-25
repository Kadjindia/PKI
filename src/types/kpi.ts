export type KpiCategory =
  | "messagerie"
  | "gouvernance"
  | "sensibilisation"
  | "risques"
  | "continuite";

export type DataSourceType = "manual" | "excel" | "csv" | "powerbi" | "api" | "sharepoint";

export interface DataSourceMeta {
  type: DataSourceType;
  label: string;
  fileName?: string;
  fileUrl?: string;
  embedUrl?: string; // For Power BI embed
  apiEndpoint?: string;
  lastSync?: string;
  rawData?: Record<string, unknown>[]; // Preview rows from source
  columns?: string[];
}

export interface KpiDefinition {
  id: string;
  name: string;
  category: KpiCategory;
  unit: "nombre" | "pourcentage" | "taux";
  description?: string;
  icon?: string;
  thresholdWarning?: number;
  thresholdDanger?: number;
  target?: number;
}

export interface KpiEntry {
  id: string;
  kpiId: string;
  value: number;
  period: string; // YYYY-MM format
  createdAt: string;
  updatedAt?: string;
  source?: DataSourceMeta;
  details?: KpiDetailRow[]; // Breakdown rows composing the value
}

export interface KpiDetailRow {
  label: string;
  value: number;
  metadata?: Record<string, string>;
}

export type PeriodFilter = "monthly" | "quarterly" | "yearly";

// External connector definition
export interface DataConnector {
  id: string;
  name: string;
  type: DataSourceType;
  icon: string;
  description: string;
  status: "connected" | "disconnected" | "error";
  config?: Record<string, string>;
  lastSync?: string;
}

export const CATEGORY_LABELS: Record<KpiCategory, string> = {
  messagerie: "Messagerie SSI",
  gouvernance: "Gouvernance",
  sensibilisation: "Sensibilisation",
  risques: "Gestion des risques",
  continuite: "Continuité d'activité",
};

export const CATEGORY_COLORS: Record<KpiCategory, string> = {
  messagerie: "hsl(187 80% 48%)",
  gouvernance: "hsl(280 60% 55%)",
  sensibilisation: "hsl(38 92% 55%)",
  risques: "hsl(0 72% 55%)",
  continuite: "hsl(152 60% 45%)",
};

export const DATA_SOURCE_LABELS: Record<DataSourceType, string> = {
  manual: "Saisie manuelle",
  excel: "Fichier Excel",
  csv: "Fichier CSV",
  powerbi: "Power BI",
  api: "API externe",
  sharepoint: "SharePoint",
};

export const DATA_SOURCE_COLORS: Record<DataSourceType, string> = {
  manual: "hsl(215 20% 55%)",
  excel: "hsl(152 60% 45%)",
  csv: "hsl(38 92% 55%)",
  powerbi: "hsl(45 100% 51%)",
  api: "hsl(187 80% 48%)",
  sharepoint: "hsl(200 80% 55%)",
};
