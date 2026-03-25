import { useKpi } from "@/context/KpiContext";
import { KpiDefinition, CATEGORY_COLORS } from "@/types/kpi";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  kpi: KpiDefinition;
}

export default function KpiCard({ kpi }: KpiCardProps) {
  const { getLatestValue, getPreviousValue } = useKpi();
  const value = getLatestValue(kpi.id);
  const prev = getPreviousValue(kpi.id);

  const trend = value !== undefined && prev !== undefined ? value - prev : 0;
  const trendPercent = prev ? Math.round((trend / prev) * 100) : 0;

  const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";
  const displayValue = value !== undefined ? (isPercentage ? `${value}%` : value.toLocaleString("fr-FR")) : "—";

  let statusClass = "";
  if (kpi.thresholdDanger !== undefined && value !== undefined) {
    if (isPercentage ? value <= kpi.thresholdDanger : value >= kpi.thresholdDanger) statusClass = "danger";
    else if (kpi.thresholdWarning !== undefined && (isPercentage ? value <= kpi.thresholdWarning : value >= kpi.thresholdWarning)) statusClass = "warning";
    else statusClass = "success";
  }

  const categoryColor = CATEGORY_COLORS[kpi.category];

  return (
    <div className="kpi-card animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: categoryColor }} />
          <span className="text-xs text-muted-foreground font-medium truncate max-w-[180px]">{kpi.name}</span>
        </div>
        {statusClass && <span className={`status-badge ${statusClass}`}>{statusClass === "danger" ? "Critique" : statusClass === "warning" ? "Attention" : "OK"}</span>}
      </div>

      <div className="kpi-value mb-2">{displayValue}</div>

      {kpi.target && isPercentage && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Objectif: {kpi.target}%</span>
            <span>{value ?? 0}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(((value ?? 0) / kpi.target) * 100, 100)}%`,
                background: `var(--gradient-primary)`,
              }}
            />
          </div>
        </div>
      )}

      {trend !== 0 && (
        <div className="flex items-center gap-1 text-xs">
          {trend > 0 ? (
            <TrendingUp className="w-3 h-3 text-success" />
          ) : (
            <TrendingDown className="w-3 h-3 text-destructive" />
          )}
          <span className={trend > 0 ? "text-success" : "text-destructive"}>
            {trend > 0 ? "+" : ""}{trendPercent}%
          </span>
          <span className="text-muted-foreground ml-1">vs période préc.</span>
        </div>
      )}
      {trend === 0 && value !== undefined && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Minus className="w-3 h-3" /> Stable
        </div>
      )}
    </div>
  );
}
