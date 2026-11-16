import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, Flame, Hourglass, Radar, Info, Loader2, AlertTriangle, Bug, Server, LineChart as LineIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import {
  AGE_LABELS, SEVERITY_LABELS, HISTORY_METRICS, fmt, pct, daysSince, progressLabel,
  type QualysState, type QualysHistoryPoint, type QualysVuln,
} from "@/lib/qualys";

// Vulnérabilités Qualys VMDR : photo calculée chaque nuit côté serveur (qualys-proxy).
// L'écran lit la dernière photo ; pendant un calcul, il revient toutes les minutes.

async function callQualys<T>(action?: "history"): Promise<T> {
  const { data, error } = await supabase.functions.invoke("qualys-proxy", { body: action ? { action } : {} });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data as T;
}

/** Définition d'un indicateur, au clic sur ⓘ. */
function Help({ children }: { readonly children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger aria-label="Définition" className="text-muted-foreground hover:text-foreground shrink-0">
        <Info className="w-4 h-4" />
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-relaxed">{children}</PopoverContent>
    </Popover>
  );
}

function Kpi({ title, help, icon: Icon, color, value, sub }: {
  readonly title: string; readonly help: React.ReactNode; readonly icon: typeof Info; readonly color: string;
  readonly value: string; readonly sub?: React.ReactNode;
}) {
  return (
    <Card className={`border-l-4 ${color}`}>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="w-4 h-4 shrink-0" /> {title}</div>
          <Help>{help}</Help>
        </div>
        <div className="text-3xl font-black text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/** Petite tuile chiffrée (ligne secondaire). */
function Tile({ label, value, help }: { readonly label: string; readonly value: string; readonly help: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-1 text-[11px] font-semibold text-muted-foreground">
        <span>{label}</span><Help>{help}</Help>
      </div>
      <div className="text-xl font-black text-foreground">{value}</div>
    </div>
  );
}

function Badge({ children, tone }: { readonly children: React.ReactNode; readonly tone: "red" | "orange" | "violet" | "muted" }) {
  const cls = { red: "bg-red-500/10 text-red-600", orange: "bg-orange-500/10 text-orange-600", violet: "bg-violet-500/10 text-violet-600", muted: "bg-muted text-muted-foreground" }[tone];
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{children}</span>;
}

const AGE_COLORS = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-600"];
const formatDay = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const TOOLTIP_STYLE = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 700 },
  itemStyle: { color: "hsl(var(--foreground))" },
};
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function VulnBadges({ v }: { readonly v: QualysVuln }) {
  return (
    <span className="space-x-1">
      {v.kev && <Badge tone="red">CISA KEV</Badge>}
      {v.ransomware && <Badge tone="violet">Ransomware</Badge>}
      {v.activeAttacks && !v.kev && <Badge tone="orange">Attaques actives</Badge>}
      {v.patchable && <Badge tone="muted">Correctif dispo.</Badge>}
    </span>
  );
}

