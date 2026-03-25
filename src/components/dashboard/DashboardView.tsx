import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS } from "@/types/kpi";
import KpiCard from "./KpiCard";
import KpiChart from "./KpiChart";
import PeriodFilterBar from "./PeriodFilterBar";
import { Activity } from "lucide-react";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

export default function Dashboard() {
  const { kpis, entries } = useKpi();
  const latestPeriod = entries.length > 0
    ? [...entries].sort((a, b) => b.period.localeCompare(a.period))[0].period
    : "";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Activity className="w-6 h-6 text-primary" />
            Tableau de bord SSI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {kpis.length} indicateurs • Dernière période : {latestPeriod || "—"}
          </p>
        </div>
        <PeriodFilterBar />
      </div>

      {/* KPI Cards by Category */}
      {CATEGORIES.map((cat) => {
        const catKpis = kpis.filter((k) => k.category === cat);
        if (catKpis.length === 0) return null;

        return (
          <section key={cat}>
            <h2 className="section-title mb-4">{CATEGORY_LABELS[cat]}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
              {catKpis.map((kpi) => (
                <KpiCard key={kpi.id} kpi={kpi} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Charts */}
      <section>
        <h2 className="section-title mb-4">Évolution dans le temps</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {CATEGORIES.map((cat) => (
            <KpiChart key={cat} category={cat} />
          ))}
        </div>
      </section>
    </div>
  );
}
