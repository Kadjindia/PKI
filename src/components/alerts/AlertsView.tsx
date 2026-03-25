import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS, KpiCategory } from "@/types/kpi";
import { Bell, AlertTriangle, AlertCircle } from "lucide-react";

export default function AlertsView() {
  const { kpis, getLatestValue } = useKpi();

  const alerts = kpis
    .filter((kpi) => kpi.thresholdDanger !== undefined || kpi.thresholdWarning !== undefined)
    .map((kpi) => {
      const value = getLatestValue(kpi.id);
      const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";
      let level: "ok" | "warning" | "danger" = "ok";

      if (value !== undefined) {
        if (kpi.thresholdDanger !== undefined && (isPercentage ? value <= kpi.thresholdDanger : value >= kpi.thresholdDanger)) {
          level = "danger";
        } else if (kpi.thresholdWarning !== undefined && (isPercentage ? value <= kpi.thresholdWarning : value >= kpi.thresholdWarning)) {
          level = "warning";
        }
      }
      return { kpi, value, level };
    })
    .sort((a, b) => {
      const order = { danger: 0, warning: 1, ok: 2 };
      return order[a.level] - order[b.level];
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Bell className="w-6 h-6 text-accent" />
          Alertes & Seuils
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Indicateurs avec seuils configurés • {alerts.filter((a) => a.level !== "ok").length} alerte(s) active(s)
        </p>
      </div>

      <div className="space-y-3">
        {alerts.map(({ kpi, value, level }) => (
          <div
            key={kpi.id}
            className={`glass-panel p-4 flex items-center gap-4 border-l-4 ${
              level === "danger"
                ? "border-l-destructive"
                : level === "warning"
                ? "border-l-accent"
                : "border-l-success"
            }`}
          >
            {level === "danger" ? (
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            ) : level === "warning" ? (
              <AlertTriangle className="w-5 h-5 text-accent shrink-0" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                <div className="w-2 h-2 rounded-full bg-success" />
              </div>
            )}
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{kpi.name}</div>
              <div className="text-xs text-muted-foreground">{CATEGORY_LABELS[kpi.category]}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-mono font-bold text-foreground">
                {value !== undefined ? (kpi.unit === "pourcentage" ? `${value}%` : value) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {kpi.thresholdWarning !== undefined && `⚠ ${kpi.thresholdWarning}`}
                {kpi.thresholdDanger !== undefined && ` • 🔴 ${kpi.thresholdDanger}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