function History() {
  const [metric, setMetric] = useState<(typeof HISTORY_METRICS)[number]["key"]>("sev5");
  const { data } = useQuery({ queryKey: ["qualys-history"], queryFn: () => callQualys<{ points: QualysHistoryPoint[] }>("history"), staleTime: 60 * 60 * 1000, retry: false });
  const def = HISTORY_METRICS.find((m) => m.key === metric)!;
  const series = (data?.points ?? []).filter((p) => p[metric] !== null).map((p) => ({ time: Date.parse(p.date), value: p[metric] as number }));
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-bold flex items-center gap-2"><LineIcon className="w-4 h-4 text-primary" /> Évolution dans le temps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {HISTORY_METRICS.map((m) => (
            <button key={m.key} type="button" onClick={() => setMetric(m.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${metric === m.key ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
              {m.label}
            </button>
          ))}
        </div>
        {series.length < 2 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">La courbe apparaîtra après deux nuits de calcul.</p>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={formatDay} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("fr-FR")} formatter={(v) => [`${Number(v).toLocaleString("fr-FR")}${def.unit ? ` ${def.unit}` : ""}`, def.label]} />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function QualysPanel() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["qualys"],
    queryFn: () => callQualys<QualysState>(),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 60_000 : false),
  });
  const [showAll, setShowAll] = useState({ vulns: false, hosts: false });
  const r = data?.latest ?? null;

  const header = (
    <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
      <ShieldAlert className="w-7 h-7 text-primary" /> Vulnérabilités — Qualys
    </h2>
  );

  if (isLoading) {
    return <div className="space-y-6">{header}<div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin text-primary" /> Chargement…</div></div>;
  }

  const banners = (
    <>
      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0" /> {(error as Error).message}</CardContent>
        </Card>
      )}
      {data?.lastError && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Le dernier calcul n&apos;a pas abouti : {data.lastError}
          </CardContent>
        </Card>
      )}
      {data?.running && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-primary" /> Calcul en cours : {progressLabel(data.running)}
          </CardContent>
        </Card>
      )}
    </>
  );

  if (!r) {
    return (
      <div className="space-y-6">
        {header}
        {banners}
        {!error && !data?.running && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Les vulnérabilités n&apos;ont pas encore été calculées : elles le seront automatiquement la nuit prochaine.</CardContent></Card>
        )}
      </div>
    );
  }

  const sev5 = r.severities.find((s) => s.severity === 5);
  const overdue = r.severities.reduce((t, s) => t + s.overdue, 0);
  const coverage = pct(r.coverage.scanned, r.coverage.total);
  const trTotal = Math.max(1, r.coverage.trurisk.critical + r.coverage.trurisk.high + r.coverage.trurisk.medium + r.coverage.trurisk.low);
  const vulns = showAll.vulns ? r.topVulns : r.topVulns.slice(0, 8);
  const hosts = showAll.hosts ? r.topHosts : r.topHosts.slice(0, 8);

  return (
    <div className="space-y-6">
      {header}
      {banners}

      {/* CHIFFRES CLÉS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Vulnérabilités critiques" icon={Bug} color="border-l-red-500" value={fmt(sev5?.total)}
          help={<>Vulnérabilités de <b>sévérité 5</b> encore ouvertes (nouvelles, actives ou réouvertes), toutes machines confondues.</>}
          sub={`sur ${fmt(r.hostsWithVulns)} actifs touchés`} />
        <Kpi title="Exploitées (CISA KEV)" icon={Flame} color="border-l-orange-500" value={fmt(r.kev.detections)}
          help={<>Vulnérabilités ouvertes de sévérité 4 ou 5 figurant au catalogue de la CISA des failles <b>activement exploitées</b> par des attaquants.</>}
          sub={`${fmt(r.kev.vulns)} failles distinctes`} />
        <Kpi title="Hors délai de correction" icon={Hourglass} color="border-l-amber-500" value={fmt(overdue)}
          help={<>Vulnérabilités ouvertes depuis plus longtemps que le délai cible : {r.severities.map((s) => `${s.slaDays} jours pour la sévérité ${s.severity}`).join(", ")}.</>}
          sub={`${pct(overdue, r.detections.total) ?? 0} % des vulnérabilités de sévérité 4 et 5`} />
        <Kpi title="Couverture des scans" icon={Radar} color="border-l-sky-500" value={coverage === null ? "—" : `${coverage} %`}
          help={<>Part des actifs dont les vulnérabilités ont été analysées (agent ou scanner) dans les {r.coverage.recentDays} derniers jours.</>}
          sub={`${fmt(r.coverage.scanned)} actifs sur ${fmt(r.coverage.total)}`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Liées à des ransomwares" value={fmt(r.ransomware.detections)} help={<>Vulnérabilités ouvertes connues pour être utilisées par des rançongiciels.</>} />
        <Tile label="Critiques corrigeables" value={fmt(r.criticalPatchable)} help={<>Vulnérabilités critiques (QDS ≥ 90) pour lesquelles l&apos;éditeur a publié un correctif.</>} />
        <Tile label="QDS ≥ 90" value={fmt(r.detections.qdsCritical)} help={<>Vulnérabilités dont le score de détection Qualys (QDS, de 1 à 100) est critique : gravité, exploitation constatée et exposition réunies.</>} />
        <Tile label="Réouvertes" value={fmt(r.severities.reduce((t, s) => t + s.reopened, 0))} help={<>Vulnérabilités corrigées puis détectées à nouveau.</>} />
      </div>

      <History />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ANCIENNETÉ ET DÉLAIS */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2"><Hourglass className="w-4 h-4 text-amber-500" /> Ancienneté et délais de correction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {r.severities.map((s) => (
              <div key={s.severity} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-foreground">{SEVERITY_LABELS[s.severity]} · {fmt(s.total)}</span>
                  <span className="text-xs text-muted-foreground">
                    délai cible {s.slaDays} j · <b className={s.overdue ? "text-red-600" : "text-emerald-600"}>{fmt(s.overdue)} hors délai ({pct(s.overdue, s.total) ?? 0} %)</b>
                  </span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                  {s.ages.map((n, i) => <div key={i} className={AGE_COLORS[i]} style={{ width: `${(n / Math.max(1, s.total)) * 100}%` }} title={`${AGE_LABELS[i]} : ${fmt(n)}`} />)}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {AGE_LABELS.map((l, i) => <span key={l} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${AGE_COLORS[i]}`} /> {l}</span>)}
              <span>· depuis la première détection</span>
            </div>
          </CardContent>
        </Card>

        {/* COUVERTURE */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2"><Radar className="w-4 h-4 text-sky-500" /> Actifs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-1.5">
              {[
                ["Actifs suivis par Qualys", fmt(r.coverage.total)],
                ["Équipés de l'agent", `${fmt(r.coverage.agent)} (${pct(r.coverage.agent, r.coverage.total) ?? 0} %)`],
                [`Analysés depuis moins de ${r.coverage.recentDays} j`, fmt(r.coverage.scanned)],
                ["Jamais analysés", fmt(r.coverage.neverScanned)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>Risque des actifs (TruRisk)</span>
                <Help>Score de risque Qualys de chaque actif (0 à 1 000), qui combine ses vulnérabilités et son importance. Critique : 850 et plus ; élevé : 700 à 849.</Help>
              </div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                {([["critical", "bg-red-600"], ["high", "bg-orange-500"], ["medium", "bg-amber-400"], ["low", "bg-emerald-500"]] as const).map(([k, c]) => (
                  <div key={k} className={c} style={{ width: `${(r.coverage.trurisk[k] / trTotal) * 100}%` }} />
                ))}
              </div>
              <div className="grid grid-cols-4 text-center text-[11px] text-muted-foreground">
                <span><b className="text-foreground">{fmt(r.coverage.trurisk.critical)}</b><br />critique</span>
                <span><b className="text-foreground">{fmt(r.coverage.trurisk.high)}</b><br />élevé</span>
                <span><b className="text-foreground">{fmt(r.coverage.trurisk.medium)}</b><br />moyen</span>
                <span><b className="text-foreground">{fmt(r.coverage.trurisk.low)}</b><br />faible</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* VULNÉRABILITÉS LES PLUS RÉPANDUES */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2"><Bug className="w-4 h-4 text-red-500" /> Vulnérabilités les plus répandues</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vulnérabilité</TableHead>
                  <TableHead className="text-center">Sév.</TableHead>
                  <TableHead className="text-right">Actifs</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Présente depuis</TableHead>
                  <TableHead>Signaux</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vulns.map((v) => (
                  <TableRow key={v.qid}>
                    <TableCell className="max-w-[420px] py-2">
                      <div className="text-sm font-medium truncate" title={v.title ?? ""}>{v.title ?? `QID ${v.qid}`}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">QID {v.qid}{v.cves ? ` · ${v.cves}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-center py-2"><Badge tone={v.severity === 5 ? "red" : "orange"}>{v.severity}</Badge></TableCell>
                    <TableCell className="text-right font-semibold py-2">{fmt(v.hosts)}</TableCell>
                    <TableCell className={`text-right py-2 ${v.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{fmt(v.overdue)}</TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap py-2">{daysSince(v.firstFound) === null ? "—" : `${fmt(daysSince(v.firstFound))} j`}</TableCell>
                    <TableCell className="py-2"><VulnBadges v={v} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {r.topVulns.length > 8 && (
            <button type="button" onClick={() => setShowAll((s) => ({ ...s, vulns: !s.vulns }))} className="text-xs font-semibold text-primary hover:underline mt-2">
              {showAll.vulns ? "Afficher moins" : `Afficher les ${r.topVulns.length}`}
            </button>
          )}
        </CardContent>
      </Card>

      {/* ACTIFS LES PLUS EXPOSÉS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2"><Server className="w-4 h-4 text-primary" /> Actifs les plus exposés</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Actif</TableHead>
                  <TableHead className="text-right whitespace-nowrap">QDS ≥ 90</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Sévérité 5</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Sévérité 4</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hosts.map((h, i) => (
                  <TableRow key={h.id ?? i}>
                    <TableCell className="max-w-[360px] py-2">
                      <div className="text-sm font-medium truncate" title={h.name ?? ""}>{h.name ?? h.ip ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{[h.ip, h.os].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold py-2">{fmt(h.qdsCritical)}</TableCell>
                    <TableCell className="text-right py-2">{fmt(h.d5)}</TableCell>
                    <TableCell className="text-right py-2">{fmt(h.d4)}</TableCell>
                    <TableCell className={`text-right py-2 ${h.overdue ? "text-red-600" : "text-muted-foreground"}`}>{fmt(h.overdue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {r.topHosts.length > 8 && (
            <button type="button" onClick={() => setShowAll((s) => ({ ...s, hosts: !s.hosts }))} className="text-xs font-semibold text-primary hover:underline mt-2">
              {showAll.hosts ? "Afficher moins" : `Afficher les ${r.topHosts.length}`}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
