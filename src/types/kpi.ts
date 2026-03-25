export type KpiCategory =
  | "messagerie"
  | "gouvernance"
  | "sensibilisation"
  | "risques"
  | "continuite";

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
}

export type PeriodFilter = "monthly" | "quarterly" | "yearly";

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
