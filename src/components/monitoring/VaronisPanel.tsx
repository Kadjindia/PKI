import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import VaronisSchemaDiagnostic from "./VaronisSchemaDiagnostic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, AlertOctagon, Database, Bell, RefreshCw, Loader2, AlertTriangle, Inbox,
  Calendar, TrendingUp, TrendingDown, Minus, Clock, Lightbulb, Info, ListChecks,
  Lock, Upload, UserCog, Trash2, Hourglass, Users, Tag, Zap, Volume2,
  ShieldCheck, Server, UserCheck, ExternalLink, ChevronDown, ChevronUp, Filter, X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend,
} from "recharts";
import {
  summarizeAlerts, normalizeSeverity, formatStatus, alertDate, isOpen,
  computeRange, previousRange, filterByRange, dataCoverage,
  granularityFor, buildTimeline, hourlyDistribution, isOffHours, buildInsights,
  threatTracking, openAgeBuckets, handlingSplit, escalationRate, eventSpikes, policyNoise,
  verdictStats, dataSourceStats, closedByStats, openEscalations, safeAlertUrl,
  VERDICT_LABELS, ESCALATION_LABELS, type Verdict, type EscalationType,
  SEVERITY_LABELS, type ThreatFamily,
  applyFilters, toggleFilter, applyFilterPatch, filterChips, removeChip, isFiltered, type AlertFilters,
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
const VERDICT_COLORS: Record<Verdict, string> = {
  truePositive: "bg-red-500", falsePositive: "bg-slate-400", other: "bg-sky-500",
};
const ESCALATION_ORDER: EscalationType[] = ["MITIGATION", "VALIDATION", "INFORMATION"];

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

/** Élément cliquable d'un visuel : estompé quand un autre élément du même visuel est filtré. */
const clickable = (active: boolean, dimmed: boolean) =>
  `cursor-pointer transition-opacity hover:bg-muted/60 rounded-md ${active ? "ring-2 ring-primary/60" : ""} ${dimmed ? "opacity-40" : ""}`;

/** Alertes de sévérité élevée levées (ouvertes ou fermées). */
const countHigh = (list: VaronisAlert[]) => list.filter((a) => normalizeSeverity(a.policy?.severity) === "high").length;

export default function VaronisPanel() {
  const [progress, setProgress] = useState<number | null>(null);
  const [timePrefix, setTimePrefix] = useState<TimePrefix>("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>("days");
  const [showDetails, setShowDetails] = useState(false);
  const [showAllLatest, setShowAllLatest] = useState(false);
  // Filtres croisés : tout clic sur un visuel filtre l'ensemble de l'onglet
  const [filters, setFilters] = useState<AlertFilters>({});
  const toggle = <K extends keyof AlertFilters>(key: K, value: Parameters<typeof toggleFilter<K>>[2]) =>
    setFilters((f) => toggleFilter(f, key, value));
  const patch = (p: AlertFilters) => setFilters((f) => applyFilterPatch(f, p));
  const has = (p: AlertFilters) => Object.entries(p).every(([k, v]) => JSON.stringify(filters[k as keyof AlertFilters]) === JSON.stringify(v));

  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["varonis-alerts"],
    queryFn: () => fetchVaronisAlerts(setProgress),
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 15,
    retry: false,
  });

  const view = useMemo(() => {
    const all = data?.alerts ?? [];
    // Filtres (hors barre du graphique d'évolution) appliqués à toutes les alertes reçues,
    // y compris pour les blocs « toutes périodes » (arriéré, escalades, prise en charge)
    const { bucket, ...rest } = filters;
    const scoped = applyFilters(all, rest);
    const range = computeRange(timePrefix, timeValue, timeUnit);
    const inRange = filterByRange(scoped, range);
    const current = bucket ? applyFilters(inRange, { bucket }) : inRange;
    const prevRange = previousRange(range);
    const previous = filterByRange(scoped, prevRange);
    const coverage = dataCoverage(all);
    // Pas de comparaison si la période précédente commence avant les données reçues
    const canCompare = coverage !== null && prevRange.from >= coverage.oldest.getTime();
    const granularity = granularityFor(range);
    const summary = summarizeAlerts(current, 50);
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
      // L'évolution garde toutes ses barres : la barre choisie est mise en avant
      timeline: buildTimeline(inRange, range, granularity).map((p, i, list) => ({
        ...p, label: formatBucket(p.start, granularity), end: list[i + 1]?.start ?? range.to,
      })),
      hourly: hourlyDistribution(current),
      offHoursPct: current.length ? Math.round((offHours / current.length) * 100) : 0,
      // 6 points maximum, déjà classés du plus critique au plus informatif
      insights: buildInsights(current, canCompare ? previous : [], scoped).slice(0, 6),
      threats: threatTracking(current, canCompare ? previous : []),
      canCompare,
      ages: openAgeBuckets(scoped),
      handling: handlingSplit(scoped),
      escalation: escalationRate(current),
      spikes: eventSpikes(current),
      noise: policyNoise(current).slice(0, 8),
      taggedOpen: current.filter((a) => isOpen(a) && a.hasTaggedResource).length,
      verdicts: verdictStats(current),
      sources: dataSourceStats(current).slice(0, 6),
      closers: closedByStats(current),
      escalations: openEscalations(scoped),
      treatedPct: summary.total ? Math.round(((summary.total - summary.open) / summary.total) * 100) : 0,
    };
  }, [data, timePrefix, timeValue, timeUnit, filters]);

  const { summary, coverage } = view;
  // Outil de diagnostic du schéma Varonis, affiché seulement avec ?diag=1
  const showDiag = new URLSearchParams(useLocation().search).get("diag") === "1";
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
        {showDiag && <VaronisSchemaDiagnostic />}
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
        {showDiag && <VaronisSchemaDiagnostic />}
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

  const statusOptions = [...new Set((data?.alerts ?? []).map((a) => formatStatus(a.status)))].sort();
  const severityData = SEVERITY_ORDER
    .map((s) => ({ key: s, name: SEVERITY_LABELS[s], value: summary.bySeverity[s] }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {header}
      {showDiag && <VaronisSchemaDiagnostic />}

      {periodStartsBeforeData && coverage && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 text-sm">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            La période choisie commence avant la plus ancienne alerte renvoyée par Varonis ({formatDay(coverage.oldest)}) :
            les chiffres et les comparaisons peuvent être incomplets.
          </span>
        </div>
      )}

      {/* FILTRES */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted">
            <Filter className="w-4 h-4" /> Statut{filters.state || filters.status?.length ? " •" : ""} <ChevronDown className="w-3.5 h-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2 space-y-1">
            {(["open", "closed"] as const).map((st) => (
              <label key={st} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-sm cursor-pointer">
                <input type="checkbox" checked={filters.state === st} onChange={() => toggle("state", st)} />
                {st === "open" ? "Ouvertes" : "Clôturées"}
              </label>
            ))}
            <div className="border-t border-border my-1" />
            {statusOptions.map((name) => (
              <label key={name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-sm cursor-pointer">
                <input type="checkbox" checked={filters.status?.includes(name) ?? false} onChange={() => toggle("status", name)} />
                {name}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted">
            <Filter className="w-4 h-4" /> Sévérité{filters.severity?.length ? " •" : ""} <ChevronDown className="w-3.5 h-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 space-y-1">
            {SEVERITY_ORDER.map((sev) => (
              <label key={sev} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-sm cursor-pointer">
                <input type="checkbox" checked={filters.severity?.includes(sev) ?? false} onChange={() => toggle("severity", sev)} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_COLORS[sev] }} /> {SEVERITY_LABELS[sev]}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        {filterChips(filters).map((chip) => (
          <button
            key={`${chip.key}-${String(chip.value ?? "")}`}
            type="button"
            onClick={() => setFilters((f) => removeChip(f, chip))}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
            title="Retirer ce filtre"
          >
            {chip.label} <X className="w-3 h-3" />
          </button>
        ))}
        {isFiltered(filters) ? (
          <button type="button" onClick={() => setFilters({})} className="text-xs font-semibold text-muted-foreground hover:text-foreground underline">
            Tout effacer
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Astuce : cliquez sur un chiffre, une barre, une part ou une ligne pour filtrer tout l&apos;onglet.</span>
        )}
      </div>

      {summary.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-2 text-muted-foreground">
            <Inbox className="w-8 h-8" />
            <p className="text-sm">{isFiltered(filters) ? "Aucune alerte ne correspond aux filtres sur cette période." : "Aucune alerte Varonis sur cette période."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* LIGNE 1 : INDICATEURS CLÉS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className={`border-l-4 border-l-primary ${clickable(!filters.state && !filters.severity?.length && !filters.sensitive, false)}`} onClick={() => setFilters((f) => ({ ...f, state: undefined, severity: undefined, sensitive: undefined }))} title="Toutes les alertes (retire les filtres de statut, sévérité et données sensibles)">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Alertes sur la période</CardTitle>
                <div className="p-1.5 bg-primary/10 rounded-md"><Bell className="w-4 h-4 text-primary" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{summary.total.toLocaleString("fr-FR")}</div>
                <div className="mt-1"><PreviousPeriod current={summary.total} previous={view.previousCount} comparable={view.canCompare} /></div>
              </CardContent>
            </Card>

            <Card className={`border-l-4 border-l-amber-500 ${clickable(has({ state: "open" }), false)}`} onClick={() => patch({ state: "open" })} title="Filtrer sur les alertes ouvertes">
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

            <Card className={`border-l-4 border-l-red-500 ${clickable(has({ state: "open", severity: ["high"] }), false)}`} onClick={() => patch({ state: "open", severity: ["high"] })} title="Filtrer sur les alertes élevées ouvertes">
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

            <Card className={`border-l-4 border-l-orange-500 ${clickable(has({ state: "open", sensitive: true }), false)}`} onClick={() => patch({ state: "open", sensitive: true })} title="Filtrer sur les alertes ouvertes touchant des données sensibles">
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

          {/* MENACES CRITIQUES : bandeau compact */}
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-xs font-semibold text-muted-foreground">Menaces critiques ouvertes</span>
              {view.threats.map((t) => {
                const Icon = THREAT_ICONS[t.key];
                const active = t.open > 0;
                return (
                  <button type="button" key={t.key} onClick={() => toggle("threat", t.key)} className={`inline-flex items-center gap-1.5 text-sm px-2 py-1 ${clickable(filters.threat === t.key, Boolean(filters.threat) && filters.threat !== t.key)}`} title={`${t.total} sur la période · cliquer pour filtrer`}>
                    <Icon className={`w-4 h-4 ${active ? "text-red-500" : "text-muted-foreground"}`} />
                    <span className="text-foreground">{t.label}</span>
                    <b className={active ? "text-red-500" : "text-foreground"}>{t.open}</b>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* À RETENIR + ARRIÉRÉ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" /> Points d&apos;attention
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                {view.insights.slice(0, 4).map((ins) => {
                  const { icon: Icon, className } = INSIGHT_STYLE[ins.level];
                  return (
                    <button
                      type="button"
                      key={ins.text}
                      disabled={!ins.filter}
                      onClick={() => ins.filter && patch(ins.filter)}
                      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border ${className} ${ins.filter ? "cursor-pointer hover:brightness-95" : "cursor-default"} ${ins.filter && has(ins.filter) ? "ring-2 ring-primary/60" : ""}`}
                      title={ins.filter ? "Cliquer pour filtrer sur ces alertes" : undefined}
                    >
                      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ins.text}</span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Hourglass className="w-4 h-4 text-amber-500" /> Alertes ouvertes à traiter
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Toutes périodes confondues (arriéré actuel)</p>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {(() => {
                  const { lt7, d7to30, gt30 } = view.ages;
                  const total = Math.max(1, lt7 + d7to30 + gt30);
                  const segs = [
                    { key: "lt7" as const, label: "< 7 jours", value: lt7, color: "bg-emerald-500" },
                    { key: "d7to30" as const, label: "7 à 30 jours", value: d7to30, color: "bg-amber-500" },
                    { key: "gt30" as const, label: "> 30 jours", value: gt30, color: "bg-red-500" },
                  ];
                  return (
                    <>
                      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                        {segs.map((sg) => (
                          <div key={sg.label} onClick={() => toggle("age", sg.key)} className={`${sg.color} cursor-pointer ${filters.age && filters.age !== sg.key ? "opacity-40" : ""}`} style={{ width: `${(sg.value / total) * 100}%` }} />
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {segs.map((sg) => (
                          <div key={sg.label} onClick={() => toggle("age", sg.key)} className={`py-1 ${clickable(filters.age === sg.key, Boolean(filters.age) && filters.age !== sg.key)}`} title="Cliquer pour filtrer">
                            <div className="text-xl font-black text-foreground">{sg.value}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${sg.color}`} /> {sg.label}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className={`text-xs text-muted-foreground border-t border-border pt-3 ${view.ages.highGt7 > 0 ? "cursor-pointer hover:text-foreground" : ""}`} onClick={() => view.ages.highGt7 > 0 && patch({ severity: ["high"], age: "gt7" })}>
                        {view.ages.highGt7 > 0
                          ? <><span className="font-bold text-red-500">{view.ages.highGt7}</span> alerte{view.ages.highGt7 > 1 ? "s" : ""} élevée{view.ages.highGt7 > 1 ? "s" : ""} ouverte{view.ages.highGt7 > 1 ? "s" : ""} depuis plus de 7 jours</>
                          : "Aucune alerte élevée ouverte depuis plus de 7 jours"}
                        {view.ages.oldestDays !== null && ` · plus ancienne : ${view.ages.oldestDays} j`}
                      </p>
                    </>
                  );
                })()}
                <div className="border-t border-border pt-3">
                  <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Escalades Varonis en attente de votre action</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {ESCALATION_ORDER.map((t) => (
                      <div key={t} onClick={() => toggle("escalation", t)} title="Cliquer pour filtrer" className={`rounded-lg border p-2 ${t === "MITIGATION" && view.escalations[t] > 0 ? "border-red-500/40 bg-red-500/5" : "border-border"} ${clickable(filters.escalation === t, Boolean(filters.escalation) && filters.escalation !== t)}`}>
                        <div className={`text-lg font-black ${t === "MITIGATION" && view.escalations[t] > 0 ? "text-red-500" : "text-foreground"}`}>{view.escalations[t]}</div>
                        <div className="text-[11px] text-muted-foreground">{ESCALATION_LABELS[t]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ÉVOLUTION + POLITIQUES LES PLUS ACTIVES */}
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
                  <BarChart
                    data={view.timeline}
                    margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                    className="cursor-pointer"
                    onClick={(e) => {
                      const p = e?.activePayload?.[0]?.payload as { start: number; end: number; label: string } | undefined;
                      if (p) toggle("bucket", { from: p.start, to: p.end, label: p.label });
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <RechartsTooltip {...TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(e) => toggle("severity", e.dataKey as SeverityLevel)} />
                    {SEVERITY_ORDER.filter((s) => (s !== "info" && s !== "unknown") || view.timeline.some((p) => p[s] > 0)).map((s) => (
                      <Bar key={s} dataKey={s} name={SEVERITY_LABELS[s]} stackId="sev" fill={SEVERITY_COLORS[s]} radius={s === "high" ? [3, 3, 0, 0] : 0}>
                        {view.timeline.map((p) => (
                          <Cell
                            key={p.start}
                            fillOpacity={(filters.bucket && filters.bucket.from !== p.start) || (filters.severity?.length && !filters.severity.includes(s)) ? 0.25 : 1}
                          />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-violet-500" /> Politiques les plus actives
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">« Bruit » : réglage de la politique à envisager</p>
              </CardHeader>
              <CardContent className="pt-2">
                <ul>
                  {view.noise.slice(0, 5).map((p) => (
                    <li key={p.name} onClick={() => toggle("policy", p.name)} title="Cliquer pour filtrer" className={`flex items-center justify-between gap-3 py-1.5 px-1 border-b border-border/50 last:border-0 text-sm ${clickable(filters.policy === p.name, Boolean(filters.policy) && filters.policy !== p.name)}`}>
                      <span className="truncate text-foreground" title={p.name}>{p.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {p.noisy && <Badge variant="outline" className="bg-violet-500/15 text-violet-600 border-violet-500/30">Bruit</Badge>}
                        <b>{p.total}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* DERNIÈRES ALERTES */}
          <Card>
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase">
                {isFiltered(filters) ? `Alertes correspondant aux filtres (${summary.total})` : "Dernières alertes de la période"}
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
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.latest.slice(0, showAllLatest ? undefined : 5).map((a) => {
                      const sev = normalizeSeverity(a.policy?.severity);
                      return (
                        <TableRow key={a.id} className={isOpen(a) ? "" : "opacity-60"}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(alertDate(a))}</TableCell>
                          <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => toggle("policy", a.policy?.name || "Politique inconnue")} title="Filtrer sur cette politique">{a.policy?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground cursor-pointer hover:underline" onClick={() => toggle("category", a.policy?.category || "Non catégorisée")} title="Filtrer sur cette catégorie">{a.policy?.category ?? "—"}</TableCell>
                          <TableCell className="cursor-pointer" onClick={() => toggle("severity", sev)} title="Filtrer sur cette sévérité">
                            <Badge variant="outline" className={SEVERITY_BADGE[sev]}>
                              {a.policy?.severity ?? SEVERITY_LABELS.unknown}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm cursor-pointer hover:underline" onClick={() => toggle("status", formatStatus(a.status))} title="Filtrer sur ce statut">{formatStatus(a.status)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{a.eventsCount ?? "—"}</TableCell>
                          <TableCell>
                            {a.hasSensitiveResource
                              ? <Badge variant="outline" onClick={() => patch({ sensitive: true })} className="cursor-pointer bg-orange-500/15 text-orange-600 border-orange-500/30">Oui</Badge>
                              : <span className="text-sm text-muted-foreground">Non</span>}
                          </TableCell>
                          <TableCell>
                            {safeAlertUrl(a) && (
                              <a href={safeAlertUrl(a)!} target="_blank" rel="noopener noreferrer" title="Ouvrir l'alerte dans Varonis" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline whitespace-nowrap">
                                <ExternalLink className="w-3.5 h-3.5" /> Varonis
                              </a>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {summary.latest.length > 5 && (
                <button type="button" onClick={() => setShowAllLatest(!showAllLatest)} className="text-xs font-semibold text-primary hover:underline mt-2">
                  {showAllLatest ? "Afficher moins" : `Afficher les ${summary.latest.length}`}
                </button>
              )}
            </CardContent>
          </Card>

          {/* ANALYSE DÉTAILLÉE : repliée par défaut */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl border border-border text-primary hover:bg-primary/5"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? "Masquer l'analyse détaillée" : "Analyse détaillée : sévérités, prise en charge, verdicts, sources, horaires, politiques"}
          </button>

          {showDetails && (
            <div className="space-y-4">
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
                        <Pie
                          data={severityData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none"
                          className="cursor-pointer" onClick={(d) => toggle("severity", (d as unknown as { key: SeverityLevel }).key)}
                        >
                          {severityData.map((d) => (
                            <Cell key={d.key} fill={SEVERITY_COLORS[d.key]} fillOpacity={filters.severity?.length && !filters.severity.includes(d.key) ? 0.3 : 1} />
                          ))}
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
                    { key: "internal" as const, label: "Équipe interne", value: internal, color: "bg-sky-500" },
                    { key: "varonis" as const, label: "Varonis (MDR)", value: varonis, color: "bg-violet-500" },
                  ].map((r) => (
                    <div key={r.label} onClick={() => toggle("handling", r.key)} title="Cliquer pour filtrer" className={`space-y-1 p-1 ${clickable(filters.handling === r.key, Boolean(filters.handling) && filters.handling !== r.key)}`}>
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
                      <li key={a.id} onClick={() => toggle("policy", a.policy?.name || "Politique inconnue")} title="Filtrer sur cette politique" className={`flex items-center justify-between gap-3 text-sm p-1 ${clickable(filters.policy === a.policy?.name, false)}`}>
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> Verdict des alertes clôturées
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  D&apos;après le motif de clôture, sur {view.verdicts.classified} alerte{view.verdicts.classified > 1 ? "s" : ""} clôturée{view.verdicts.classified > 1 ? "s" : ""} avec un motif
                </p>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {view.verdicts.classified === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun motif de clôture sur la période.</p>
                ) : (
                  <>
                    <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                      {(["truePositive", "falsePositive", "other"] as Verdict[]).map((k) => (
                        <div key={k} onClick={() => toggle("verdict", k)} className={`${VERDICT_COLORS[k]} cursor-pointer ${filters.verdict && filters.verdict !== k ? "opacity-40" : ""}`} style={{ width: `${(view.verdicts[k] / view.verdicts.classified) * 100}%` }} />
                      ))}
                    </div>
                    <ul className="space-y-1.5">
                      {(["truePositive", "falsePositive", "other"] as Verdict[]).map((k) => (
                        <li key={k} onClick={() => toggle("verdict", k)} title="Cliquer pour filtrer" className={`flex justify-between gap-3 text-sm px-1 ${clickable(filters.verdict === k, Boolean(filters.verdict) && filters.verdict !== k)}`}>
                          <span className="flex items-center gap-2 text-foreground"><span className={`w-2.5 h-2.5 rounded-full ${VERDICT_COLORS[k]}`} />{VERDICT_LABELS[k]}</span>
                          <span className="font-bold">{view.verdicts[k]} <span className="text-muted-foreground font-normal">({Math.round((view.verdicts[k] / view.verdicts.classified) * 100)} %)</span></span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-border pt-2">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1">Motifs les plus fréquents</p>
                      {view.verdicts.reasons.slice(0, 4).map((r) => (
                        <div key={r.name} onClick={() => toggle("closeReason", r.name)} className={`flex justify-between gap-3 text-xs px-1 ${clickable(filters.closeReason === r.name, Boolean(filters.closeReason) && filters.closeReason !== r.name)}`}>
                          <span className="truncate text-muted-foreground" title={r.name}>{r.name}</span>
                          <span className="font-semibold">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-500" /> Où se produisent les alertes
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Par type de source de données, sur la période</p>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {view.sources.map((src) => (
                  <div key={src.label} onClick={() => toggle("source", src.label)} title="Cliquer pour filtrer" className={`space-y-1 p-1 ${clickable(filters.source === src.label, Boolean(filters.source) && filters.source !== src.label)}`}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate text-foreground" title={src.label}>{src.label}</span>
                      <span className="font-bold shrink-0">{src.total}{src.open > 0 && <span className="text-amber-500 font-semibold"> · {src.open} ouverte{src.open > 1 ? "s" : ""}</span>}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${(src.total / Math.max(1, view.sources[0]?.total ?? 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-violet-500" /> Qui clôture les alertes
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">Alertes clôturées sur la période</p>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {(() => {
                  const c = view.closers;
                  const total = Math.max(1, c.varonis + c.internal + c.unknown);
                  return [
                    { key: "internal" as const, label: "Équipe interne", value: c.internal, color: "bg-sky-500" },
                    { key: "varonis" as const, label: "Varonis (MDR)", value: c.varonis, color: "bg-violet-500" },
                    ...(c.unknown > 0 ? [{ key: "unknown" as const, label: "Non renseigné", value: c.unknown, color: "bg-slate-400" }] : []),
                  ].map((r) => (
                    <div key={r.label} onClick={() => toggle("closer", r.key)} title="Cliquer pour filtrer" className={`space-y-1 p-1 ${clickable(filters.closer === r.key, Boolean(filters.closer) && filters.closer !== r.key)}`}>
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
                {view.closers.analysts.length > 0 && (
                  <div className="border-t border-border pt-2">
                    <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1">Analystes internes</p>
                    {view.closers.analysts.map((a) => (
                      <div key={a.name} onClick={() => toggle("analyst", a.name)} className={`flex justify-between gap-3 text-xs px-1 ${clickable(filters.analyst === a.name, Boolean(filters.analyst) && filters.analyst !== a.name)}`}>
                        <span className="truncate text-muted-foreground" title={a.name}>{a.name}</span>
                        <span className="font-semibold">{a.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
              </div>
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
                    <li key={st.name} onClick={() => toggle("status", st.name)} title="Cliquer pour filtrer" className={`flex justify-between gap-3 text-sm px-1 ${clickable(filters.status?.includes(st.name) ?? false, Boolean(filters.status?.length) && !filters.status?.includes(st.name))}`}>
                      <span className="text-foreground">{st.name}</span>
                      <span className="font-bold">{st.count}</span>
                    </li>
                  ))}
                </ul>
                {summary.byCategory.length > 0 && (
                  <div className="pt-3 border-t border-border flex flex-wrap gap-1.5">
                    {summary.byCategory.map((c) => (
                      <Badge key={c.name} variant="secondary" onClick={() => toggle("category", c.name)} className={`font-normal cursor-pointer ${filters.category === c.name ? "ring-2 ring-primary/60" : ""} ${filters.category && filters.category !== c.name ? "opacity-40" : ""}`}>{c.name} · {c.count}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="flex flex-col">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-500" /> Répartition horaire
                </CardTitle>
                <p className={`text-[11px] text-muted-foreground pt-1 cursor-pointer hover:text-foreground ${filters.offHours ? "font-bold" : ""}`} onClick={() => toggle("offHours", true)} title="Filtrer sur les alertes hors heures ouvrées">
                  <span className="font-bold text-violet-500">{view.offHoursPct} %</span> hors heures ouvrées (avant 8 h, après 19 h, week-end)
                </p>
              </CardHeader>
              <CardContent className="pt-4 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={view.hourly}
                    margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                    className="cursor-pointer"
                    onClick={(e) => { const h = e?.activePayload?.[0]?.payload?.hour; if (typeof h === "number") toggle("hour", h); }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} interval={3} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(h) => `${h}h – ${Number(h) + 1}h`} formatter={(v) => [v, "Alertes"]} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {view.hourly.map((h) => (
                        <Cell key={h.hour} fill={h.hour < 8 || h.hour >= 19 ? "#8b5cf6" : "#0ea5e9"} fillOpacity={filters.hour !== undefined && filters.hour !== h.hour ? 0.25 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
              </div>
            <Card>
              <CardHeader className="pb-2 border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-violet-500" /> Politiques : volume et bruit
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  « Bruit » : au moins 15 % des alertes avec une sévérité faible, moyenne ou information, ou une majorité de faux positifs — réglage à envisager
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
                        <TableHead className="text-right whitespace-nowrap">Faux positifs</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.noise.map((p) => (
                        <TableRow key={p.name} onClick={() => toggle("policy", p.name)} title="Cliquer pour filtrer" className={`cursor-pointer ${filters.policy === p.name ? "bg-primary/10" : ""} ${filters.policy && filters.policy !== p.name ? "opacity-40" : ""}`}>
                          <TableCell className="font-medium max-w-[260px] truncate" title={p.name}>{p.name}</TableCell>
                          <TableCell><Badge variant="outline" className={SEVERITY_BADGE[p.severity]}>{SEVERITY_LABELS[p.severity]}</Badge></TableCell>
                          <TableCell className="text-right font-bold">{p.total}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap">{p.share} %</TableCell>
                          <TableCell className="text-right">{p.open}</TableCell>
                          <TableCell className={`text-right whitespace-nowrap ${p.falsePositivePct !== null && p.falsePositivePct >= 50 ? "text-violet-600 font-bold" : "text-muted-foreground"}`}>
                            {p.falsePositivePct === null ? "—" : `${p.falsePositivePct} %`}
                          </TableCell>
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
          )}
        </>
      )}
    </div>
  );
}
