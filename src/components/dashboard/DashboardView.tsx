import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS } from "@/types/kpi";
import KpiCard from "./KpiCard";
import KpiChartTabs from "./KpiChartTabs";
import PeriodFilterBar from "./PeriodFilterBar";
import ExecutiveSummary from "./ExecutiveSummary";
import TopAlerts from "./TopAlerts";
import { Activity } from "lucide-react";
import { useState } from "react";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

export default function Dashboard() {
  const { kpis, entries } = useKpi();
  const [expandedCategory, setExpandedCategory] = useState<KpiCategory | null>(null);

  const latestPeriod = entries.length > 0
    ? [...entries].sort((a, b) => b.period.localeCompare(a.period))[0].period
    : "";

  const formatPeriod = (p: string) => {
    if (!p) return "—";
    const d = new Date(p + "-01");
    return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Tableau de bord SSI
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Dernière mise à jour : {formatPeriod(latestPeriod)}
          </p>
        </div>
        <PeriodFilterBar />
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary />

      {/* Charts + Alerts side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <KpiChartTabs />
        </div>
        <div>
          <TopAlerts />
        </div>
      </div>

      {/* KPI Cards by Category — collapsible */}
      <section>
        <h2 className="section-title mb-4">Détail des indicateurs</h2>
        <div className="space-y-4">
          {CATEGORIES.map((cat) => {
            const catKpis = kpis.filter((k) => k.category === cat);
            if (catKpis.length === 0) return null;
            const isExpanded = expandedCategory === cat || expandedCategory === null;

            return (
              <div key={cat}>
                <button
                  onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                  className="flex items-center gap-2 mb-3 text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  <span className="text-xs">{isExpanded && expandedCategory !== null ? "▼" : "▶"}</span>
                  {CATEGORY_LABELS[cat]}
                  <span className="text-xs text-muted-foreground">({catKpis.length})</span>
                </button>
                {(isExpanded || expandedCategory === null) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {catKpis.map((kpi) => (
                      <KpiCard key={kpi.id} kpi={kpi} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
