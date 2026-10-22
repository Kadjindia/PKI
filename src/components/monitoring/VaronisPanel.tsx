import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, AlertOctagon, Database, Bell, RefreshCw, Loader2, AlertTriangle, Inbox,
  Calendar, TrendingUp, TrendingDown, Minus, Clock, Lightbulb, Info, ListChecks,
  Lock, Upload, UserCog, Trash2, Hourglass, Users, Tag, Zap, Volume2,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend,
} from "recharts";
import {
  summarizeAlerts, normalizeSeverity, formatStatus, alertDate, isOpen,
  computeRange, previousRange, filterByRange, dataCoverage,
  granularityFor, buildTimeline, hourlyDistribution, isOffHours, buildInsights,
  threatTracking, openAgeBuckets, handlingSplit, escalationRate, eventSpikes, policyNoise,
  SEVERITY_LABELS, type ThreatFamily,
  type SeverityLevel, type VaronisAlert, type VaronisProxyResponse, type TimePrefix, type TimeUnit, type Granularity, type Insight,
} from "@/lib/varonis";

// Le job Varonis peut durer plusieurs minutes : la fonction le lance et répond
// tout de suite avec son identifiant, puis on l'interroge toutes les 3 s.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function callVaronisProxy(body: { jobId?: string }): Promise<VaronisProxyResponse> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body });
  if (error) {
    // On remonte le message renvoyé par la fonction plutôt que l'erreur générique
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data as VaronisProxyResponse;
}

async function fetchVaronisAlerts(onProgress: (progress: number | null) => void): Promise<VaronisProxyResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let res = await callVaronisProxy({});
  while (res.status === "pending" && res.jobId) {
    onProgress(typeof res.jobProgress === "number" ? res.jobProgress : null);
    if (Date.now() > deadline) {
      throw new Error("Varonis n'a pas terminé la préparation des alertes en 5 minutes. Réessayez plus tard.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    res = await callVaronisProxy({ jobId: res.jobId });
  }
  onProgress(null);
  return res;
}

// --- Présentation -----------------------------------------------------------

// Mêmes couleurs que la console Varonis
const SEVERITY_ORDER: SeverityLevel[] = ["high", "medium", "low", "info", "unknown"];
const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  high: "#ef4444", medium: "#f97316", low: "#eab308", info: "#16a34a", unknown: "#94a3b8",
};
const SEVERITY_BADGE: Record<SeverityLevel, string> = {
  high: "bg-red-500/15 text-red-600 border-red-500/30",
  medium: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  low: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  info: "bg-green-600/15 text-green-600 border-green-600/30",
  unknown: "bg-muted text-muted-foreground border-border",
};
const GRANULARITY_LABEL: Record<Granularity, string> = {
  hour: "par heure", day: "par jour", week: "par semaine", month: "par mois",
};
const INSIGHT_STYLE: Record<Insight["level"], { icon: typeof Info; className: string }> = {
  critical: { icon: AlertOctagon, className: "text-red-500 bg-red-500/10 border-red-500/20" },
  warning: { icon: AlertTriangle, className: "text-orange-500 bg-orange-500/10 border-orange-500/20" },
  info: { icon: Info, className: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
};
const THREAT_ICONS: Record<ThreatFamily, typeof Info> = {
  ransomware: Lock, exfiltration: Upload, privileges: UserCog, destruction: Trash2,
};

const TOOLTIP_STYLE = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 700 },
  itemStyle: { color: "hsl(var(--foreground))" },
};
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

const formatDate = (d: Date | null) =>
  d ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
const formatDay = (d: Date) => d.toLocaleDateString("fr-FR");

function formatBucket(t: number, g: Granularity): string {
  const d = new Date(t);
  if (g === "hour") return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${d.getHours()}h`;
  if (g === "day") return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  if (g === "week") return `sem. ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

/**
 * Comparaison avec la période précédente de même durée, en clair :
 * « contre 173 sur la période précédente ». Rouge si hausse, vert si baisse.
 */
function PreviousPeriod({ current, previous, comparable }: { readonly current: number; readonly previous: number; readonly comparable: boolean }) {
  if (!comparable) {
    return <span className="text-[11px] text-muted-foreground">Pas de données pour la période précédente</span>;
  }
  const delta = current - previous;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const color = delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-500" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${color}`}>
      <Icon className="w-3 h-3 shrink-0" /> contre {previous.toLocaleString("fr-FR")} sur la période précédente
    </span>
  );
}

