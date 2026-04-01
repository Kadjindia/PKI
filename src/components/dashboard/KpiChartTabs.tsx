import { useState, useMemo } from "react";
import { useKpi } from "@/context/KpiContext";
import { KpiCategory } from "@/types/kpi";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

// Imports des fetchers pour agréger les données réelles
import { fetchProjects, fetchVulnerabilities } from "@/lib/supabase-security";
import { fetchPolicies } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns, fetchElearningModules } from "@/lib/supabase-awareness";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

const CUSTOM_LABELS: Record<string, string> = {
  messagerie: "Messagerie SSI",
  gouvernance: "Revue des politiques",
  sensibilisation: "Sensibilisation",
  risques: "PAS & Audits",
  continuite: "Continuité (PCA)"
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

// Utilitaire pour extraire le format YYYY-MM d'une date
const getPeriodFromDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function KpiChartTabs() {
  const [activeCategory, setActiveCategory] = useState<KpiCategory>("messagerie");
  const [chartType, setChartType] = useState<"area" | "bar">("area");

  // --- ÉTAT RESTAURÉ POUR MASQUER LES COURBES ---
  const [hiddenKpis, setHiddenKpis] = useState<Record<string, boolean>>({});

  const { kpis, getEntriesForKpi } = useKpi();

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: modules = [] } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  const categoryKpis = useMemo(() => kpis.filter((k) => k.category === activeCategory), [kpis, activeCategory]);

  const handleCategoryChange = (cat: KpiCategory) => {
    setActiveCategory(cat);
    setHiddenKpis({}); // On réinitialise les courbes masquées quand on change d'onglet
  };

  // --- FONCTION RESTAURÉE POUR BASCULER LA VISIBILITÉ ---
  const toggleKpi = (kpiId: string) => {
    setHiddenKpis(prev => ({ ...prev, [kpiId]: !prev[kpiId] }));
  };

  const data = useMemo(() => {
    const periodsMap = new Map<string, Record<string, number>>();

    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      periodsMap.set(p, {});
    }

    categoryKpis.forEach((kpi) => {
      getEntriesForKpi(kpi.id).forEach((entry) => {
        const existing = periodsMap.get(entry.period) || {};
        existing[kpi.id] = entry.value;
        periodsMap.set(entry.period, existing);
      });
    });

    if (activeCategory === "gouvernance") {
      policies.forEach(p => {
        const pPeriod = getPeriodFromDate(p.lastReviewDate);
        if (pPeriod && periodsMap.has(pPeriod)) {
          const vals = periodsMap.get(pPeriod)!;
          vals["gov-politiques"] = (vals["gov-politiques"] || 0) + 1;
        }
      });
    }

    if (activeCategory === "risques") {
      projects.forEach(p => {
        const pPeriod = getPeriodFromDate(p.createdAt);
        if (pPeriod && periodsMap.has(pPeriod)) {
          const vals = periodsMap.get(pPeriod)!;
          vals["gov-pas"] = (vals["gov-pas"] || 0) + 1;
        }
      });
    }

    if (activeCategory === "sensibilisation") {
      campaigns.forEach(c => {
        const cPeriod = getPeriodFromDate(c.sendDate);
        if (cPeriod && periodsMap.has(cPeriod)) {
          const vals = periodsMap.get(cPeriod)!;
          vals["sens-phishing"] = (vals["sens-phishing"] || 0) + 1;
        }
      });
    }

    return Array.from(periodsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, values]) => ({
        rawPeriod: period,
        formatPeriod: new Date(period + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
        ...values,
      }));
  }, [categoryKpis, getEntriesForKpi, activeCategory, policies, projects, campaigns, modules]);

  const hasPercentages = categoryKpis.some(k => k.unit === "pourcentage" || k.unit === "taux");
  const hasNumbers = categoryKpis.some(k => k.unit !== "pourcentage" && k.unit !== "taux");

  // --- LÉGENDE INTERACTIVE RESTAURÉE ---
  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-4 pt-4">
        {payload.map((entry: any, index: number) => {
          const isHidden = hiddenKpis[entry.dataKey];
          return (
            <div
              key={`item-${index}`}
              className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${isHidden ? 'opacity-40 grayscale' : 'opacity-100 hover:opacity-80'}`}
              onClick={() => toggleKpi(entry.dataKey)}
              title="Cliquez pour masquer/afficher"
            >
              <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: entry.color }}></span>
              <span className="text-xs font-medium text-foreground">{entry.value}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-xs">
          <p className="font-semibold mb-2 capitalize text-foreground border-b pb-1">{label}</p>
          {payload.map((entry: any, index: number) => {
            const kpiDef = categoryKpis.find(k => k.id === entry.dataKey);
            const unit = (kpiDef?.unit === "pourcentage" || kpiDef?.unit === "taux") ? "%" : "";
            return (
              <div key={index} className="flex items-center justify-between gap-4 py-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                  <span className="text-muted-foreground">{entry.name}</span>
                </div>
                <span className="font-bold text-foreground">{entry.value} {unit}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-panel p-5 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h3 className="section-title mb-0">Évolution de la Posture</h3>
          <p className="text-[10px] text-muted-foreground mt-1">Données agrégées en temps réel depuis les modules</p>
        </div>
        <div className="flex gap-1 p-0.5 rounded-md bg-secondary/50">
          <button onClick={() => setChartType("area")} className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${chartType === "area" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Courbes</button>
          <button onClick={() => setChartType("bar")} className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${chartType === "bar" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Barres</button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-thin">
        {CATEGORIES.map((cat) => (
          <button key={cat} onClick={() => handleCategoryChange(cat)} className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap border transition-all ${activeCategory === cat ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
            {CUSTOM_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "area" ? (
            <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="formatPeriod" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />
              {hasNumbers && <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />}
              {hasPercentages && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />}
              <Tooltip content={<CustomTooltip />} />

              {/* LÉGENDE INTERACTIVE */}
              <Legend content={renderLegend} />

              {categoryKpis.map((kpi, i) => (
                <Area
                  key={kpi.id}
                  yAxisId={(kpi.unit === "pourcentage" || kpi.unit === "taux") ? "right" : "left"}
                  type="monotone"
                  dataKey={kpi.id}
                  name={kpi.name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  hide={!!hiddenKpis[kpi.id]} /* <-- LA PROPRIÉTÉ HIDE EST DE RETOUR */
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="formatPeriod" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />
              {hasNumbers && <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />}
              {hasPercentages && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} />}
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />

              {/* LÉGENDE INTERACTIVE */}
              <Legend content={renderLegend} />

              {categoryKpis.map((kpi, i) => (
                <Bar
                  key={kpi.id}
                  yAxisId={(kpi.unit === "pourcentage" || kpi.unit === "taux") ? "right" : "left"}
                  dataKey={kpi.id}
                  name={kpi.name}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  hide={!!hiddenKpis[kpi.id]} /* <-- LA PROPRIÉTÉ HIDE EST DE RETOUR */
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}