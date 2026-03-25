import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS, CATEGORY_COLORS } from "@/types/kpi";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface KpiChartProps {
  category: KpiCategory;
}

export default function KpiChart({ category }: KpiChartProps) {
  const { kpis, getEntriesForKpi } = useKpi();
  const categoryKpis = kpis.filter((k) => k.category === category);

  // Build chart data: one entry per period with all KPIs as columns
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
      period: period.replace("20", "").replace("-", "/"),
      ...values,
    }));

  const color = CATEGORY_COLORS[category];
  const colors = [color, `${color.slice(0, -1)} / 0.6)`, `${color.slice(0, -1)} / 0.3)`];

  return (
    <div className="glass-panel p-5">
      <h3 className="section-title mb-4">{CATEGORY_LABELS[category]}</h3>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              {categoryKpis.map((kpi, i) => (
                <linearGradient key={kpi.id} id={`grad-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 18%)" />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(222 44% 9%)",
                border: "1px solid hsl(222 30% 18%)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "hsl(210 40% 92%)",
              }}
              labelStyle={{ color: "hsl(187 80% 48%)" }}
            />
            {categoryKpis.slice(0, 3).map((kpi, i) => (
              <Area
                key={kpi.id}
                type="monotone"
                dataKey={kpi.id}
                name={kpi.name}
                stroke={colors[i % colors.length]}
                fill={`url(#grad-${kpi.id})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
