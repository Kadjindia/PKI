import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS } from "@/types/kpi";
import KpiCard from "./KpiCard";
import KpiChartTabs from "./KpiChartTabs";
import PeriodFilterBar from "./PeriodFilterBar";
import ExecutiveSummary from "./ExecutiveSummary";
import TopAlerts from "./TopAlerts";
import { Activity, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useState, useMemo } from "react";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

export default function Dashboard() {
  const { kpis, entries } = useKpi();
  const [expandedCategory, setExpandedCategory] = useState<KpiCategory | null>(null);

  // Committee month navigation
  const availablePeriods = useMemo(() => {
    const periods = [...new Set(entries.map((e) => e.period))].sort();
    return periods;
  }, [entries]);

  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(() => availablePeriods.length - 1);
  const currentPeriod = availablePeriods[selectedPeriodIdx] || "";

  const formatPeriod = (p: string) => {
    if (!p) return "—";
    const d = new Date(p + "-01");
    return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };

  const canPrev = selectedPeriodIdx > 0;
  const canNext = selectedPeriodIdx < availablePeriods.length - 1;

  return (
    <div className="space-y-6">
      {/* Header with committee navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Tableau de bord SSI
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Comité de pilotage — Revue mensuelle
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month navigator */}
          <div className="flex items-center gap-1 glass-panel px-2 py-1">
            <button
              onClick={() => canPrev && setSelectedPeriodIdx((i) => i - 1)}
              disabled={!canPrev}
              className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-1.5 px-2 min-w-[160px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium text-foreground capitalize">{formatPeriod(currentPeriod)}</span>
            </div>
            <button
              onClick={() => canNext && setSelectedPeriodIdx((i) => i + 1)}
              disabled={!canNext}
              className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <PeriodFilterBar />
        </div>
      </div>

      <ExecutiveSummary />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <KpiChartTabs />
        </div>
        <div>
          <TopAlerts />
        </div>
      </div>

      {/* KPI Cards by Category */}
      <section>
        <h2 className="section-title mb-1">Détail des indicateurs</h2>
        <p className="text-xs text-muted-foreground mb-4">Cliquez sur un indicateur pour accéder au drill-down</p>
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
