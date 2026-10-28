import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart as LineIcon, Loader2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import {
  HISTORY_METRICS, seriesFor, compareSeries, type HistoryMetric, type HistoryPoint,
} from "@/lib/varonisPosture";

// Évolution des indicateurs de posture : une photo par jour (calcul de nuit),
// depuis la date où les définitions des indicateurs sont stables.

async function fetchHistory(): Promise<{ from: string; points: HistoryPoint[] }> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body: { action: "posture-history" } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data as { from: string; points: HistoryPoint[] };
}

const PERIODS = [7, 30, 90] as const;
const formatDay = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const formatFullDay = (t: number) => new Date(t).toLocaleDateString("fr-FR");
const TOOLTIP_STYLE = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 700 },
  itemStyle: { color: "hsl(var(--foreground))" },
};
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export default function VaronisPostureHistory() {
  const [metric, setMetric] = useState<HistoryMetric>("exposed");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30);
  const { data, error, isLoading } = useQuery({
    queryKey: ["varonis-posture-history"],
    queryFn: fetchHistory,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const def = HISTORY_METRICS.find((m) => m.key === metric)!;
  const series = seriesFor(data?.points ?? [], metric);
  const cmp = compareSeries(series, period);

  const tone = !cmp || cmp.delta === 0 || !def.lowerIsBetter
    ? "text-muted-foreground"
    : cmp.delta > 0 ? "text-red-500" : "text-emerald-600";
  const Icon = !cmp || cmp.delta === 0 ? Minus : cmp.delta > 0 ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <LineIcon className="w-4 h-4 text-primary" /> Évolution dans le temps
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Choix de l'indicateur */}
        {(["Données", "Comptes"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground w-16">{group}</span>
            {HISTORY_METRICS.filter((m) => m.group === group).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${metric === m.key ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        ))}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l&apos;historique…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : series.length < 2 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            La courbe apparaîtra après deux nuits de calcul.
          </p>
        ) : (
          <>
            {/* Comparaison en clair */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="text-muted-foreground">{def.label} : </span>
                <b className="text-foreground text-lg">{cmp!.last.value.toLocaleString("fr-FR")}</b>
                <span className={`ml-2 inline-flex items-center gap-1 font-semibold ${tone}`}>
                  <Icon className="w-4 h-4" />
                  contre {cmp!.ref.value.toLocaleString("fr-FR")} {cmp!.sinceStart ? `au début de l'historique (${formatFullDay(cmp!.ref.time)})` : `le ${formatFullDay(cmp!.ref.time)}`}
                </span>
              </p>
              <div className="flex items-center gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`text-xs px-2 py-0.5 rounded-md ${period === p ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {p} j
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={formatDay} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                  <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(t) => formatFullDay(Number(t))} formatter={(v) => [Number(v).toLocaleString("fr-FR"), def.label]} />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
