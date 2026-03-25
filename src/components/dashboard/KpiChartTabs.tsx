import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS, CATEGORY_COLORS } from "@/types/kpi";
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

const CATEGORIES: KpiCategory[] = ["messagerie", "gouvernance", "sensibilisation", "risques", "continuite"];

type ChartType = "area" | "bar";

export default function KpiChartTabs() {
  const [activeCategory, setActiveCategory] = useState<KpiCategory>("messagerie");
  const [chartType, setChartType] = useState<ChartType>("area");
  const { kpis, getEntriesForKpi } = useKpi();

  const categoryKpis = kpis.filter((k) => k.category === activeCategory);

  const periodsMap = new Map<string, Record<string, number>>();
  categoryKpis.forEach((kpi) => {
    getEntriesForKpi(kpi.id).forEach((entry) => {
      const existing = periodsMap.get(entry.period) || {};
      existing[kpi.id] = entry.value;
      periodsMap.set(entry.period, existing);
    });
  });

  const data = Array.from(periodsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, values]) => ({
      period: new Date(period + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      ...values,
    }));

  const color = CATEGORY_COLORS[activeCategory];
  const hslMatch = color.match(/hsl\((\d+)/);
  const hue = hslMatch ? parseInt(hslMatch[1]) : 187;
  const chartColors = categoryKpis.map((_, i) => `hsl(${(hue + i * 25) % 360} 65% ${50 + i * 5}%)`);

  const tooltipStyle = {
    backgroundColor: "hsl(222 44% 9%)",
    border: "1px solid hsl(222 30% 18%)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "hsl(210 40% 92%)",
  };

  return (
    <div className="glass-panel p-5">
      {/* Tabs header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <h3 className="section-title">Évolution dans le temps</h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-0.5 rounded-md bg-secondary/50">
            <button
              onClick={() => setChartType("area")}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                chartType === "area" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Courbe
            </button>
            <button
              onClick={() => setChartType("bar")}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                chartType === "bar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Barres
            </button>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all border ${
              activeCategory === cat
                ? "border-primary/30 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
            style={activeCategory === cat ? { backgroundColor: `${CATEGORY_COLORS[cat]}15` } : undefined}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "area" ? (
            <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                {categoryKpis.map((kpi, i) => (
                  <linearGradient key={kpi.id} id={`cgrad-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors[i]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={chartColors[i]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 15%)" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color }} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px", color: "hsl(215 20% 55%)", paddingTop: "8px" }}
              />
              {categoryKpis.map((kpi, i) => (
                <Area
                  key={kpi.id}
                  type="monotone"
                  dataKey={kpi.id}
                  name={kpi.name}
                  stroke={chartColors[i]}
                  fill={`url(#cgrad-${kpi.id})`}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColors[i], strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: chartColors[i], strokeWidth: 2, fill: "hsl(222 44% 9%)" }}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 15%)" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color }} cursor={{ fill: "hsl(222 30% 12%)" }} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px", color: "hsl(215 20% 55%)", paddingTop: "8px" }}
              />
              {categoryKpis.map((kpi, i) => (
                <Bar
                  key={kpi.id}
                  dataKey={kpi.id}
                  name={kpi.name}
                  fill={chartColors[i]}
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
