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
import { fetchProjects, fetchApplications } from "@/lib/supabase-security";
import { fetchPolicies } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns } from "@/lib/supabase-awareness";

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques"];

const CUSTOM_LABELS: Record<string, string> = {
  messagerie: "Messagerie SSI",
  gouvernance: "Revue des politiques",
  sensibilisation: "Sensibilisation",
  risques: "PAS & Audits"
};

// Utilitaire : Extraire le format YYYY-MM d'une date
const getPeriodFromDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function KpiChartTabs() {
  const [activeCategory, setActiveCategory] = useState<KpiCategory>("messagerie");
  const [chartType, setChartType] = useState<"area" | "bar">("area");
  const [hiddenKpis, setHiddenKpis] = useState<Record<string, boolean>>({});

  const { getEntriesForKpi } = useKpi();

  // Fetch des données brutes
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });

  // 1. DÉFINITION STRICTE DES COURBES PERTINENTES PAR CATÉGORIE
  const dynamicKpis = useMemo(() => {
    if (activeCategory === "sensibilisation") {
      return [
        { id: "taux-clic", name: "Taux de Clic Moyen", unit: "pourcentage", color: "#f59e0b" }, // Ambre
        { id: "taux-compromission", name: "Taux de Compromission", unit: "pourcentage", color: "#ef4444" } // Rouge
      ];
    }
    if (activeCategory === "risques") {
      return [
        { id: "demandes-pas", name: "Nouvelles Demandes de PAS", unit: "nombre", color: "#3b82f6" }, // Bleu
        { id: "pentests-realises", name: "Pentests Réalisés", unit: "nombre", color: "#10b981" } // Vert
      ];
    }
    if (activeCategory === "messagerie") {
      return [
        { id: "msg-total", name: "Volume Total Msg", unit: "nombre", color: "#3b82f6" },
        { id: "msg-fraude", name: "Fraudes", unit: "nombre", color: "#ef4444" },
        { id: "msg-1212", name: "Signalements 1212", unit: "nombre", color: "#10b981" },
        { id: "msg-erreur", name: "Erreurs de routage (Bruit)", unit: "nombre", color: "#f59e0b" },
        { id: "msg-externe", name: "Mails Externes", unit: "nombre", color: "#64748b" }
      ];
    }
    if (activeCategory === "gouvernance") {
      return [
        { id: "politiques-revues", name: "Politiques Mises à Jour", unit: "nombre", color: "#8b5cf6" } // Violet
      ];
    }
    return [];
  }, [activeCategory]);

  const handleCategoryChange = (cat: KpiCategory) => {
    setActiveCategory(cat);
    setHiddenKpis({}); // Réinitialise les filtres de légende
  };

  const toggleKpi = (kpiId: string) => {
    setHiddenKpis(prev => ({ ...prev, [kpiId]: !prev[kpiId] }));
  };

  // 2. MOTEUR D'AGRÉGATION (6 Derniers Mois garantis)
  const data = useMemo(() => {
    const periodsMap = new Map<string, Record<string, number>>();

    // Initialisation d'une fenêtre glissante parfaite de 6 mois
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

      // On pré-remplit avec des 0
      const initialValues: Record<string, number> = {};
      dynamicKpis.forEach(kpi => { initialValues[kpi.id] = 0; });
      periodsMap.set(p, initialValues);
    }

    if (activeCategory === "messagerie") {
      dynamicKpis.forEach(kpi => {
        getEntriesForKpi(kpi.id).forEach(entry => {
          if (periodsMap.has(entry.period)) {
            periodsMap.get(entry.period)![kpi.id] = entry.value;
          }
        });
      });
    }

    if (activeCategory === "gouvernance") {
      policies.forEach(p => {
        const pPeriod = getPeriodFromDate(p.lastReviewDate);
        if (pPeriod && periodsMap.has(pPeriod)) {
          periodsMap.get(pPeriod)!["politiques-revues"] += 1;
        }
      });
    }

    if (activeCategory === "risques") {
      projects.forEach(p => {
        const pPeriod = getPeriodFromDate((p as any).requestDate || p.createdAt);
        if (pPeriod && periodsMap.has(pPeriod)) {
          periodsMap.get(pPeriod)!["demandes-pas"] += 1;
        }
      });
      apps.forEach(a => {
        if (a.auditType === 'pentest') {
          const aPeriod = getPeriodFromDate(a.lastAuditDate);
          if (aPeriod && periodsMap.has(aPeriod)) {
            periodsMap.get(aPeriod)!["pentests-realises"] += 1;
          }
        }
      });
    }

    if (activeCategory === "sensibilisation") {
      const campaignGroups: Record<string, { clicks: number, comp: number, target: number }> = {};

      campaigns.forEach(c => {
        const cPeriod = getPeriodFromDate(c.sendDate);
        if (cPeriod && periodsMap.has(cPeriod)) {
          if (!campaignGroups[cPeriod]) campaignGroups[cPeriod] = { clicks: 0, comp: 0, target: 0 };
          campaignGroups[cPeriod].clicks += (c.clickedCount || 0);
          campaignGroups[cPeriod].comp += (c.compromisedCount || 0);
          campaignGroups[cPeriod].target += (c.targetCount || 0);
        }
      });

      Object.keys(campaignGroups).forEach(p => {
        const g = campaignGroups[p];
        const vals = periodsMap.get(p)!;
        vals["taux-clic"] = g.target > 0 ? Math.round((g.clicks / g.target) * 100) : 0;
        vals["taux-compromission"] = g.target > 0 ? Math.round((g.comp / g.target) * 100) : 0;
      });
    }

    return Array.from(periodsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, values]) => ({
        rawPeriod: period,
        formatPeriod: new Date(period + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
        ...values,
      }));
  }, [dynamicKpis, getEntriesForKpi, activeCategory, policies, projects, apps, campaigns]);

  const hasPercentages = dynamicKpis.some(k => k.unit === "pourcentage");
  const hasNumbers = dynamicKpis.some(k => k.unit !== "pourcentage");

  // 3. LÉGENDE INTERACTIVE
  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-4 pt-4">
        {payload.map((entry: any, index: number) => {
          const isHidden = hiddenKpis[entry.dataKey];
          return (
            <div
              key={`item-${index}`}
              className={`flex items-center gap-1.5 cursor-pointer transition-all duration-200 ${isHidden ? 'opacity-40 grayscale' : 'opacity-100 hover:opacity-80'}`}
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

  // 4. TOOLTIP SUR MESURE
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-xs min-w-[150px] z-50">
          <p className="font-semibold mb-2 capitalize text-foreground border-b pb-1">{label}</p>
          {payload.map((entry: any, index: number) => {
            const kpiDef = dynamicKpis.find(k => k.id === entry.dataKey);
            const unit = kpiDef?.unit === "pourcentage" ? "%" : "";

            return (
              <div key={index} className="flex items-center justify-between gap-4 py-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                  <span className="text-muted-foreground">{entry.name}</span>
                </div>
                <span className="font-bold text-foreground">{entry.value}{unit}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-panel p-5 w-full flex flex-col shadow-sm border border-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h3 className="text-sm font-bold uppercase text-foreground mb-0">Évolution Détaillée (6 derniers mois)</h3>
          <p className="text-[10px] text-muted-foreground mt-1">
            Analyse temporelle des indicateurs mesurables
          </p>
        </div>
        <div className="flex gap-1 p-0.5 rounded-md bg-secondary/50">
          <button onClick={() => setChartType("area")} className={`px-2.5 py-1.5 rounded text-[10px] font-medium transition-all ${chartType === "area" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Courbes</button>
          <button onClick={() => setChartType("bar")} className={`px-2.5 py-1.5 rounded text-[10px] font-medium transition-all ${chartType === "bar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Barres</button>
        </div>
      </div>

      {/* SÉLECTION DE LA CATÉGORIE */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-thin">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all border ${
              activeCategory === cat
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            {CUSTOM_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* LE GRAPHIQUE AVEC HAUTEUR STRICTE POUR RECHARTS */}
      <div style={{ width: '100%', height: 400 }} className="mt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "area" ? (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="formatPeriod" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />

              {/* Sécurité absolue pour Recharts : on render toujours les axes mais on les cache si inutiles */}
              <YAxis yAxisId="left" orientation="left" hide={!hasNumbers} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" hide={!hasPercentages} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />

              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '3 3' }} />
              <Legend content={renderLegend} verticalAlign="bottom" height={36} />

              {dynamicKpis.map((kpi) => (
                <Area
                  key={kpi.id}
                  yAxisId={kpi.unit === "pourcentage" ? "right" : "left"}
                  type="monotone"
                  dataKey={kpi.id}
                  name={kpi.name}
                  stroke={kpi.color}
                  fill={kpi.color}
                  fillOpacity={0.1}
                  strokeWidth={3}
                  hide={!!hiddenKpis[kpi.id]}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="formatPeriod" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />

              <YAxis yAxisId="left" orientation="left" hide={!hasNumbers} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" hide={!hasPercentages} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} />

              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
              <Legend content={renderLegend} verticalAlign="bottom" height={36} />

              {dynamicKpis.map((kpi) => (
                <Bar
                  key={kpi.id}
                  yAxisId={kpi.unit === "pourcentage" ? "right" : "left"}
                  dataKey={kpi.id}
                  name={kpi.name}
                  fill={kpi.color}
                  radius={[4, 4, 0, 0]}
                  hide={!!hiddenKpis[kpi.id]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}