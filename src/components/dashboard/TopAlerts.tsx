import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS } from "@/types/kpi";
import { AlertTriangle, AlertCircle } from "lucide-react";

export default function TopAlerts() {
  const { kpis, getLatestValue } = useKpi();

  const alerts = kpis
    .map((kpi) => {
      const val = getLatestValue(kpi.id);
      if (val === undefined) return null;
      const isP = kpi.unit === "pourcentage" || kpi.unit === "taux";
      let level: "danger" | "warning" | null = null;

      if (kpi.thresholdDanger !== undefined && (isP ? val <= kpi.thresholdDanger : val >= kpi.thresholdDanger)) {
        level = "danger";
      } else if (kpi.thresholdWarning !== undefined && (isP ? val <= kpi.thresholdWarning : val >= kpi.thresholdWarning)) {
        level = "warning";
      }
      if (!level) return null;
      return { kpi, val, level };
    })
    .filter(Boolean) as { kpi: typeof kpis[0]; val: number; level: "danger" | "warning" }[];

  alerts.sort((a, b) => (a.level === "danger" ? -1 : 1));

  if (alerts.length === 0) {
    return (
      <div className="glass-panel p-5">
        <h3 className="section-title mb-3">Alertes actives</h3>
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
          Aucune alerte — tous les indicateurs sont conformes
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel p-5">
      <h3 className="section-title mb-3">Alertes actives</h3>
      <div className="space-y-2">
        {alerts.slice(0, 5).map(({ kpi, val, level }) => (
          <div
            key={kpi.id}
            className={`flex items-center gap-3 p-3 rounded-lg border-l-[3px] ${
              level === "danger"
                ? "border-l-destructive bg-destructive/5"
                : "border-l-accent bg-accent/5"
            }`}
          >
            {level === "danger" ? (
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{kpi.name}</div>
              <div className="text-[10px] text-muted-foreground">{CATEGORY_LABELS[kpi.category]}</div>
            </div>
            <span className="text-sm font-mono font-bold text-foreground shrink-0">
              {kpi.unit === "pourcentage" ? `${val}%` : val}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