/** Alertes de sévérité élevée levées (ouvertes ou fermées). */
const countHigh = (list: VaronisAlert[]) => list.filter((a) => normalizeSeverity(a.policy?.severity) === "high").length;

export default function VaronisPanel() {
  const [progress, setProgress] = useState<number | null>(null);
  const [timePrefix, setTimePrefix] = useState<TimePrefix>("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>("days");

  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["varonis-alerts"],
    queryFn: () => fetchVaronisAlerts(setProgress),
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 15,
    retry: false,
  });

  const view = useMemo(() => {
    const all = data?.alerts ?? [];
    const range = computeRange(timePrefix, timeValue, timeUnit);
    const current = filterByRange(all, range);
    const prevRange = previousRange(range);
    const previous = filterByRange(all, prevRange);
    const coverage = dataCoverage(all);
    // Pas de comparaison si la période précédente commence avant les données reçues
    const canCompare = coverage !== null && prevRange.from >= coverage.oldest.getTime();
    const granularity = granularityFor(range);
    const summary = summarizeAlerts(current);
    const offHours = current.filter((a) => { const d = alertDate(a); return d ? isOffHours(d) : false; }).length;
    return {
      range,
      coverage,
      totalReceived: all.length,
      current,
      summary,
      previousCount: previous.length,
      highRaised: countHigh(current),
      previousHigh: countHigh(previous),
      granularity,
      timeline: buildTimeline(current, range, granularity).map((p) => ({ ...p, label: formatBucket(p.start, granularity) })),
      hourly: hourlyDistribution(current),
      offHoursPct: current.length ? Math.round((offHours / current.length) * 100) : 0,
      // 6 points maximum, déjà classés du plus critique au plus informatif
      insights: buildInsights(current, canCompare ? previous : [], all).slice(0, 6),
      threats: threatTracking(current, canCompare ? previous : []),
      canCompare,
      ages: openAgeBuckets(all),
      handling: handlingSplit(all),
      escalation: escalationRate(current),
      spikes: eventSpikes(current),
      noise: policyNoise(current).slice(0, 8),
      taggedOpen: current.filter((a) => isOpen(a) && a.hasTaggedResource).length,
      treatedPct: summary.total ? Math.round(((summary.total - summary.open) / summary.total) * 100) : 0,
    };
  }, [data, timePrefix, timeValue, timeUnit]);

  const { summary, coverage } = view;
  const periodStartsBeforeData = coverage !== null && view.range.from < coverage.oldest.getTime();

  const header = (
    <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
          <ShieldAlert className="w-7 h-7 text-primary" /> Sécurité des données — Varonis
        </h2>
        <p className="text-muted-foreground font-medium mt-1">
          Alertes de menaces sur les données et suivi de leur traitement
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {dataUpdatedAt ? `Synchronisé le ${formatDate(new Date(dataUpdatedAt))}` : "Données en direct depuis Varonis"}
          {coverage && ` · Données disponibles du ${formatDay(coverage.oldest)} au ${formatDay(coverage.newest)} (${view.totalReceived} alertes)`}
          {data?.jobStatus === "PARTIAL_RESULTS" && " · résultats partiels"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2 bg-secondary/20 p-2 rounded-xl border border-border">
          <Calendar className="w-4 h-4 text-muted-foreground ml-2" />
          <select
            aria-label="Type de période"
            value={timePrefix}
            onChange={(e) => setTimePrefix(e.target.value as TimePrefix)}
            className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary outline-none cursor-pointer"
          >
            <option value="last">Dernier(s)</option>
            <option value="this">Ce/Cette</option>
          </select>
          {timePrefix === "last" && (
            <input
              aria-label="Nombre"
              type="number"
              min="1"
              value={timeValue}
              onChange={(e) => setTimeValue(Math.max(1, Number(e.target.value) || 1))}
              className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 w-20 focus:ring-2 focus:ring-primary outline-none"
            />
          )}
          <select
            aria-label="Unité"
            value={timeUnit}
            onChange={(e) => setTimeUnit(e.target.value as TimeUnit)}
            className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary outline-none cursor-pointer"
          >
            <option value="days">{timePrefix === "this" ? "Jour" : "Jour(s)"}</option>
            <option value="months">Mois</option>
            <option value="years">{timePrefix === "this" ? "Année" : "Année(s)"}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex flex-col items-center justify-center py-24 space-y-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">
            Varonis prépare les alertes{progress !== null ? ` : ${Math.round(progress <= 1 ? progress * 100 : progress)} %` : "…"}
          </p>
          <p className="text-xs">Cela peut prendre une à plusieurs minutes selon le volume.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 font-bold text-destructive">
              <AlertTriangle className="w-5 h-5" /> Impossible de récupérer les alertes Varonis
            </div>
            <p className="font-mono text-xs bg-background/60 border border-border rounded-md p-3 break-all">
              {(error as Error).message}
            </p>
            <p className="text-sm text-muted-foreground">
              Vérifiez que la fonction <code>varonis-proxy</code> est déployée et que les secrets{" "}
              <code>VARONIS_BASE_URL</code> et <code>VARONIS_API_KEY</code> sont configurés dans Supabase.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const severityData = SEVERITY_ORDER
    .map((s) => ({ key: s, name: SEVERITY_LABELS[s], value: summary.bySeverity[s] }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {header}

      {periodStartsBeforeData && coverage && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 text-sm">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            La période choisie commence avant la plus ancienne alerte renvoyée par Varonis ({formatDay(coverage.oldest)}) :
            les chiffres et les comparaisons peuvent être incomplets.
          </span>
        </div>
      )}

      {summary.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-2 text-muted-foreground">
            <Inbox className="w-8 h-8" />
            <p className="text-sm">Aucune alerte Varonis sur cette période.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* LIGNE 1 : INDICATEURS CLÉS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-primary">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Alertes sur la période</CardTitle>
                <div className="p-1.5 bg-primary/10 rounded-md"><Bell className="w-4 h-4 text-primary" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{summary.total.toLocaleString("fr-FR")}</div>
                <div className="mt-1"><PreviousPeriod current={summary.total} previous={view.previousCount} comparable={view.canCompare} /></div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-amber-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">À traiter</CardTitle>
                <div className="p-1.5 bg-amber-500/10 rounded-md"><ListChecks className="w-4 h-4 text-amber-500" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{summary.open.toLocaleString("fr-FR")}</div>
                <p className="text-[11px] font-medium text-muted-foreground mt-1">
                  alertes ouvertes · {view.treatedPct} % traitées
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Sévérité élevée ouvertes</CardTitle>
                <div className="p-1.5 bg-red-500/10 rounded-md"><AlertOctagon className="w-4 h-4 text-red-500" /></div>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-black ${summary.openHigh > 0 ? "text-red-500" : "text-foreground"}`}>{summary.openHigh}</div>
                <p className="text-[11px] font-medium text-muted-foreground mt-1">{view.highRaised} alertes élevées sur la période</p>
                <div><PreviousPeriod current={view.highRaised} previous={view.previousHigh} comparable={view.canCompare} /></div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-orange-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Alertes sur données sensibles</CardTitle>
                <div className="p-1.5 bg-orange-500/10 rounded-md"><Database className="w-4 h-4 text-orange-500" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{summary.sensitive}</div>
                <p className="text-[11px] font-medium text-muted-foreground mt-1">
                  alertes ouvertes · {summary.open ? Math.round((summary.sensitive / summary.open) * 100) : 0} % des ouvertes
                </p>
                <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Tag className="w-3 h-3" /> dont <span className="font-bold text-foreground">{view.taggedOpen}</span> sur ressources taguées
                </p>
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 1 BIS : MENACES CRITIQUES */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {view.threats.map((t) => {
              const Icon = THREAT_ICONS[t.key];
              const active = t.open > 0;
              return (
                <div key={t.key} className={`p-4 rounded-xl border ${active ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"}`}>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <Icon className={`w-4 h-4 ${active ? "text-red-500" : "text-muted-foreground"}`} /> {t.label}
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className={`text-2xl font-black ${active ? "text-red-500" : "text-foreground"}`}>{t.open}</span>
                    <span className="text-xs text-muted-foreground">ouverte{t.open > 1 ? "s" : ""} · {t.total} sur la période</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* LIGNE 2 : SÉVÉRITÉ + POINTS D'ATTENTION */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="flex flex-col">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" /> Alertes ouvertes par sévérité
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2 flex-grow flex items-center justify-center min-h-[260px]">
                {severityData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune alerte ouverte sur la période.</p>
                ) : (
                  <div className="relative w-full h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={severityData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none">
                          {severityData.map((d) => <Cell key={d.key} fill={SEVERITY_COLORS[d.key]} />)}
                        </Pie>
                        <RechartsTooltip {...TOOLTIP_STYLE} />
                        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 bottom-8 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-3xl font-black text-foreground">{summary.open}</span>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">ouvertes</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" /> Points d&apos;attention
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                {view.insights.map((ins) => {
                  const { icon: Icon, className } = INSIGHT_STYLE[ins.level];
                  return (
                    <div key={ins.text} className={`flex items-start gap-3 p-3 rounded-lg border ${className}`}>
                      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ins.text}</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 2 BIS : ARRIÉRÉ + PRISE EN CHARGE + PICS D'ACTIVITÉ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Hourglass className="w-4 h-4 text-amber-500" /> Ancienneté des alertes ouvertes
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Toutes périodes confondues (arriéré actuel)</p>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {(() => {
                  const { lt7, d7to30, gt30 } = view.ages;
                  const total = Math.max(1, lt7 + d7to30 + gt30);
                  const segs = [
                    { label: "< 7 jours", value: lt7, color: "bg-emerald-500" },
                    { label: "7 à 30 jours", value: d7to30, color: "bg-amber-500" },
                    { label: "> 30 jours", value: gt30, color: "bg-red-500" },
                  ];
                  return (
                    <>
                      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                        {segs.map((sg) => <div key={sg.label} className={sg.color} style={{ width: `${(sg.value / total) * 100}%` }} />)}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {segs.map((sg) => (
                          <div key={sg.label}>
                            <div className="text-xl font-black text-foreground">{sg.value}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${sg.color}`} /> {sg.label}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground border-t border-border pt-3">
                        {view.ages.highGt7 > 0
                          ? <><span className="font-bold text-red-500">{view.ages.highGt7}</span> alerte{view.ages.highGt7 > 1 ? "s" : ""} élevée{view.ages.highGt7 > 1 ? "s" : ""} ouverte{view.ages.highGt7 > 1 ? "s" : ""} depuis plus de 7 jours</>
                          : "Aucune alerte élevée ouverte depuis plus de 7 jours"}
                        {view.ages.oldestDays !== null && ` · plus ancienne : ${view.ages.oldestDays} j`}
                      </p>
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-500" /> Prise en charge des alertes ouvertes
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Équipe interne ou service managé Varonis (MDR)</p>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {(() => {
                  const { varonis, internal } = view.handling;
                  const total = Math.max(1, varonis + internal);
                  return [
                    { label: "Équipe interne", value: internal, color: "bg-sky-500" },
                    { label: "Varonis (MDR)", value: varonis, color: "bg-violet-500" },
                  ].map((r) => (
                    <div key={r.label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground">{r.label}</span>
                        <span className="font-bold">{r.value} <span className="text-muted-foreground font-normal">({Math.round((r.value / total) * 100)} %)</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${r.color}`} style={{ width: `${(r.value / total) * 100}%` }} />
                      </div>
                    </div>
                  ));
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Zap className="w-4 h-4 text-red-500" /> Pics d&apos;activité
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Alertes avec au moins {view.spikes.threshold} événements (activité massive : suppression, chiffrement, copie)
                </p>
              </CardHeader>
              <CardContent className="pt-3">
                {view.spikes.spikes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun pic d&apos;activité sur la période.</p>
                ) : (
                  <ul className="space-y-2">
                    {view.spikes.spikes.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground" title={a.policy?.name ?? ""}>{a.policy?.name ?? "—"}</div>
                          <div className="text-[11px] text-muted-foreground">{formatDate(alertDate(a))} · {formatStatus(a.status)}</div>
                        </div>
                        <span className="font-mono font-black text-red-500 shrink-0">{(a.eventsCount ?? 0).toLocaleString("fr-FR")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 3 : ÉVOLUTION + RÉPARTITION HORAIRE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 flex flex-col">
              <CardHeader className="pb-0 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Évolution des alertes par sévérité
                </CardTitle>
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
                  {GRANULARITY_LABEL[view.granularity]}
                </span>
              </CardHeader>
              <CardContent className="pt-4 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view.timeline} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <RechartsTooltip {...TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    {SEVERITY_ORDER.filter((s) => (s !== "info" && s !== "unknown") || view.timeline.some((p) => p[s] > 0)).map((s) => (
                      <Bar key={s} dataKey={s} name={SEVERITY_LABELS[s]} stackId="sev" fill={SEVERITY_COLORS[s]} radius={s === "high" ? [3, 3, 0, 0] : 0} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-500" /> Répartition horaire
                </CardTitle>
                <p className="text-[11px] text-muted-foreground pt-1">
                  <span className="font-bold text-violet-500">{view.offHoursPct} %</span> hors heures ouvrées (avant 8 h, après 19 h, week-end)
                </p>
              </CardHeader>
              <CardContent className="pt-4 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view.hourly} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} interval={3} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(h) => `${h}h – ${Number(h) + 1}h`} formatter={(v) => [v, "Alertes"]} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {view.hourly.map((h) => (
                        <Cell key={h.hour} fill={h.hour < 8 || h.hour >= 19 ? "#8b5cf6" : "#0ea5e9"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 4 : TRAITEMENT + POLITIQUES (VOLUME ET BRUIT) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-emerald-500" /> Traitement des alertes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Taux de traitement</span>
                    <span className="font-black text-foreground">{view.treatedPct} %</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${view.treatedPct}%` }} />
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taux d&apos;escalade</span>
                  <span className="font-black text-foreground">{view.escalation} %</span>
                </div>
                <ul className="space-y-1.5 border-t border-border pt-3">
                  {summary.byStatus.map((st) => (
                    <li key={st.name} className="flex justify-between gap-3 text-sm">
                      <span className="text-foreground">{st.name}</span>
                      <span className="font-bold">{st.count}</span>
                    </li>
                  ))}
                </ul>
                {summary.byCategory.length > 0 && (
                  <div className="pt-3 border-t border-border flex flex-wrap gap-1.5">
                    {summary.byCategory.map((c) => (
                      <Badge key={c.name} variant="secondary" className="font-normal">{c.name} · {c.count}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-violet-500" /> Politiques : volume et bruit
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  « Bruit » : sévérité faible, moyenne ou information et au moins 15 % des alertes de la période — réglage à envisager
                </p>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Politique</TableHead>
                        <TableHead>Sévérité</TableHead>
                        <TableHead className="text-right">Alertes</TableHead>
                        <TableHead className="text-right">Part</TableHead>
                        <TableHead className="text-right">Ouvertes</TableHead>
                        <TableHead className="text-right">Fermées</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.noise.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium max-w-[260px] truncate" title={p.name}>{p.name}</TableCell>
                          <TableCell><Badge variant="outline" className={SEVERITY_BADGE[p.severity]}>{SEVERITY_LABELS[p.severity]}</Badge></TableCell>
                          <TableCell className="text-right font-bold">{p.total}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap">{p.share} %</TableCell>
                          <TableCell className="text-right">{p.open}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap">{p.closedPct} %</TableCell>
                          <TableCell>
                            {p.noisy && <Badge variant="outline" title="Bruit probable : réglage de la politique à envisager" className="bg-violet-500/15 text-violet-600 border-violet-500/30 whitespace-nowrap">Bruit</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 5 : DERNIÈRES ALERTES */}
          <Card>
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase">
                Dernières alertes de la période
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Menace (politique)</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Sévérité</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Événements</TableHead>
                      <TableHead>Données sensibles</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.latest.map((a) => {
                      const sev = normalizeSeverity(a.policy?.severity);
                      return (
                        <TableRow key={a.id} className={isOpen(a) ? "" : "opacity-60"}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(alertDate(a))}</TableCell>
                          <TableCell className="font-medium">{a.policy?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{a.policy?.category ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={SEVERITY_BADGE[sev]}>
                              {a.policy?.severity ?? SEVERITY_LABELS.unknown}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{formatStatus(a.status)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{a.eventsCount ?? "—"}</TableCell>
                          <TableCell>
                            {a.hasSensitiveResource
                              ? <Badge variant="outline" className="bg-orange-500/15 text-orange-600 border-orange-500/30">Oui</Badge>
                              : <span className="text-sm text-muted-foreground">Non</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
