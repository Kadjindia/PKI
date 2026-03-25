import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS, CATEGORY_COLORS, KpiCategory } from "@/types/kpi";
import { Shield, AlertTriangle, TrendingUp, BarChart3 } from "lucide-react";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

function computeSecurityScore(
  kpis: ReturnType<typeof useKpi>["kpis"],
  getLatest: (id: string) => number | undefined
) {
  // Score based on percentage-type KPIs reaching targets + no danger thresholds breached
  let totalWeight = 0;
  let score = 0;

  kpis.forEach((kpi) => {
    const val = getLatest(kpi.id);
    if (val === undefined) return;
    const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";

    if (isPercentage && kpi.target) {
      totalWeight += 2;
      score += Math.min(val / kpi.target, 1) * 2;
    } else if (kpi.thresholdDanger !== undefined) {
      totalWeight += 1;
      if (isPercentage ? val > kpi.thresholdDanger : val < kpi.thresholdDanger) {
        score += 1;
      } else {
        score += 0.2;
      }
    } else {
      totalWeight += 0.5;
      score += 0.5; // neutral
    }
  });

  return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
}

export default function ExecutiveSummary() {
  const { kpis, entries, getLatestValue } = useKpi();

  const securityScore = computeSecurityScore(kpis, getLatestValue);
  const activeAlerts = kpis.filter((kpi) => {
    const val = getLatestValue(kpi.id);
    if (val === undefined || kpi.thresholdDanger === undefined) return false;
    const isP = kpi.unit === "pourcentage" || kpi.unit === "taux";
    return isP ? val <= kpi.thresholdDanger : val >= kpi.thresholdDanger;
  }).length;

  const warningAlerts = kpis.filter((kpi) => {
    const val = getLatestValue(kpi.id);
    if (val === undefined || kpi.thresholdWarning === undefined) return false;
    const isP = kpi.unit === "pourcentage" || kpi.unit === "taux";
    const isDanger = kpi.thresholdDanger !== undefined && (isP ? val <= kpi.thresholdDanger : val >= kpi.thresholdDanger);
    if (isDanger) return false;
    return isP ? val <= kpi.thresholdWarning : val >= kpi.thresholdWarning;
  }).length;

  const scoreColor =
    securityScore >= 75 ? "text-success" : securityScore >= 50 ? "text-accent" : "text-destructive";
  const scoreRing =
    securityScore >= 75
      ? "stroke-success"
      : securityScore >= 50
      ? "stroke-accent"
      : "stroke-destructive";

  // Category health
  const categoryHealth = CATEGORIES.map((cat) => {
    const catKpis = kpis.filter((k) => k.category === cat);
    const catScore = computeSecurityScore(catKpis, getLatestValue);
    return { cat, score: catScore, label: CATEGORY_LABELS[cat], color: CATEGORY_COLORS[cat] };
  });

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (securityScore / 100) * circumference;

  return (
    <div className="space-y-6">
      {/* Top executive row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Security Score Gauge */}
        <div className="kpi-card col-span-1 sm:col-span-2 lg:col-span-1 flex flex-col items-center justify-center py-6">
          <div className="relative w-32 h-32">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(222 30% 16%)" strokeWidth="8" />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                className={scoreRing}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 1s ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold font-mono ${scoreColor}`}>{securityScore}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Score</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Indice de maturité SSI</p>
        </div>

        {/* Alert counts */}
        <div className="kpi-card flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <span className="text-xs text-muted-foreground font-medium">Alertes critiques</span>
          </div>
          <div className="text-4xl font-bold font-mono text-destructive">{activeAlerts}</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="status-badge warning">{warningAlerts} attention</span>
          </div>
        </div>

        {/* Total indicators */}
        <div className="kpi-card flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xs text-muted-foreground font-medium">Indicateurs suivis</span>
          </div>
          <div className="kpi-value text-4xl">{kpis.length}</div>
          <p className="text-xs text-muted-foreground mt-2">{CATEGORIES.length} catégories</p>
        </div>

        {/* Data points */}
        <div className="kpi-card flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-success/15 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <span className="text-xs text-muted-foreground font-medium">Points de données</span>
          </div>
          <div className="text-4xl font-bold font-mono text-success">{entries.length}</div>
          <p className="text-xs text-muted-foreground mt-2">
            {new Set(entries.map((e) => e.period)).size} périodes
          </p>
        </div>
      </div>

      {/* Category Health Bars */}
      <div className="glass-panel p-5">
        <h3 className="section-title mb-4">Santé par domaine</h3>
        <div className="space-y-3">
          {categoryHealth.map(({ cat, score, label, color }) => (
            <div key={cat} className="flex items-center gap-4">
              <div className="w-36 text-xs font-medium text-muted-foreground truncate">{label}</div>
              <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${score}%`,
                    backgroundColor: color,
                    boxShadow: `0 0 8px ${color}40`,
                  }}
                />
              </div>
              <span
                className="text-sm font-mono font-bold w-10 text-right"
                style={{ color }}
              >
                {score}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
