import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, Flame, Hourglass, Radar, Info, Loader2, AlertTriangle, Server, Gauge, Timer, Search,
  CheckCircle2, XCircle, HelpCircle, KeyRound, RotateCcw, FileWarning, LineChart as LineIcon, Crosshair, Wrench, Archive, ClipboardCheck,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import {
  AGE_LABELS, SEVERITY_LABELS, slaText, HISTORY_METRICS, ASSET_TYPE_LABELS, FLAGS, fmt, pct, daysSince, progressLabel, trendOver, remediationProgress,
  type QualysState, type QualysHistoryPoint, type QualysVuln, type QualysResults, type QualysSearch, type QualysDiagnostic,
  type QualysFixView, type AssetType,
} from "@/lib/qualys";
import {
  indexCatalog, filterAssets, summarize, isFiltered,
  type AssetsPayload, type DAsset, type CatalogIndex, type Summary, type QFilters, type TruTier,
} from "@/lib/qualysDetails";
import { QualysContext, clickable, useQualysCtx } from "./qualys/ui";
import { AssetSheet, VulnSheet } from "./qualys/Sheets";
import { callQualys } from "./qualys/api";
import { AxisSection, FilterBar, AssetTable, PriorityFixes, EolList, CsamInventory, WebAppsExplorer } from "./qualys/Explorer";

// Vulnérabilités Qualys VMDR, organisées par axes de gouvernance :
//   1. Visibilité (socle)  2. Exposition aux menaces  3. Efficacité opérationnelle.
// Photo calculée chaque nuit côté serveur (qualys-proxy) ; l'écran lit la dernière photo.


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

/** Écart sur 30 jours, en vert quand il va dans le bon sens. */
function Delta({ value, lowerIsBetter, unit = "" }: { readonly value: number | null; readonly lowerIsBetter: boolean; readonly unit?: string }) {
  if (value === null || value === 0) return null;
  const good = lowerIsBetter ? value < 0 : value > 0;
  return <span className={`font-semibold ${good ? "text-emerald-600" : "text-red-600"}`}>{value > 0 ? "▲" : "▼"} {fmt(Math.abs(Math.round(value * 10) / 10))}{unit} sur 30 j</span>;
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
        {sub && <div className="text-xs text-muted-foreground space-x-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Badge({ children, tone }: { readonly children: React.ReactNode; readonly tone: "red" | "orange" | "violet" | "sky" | "muted" | "green" }) {
  const cls = {
    red: "bg-red-500/10 text-red-600", orange: "bg-orange-500/10 text-orange-600", violet: "bg-violet-500/10 text-violet-600",
    sky: "bg-sky-500/10 text-sky-600", green: "bg-emerald-500/10 text-emerald-600", muted: "bg-muted text-muted-foreground",
  }[tone];
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{children}</span>;
}


/** Section pas encore calculée dans la photo affichée. */
function Pending({ children = "Disponible après le prochain calcul de nuit." }: { readonly children?: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-4 text-center">{children}</p>;
}

const AGE_COLORS = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-red-600"];
const TYPE_TONE: Record<AssetType, "sky" | "muted" | "violet"> = { server: "violet", workstation: "sky", other: "muted" };
const formatDay = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const formatMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const TOOLTIP_STYLE = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 700 },
  itemStyle: { color: "hsl(var(--foreground))" },
};
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function VulnBadges({ v }: { readonly v: Pick<QualysVuln, "kev" | "ransomware" | "activeAttacks" | "exploitPublic" | "patchable"> }) {
  return (
    <span className="space-x-1">
      {v.kev && <Badge tone="red">CISA KEV</Badge>}
      {v.ransomware && <Badge tone="violet">Ransomware</Badge>}
      {v.activeAttacks && !v.kev && <Badge tone="orange">Attaques actives</Badge>}
      {v.exploitPublic && !v.kev && !v.activeAttacks && <Badge tone="orange">Exploit public</Badge>}
      {v.patchable && <Badge tone="muted">Correctif disponible</Badge>}
    </span>
  );
}

const flagsToBadges = (flags: number) => ({
  kev: Boolean(flags & FLAGS.kev), ransomware: Boolean(flags & FLAGS.ransomware), activeAttacks: Boolean(flags & FLAGS.activeAttacks),
  exploitPublic: Boolean(flags & FLAGS.exploitPublic), patchable: Boolean(flags & FLAGS.patchable),
});

/** Importance d'une règle de configuration (libellés Qualys en anglais). */
const CRITICALITY_FR: Record<string, string> = { URGENT: "Urgente", CRITICAL: "Critique", SERIOUS: "Sérieuse", HIGH: "Élevée", MEDIUM: "Moyenne", MINIMAL: "Faible", LOW: "Faible" };
const criticalityLabel = (c: string) => CRITICALITY_FR[c.trim().toUpperCase()] ?? c;

/** Barre « part dans les délais ». */
function SlaBar({ rate }: { readonly rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const color = rate >= 90 ? "bg-emerald-500" : rate >= 70 ? "bg-amber-400" : "bg-red-600";
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><div className={color} style={{ width: `${rate}%`, height: "100%" }} /></div>
      <span className="text-sm font-bold w-16 text-right whitespace-nowrap">{fmt(rate)} %</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Axe 2 : exposition aux menaces
// ---------------------------------------------------------------------------

function ExposureSearch() {
  const ctx = useQualysCtx();
  const [q, setQ] = useState("");
  const search = useMutation({ mutationFn: (query: string) => callQualys<QualysSearch>({ action: "search", q: query }) });
  const r = search.data;
  const progress = r ? remediationProgress(r.trend) : null;
  const series = (r?.trend ?? []).map((t) => ({ time: Date.parse(t.date), value: t.hosts }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-red-500" /> Exposition à une vulnérabilité médiatisée
          <Help>Quand une vulnérabilité fait l&apos;actualité (ex. Log4Shell), saisissez sa référence CVE, son QID Qualys ou un mot de son titre : nombre d&apos;actifs touchés d&apos;après le calcul de la nuit, et évolution nuit après nuit pour suivre la remédiation. Vulnérabilités critiques, élevées et modérées.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) search.mutate(q.trim()); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE, QID ou mot du titre (ex. CVE-2021-44228, Log4j)" maxLength={100} />
          <Button type="submit" disabled={q.trim().length < 3 || search.isPending}>
            {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Rechercher
          </Button>
        </form>
        {search.error && <p className="text-sm text-destructive">{(search.error as Error).message}</p>}
        {r && (r.matches.length === 0 ? (
          <p className="text-sm text-emerald-600 font-semibold">Aucun actif touché par « {r.query} » d&apos;après le dernier calcul{r.date ? ` (${new Date(r.date).toLocaleDateString("fr-FR")})` : ""}.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">Actifs touchés aujourd&apos;hui</div>
                <div className="text-2xl font-black">{fmt(r.matches.reduce((t, m) => t + m.hosts, 0))}</div>
                <div className="text-[11px] text-muted-foreground">dont {fmt(r.matches.reduce((t, m) => t + m.servers, 0))} sur des serveurs</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">Avancement de la correction</div>
                <div className="text-2xl font-black">{progress?.pct === null || !progress ? "—" : `${progress.pct} %`}</div>
                <div className="text-[11px] text-muted-foreground">{progress && progress.peak ? `jusqu'à ${fmt(progress.peak)} actifs touchés` : "après plusieurs nuits de calcul"}</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2 h-[86px]">
                {series.length < 2 ? <div className="text-[11px] text-muted-foreground pt-6 text-center">La courbe apparaîtra après deux nuits.</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={formatDay} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("fr-FR")} formatter={(v) => [fmt(Number(v)), "Actifs touchés"]} />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vulnérabilité</TableHead>
                    <TableHead className="text-center">Sévérité</TableHead>
                    <TableHead className="text-right">Actifs</TableHead>
                    <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                    <TableHead>Menaces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.matches.map((m) => (
                    <TableRow key={m.qid} className={ctx ? "cursor-pointer hover:bg-muted/50" : ""} onClick={() => ctx?.openVuln(m.qid)}>
                      <TableCell className="max-w-[420px] py-2">
                        <div className="text-sm font-medium truncate" title={m.title ?? ""}>{m.title ?? `QID ${m.qid}`}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">QID {m.qid}{m.cves ? ` · ${m.cves}` : ""}</div>
                      </TableCell>
                      <TableCell className="text-center py-2"><Badge tone={m.severity === 5 ? "red" : m.severity === 4 ? "orange" : "muted"}>{m.severity}</Badge></TableCell>
                      <TableCell className="text-right font-semibold py-2">{fmt(m.hosts)}</TableCell>
                      <TableCell className="text-right py-2">{fmt(m.servers)}</TableCell>
                      <TableCell className={`text-right py-2 ${m.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{fmt(m.overdue)}</TableCell>
                      <TableCell className="py-2"><VulnBadges v={flagsToBadges(m.flags)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Tuile chiffrée qui filtre la page au clic. */
function ThreatTile({ label, value, sub, active, dimmed, onClick, tone }: {
  readonly label: string; readonly value: number; readonly sub?: string; readonly active: boolean; readonly dimmed?: boolean; readonly onClick: () => void; readonly tone: string;
}) {
  return (
    <button type="button" onClick={onClick} title="Cliquer pour filtrer la page" className={`text-left rounded-lg border border-border px-3 py-2 ${clickable(active, dimmed)}`}>
      <div className={`text-2xl font-black ${value ? tone : ""}`}>{fmt(value)}</div>
      <div className="text-[11px] font-semibold text-muted-foreground leading-tight">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </button>
  );
}

function ExposureAxis({ r, d }: { readonly r: QualysResults; readonly d: DView | null }) {
  const e = r.exposure;
  const ctx = useQualysCtx();
  const f = ctx?.filters ?? {};
  const s = d?.sum;
  const one = <K extends keyof QFilters>(k: K, v: QFilters[K]) => ctx?.setFilters((x) => ({ ...x, [k]: x[k] === v ? undefined : v }));
  return (
    <AxisSection id="axe2" n={2} title="Exposition aux menaces" subtitle="Les vulnérabilités qui menacent réellement l'entreprise aujourd'hui, plutôt que leur volume total."
      metrics={s ? [
        { value: fmt(s.kevAssets), label: "actifs exposés CISA KEV" },
        { value: fmt(s.armedAssets), label: "actifs exploitables" },
        { value: fmt(s.withSev5), label: "avec une critique" },
      ] : e ? [{ value: fmt(e.armed.detections), label: "vulnérabilités exploitables" }] : undefined}>
      {d && s ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Actifs exposés à une menace réelle
                <Help>Nombre d&apos;actifs (et non de détections) portant au moins une vulnérabilité ouverte de chaque catégorie : exploitée activement selon le catalogue CISA KEV, utilisée par des ransomwares, exploitable (KEV, ransomware, attaques actives ou exploit public). Un actif peut entrer dans plusieurs cases. Cliquer pour filtrer toute la page.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <ThreatTile label="Vulnérabilité exploitée activement (CISA KEV)" value={s.kevAssets} sub={`${pct(s.kevAssets, s.total) ?? 0} % des actifs`} tone="text-red-600" active={f.threat === "kev"} dimmed={Boolean(f.threat && f.threat !== "kev")} onClick={() => one("threat", "kev")} />
              <ThreatTile label="Vulnérabilité utilisée par des ransomwares" value={s.ransomwareAssets} sub={`${pct(s.ransomwareAssets, s.total) ?? 0} % des actifs`} tone="text-violet-600" active={f.threat === "ransomware"} dimmed={Boolean(f.threat && f.threat !== "ransomware")} onClick={() => one("threat", "ransomware")} />
              <ThreatTile label="Vulnérabilité exploitable" value={s.armedAssets} sub={`dont ${fmt(s.armedServers)} serveurs`} tone="text-orange-600" active={f.threat === "armed"} dimmed={Boolean(f.threat && f.threat !== "armed")} onClick={() => one("threat", "armed")} />
              <ThreatTile label="Vulnérabilité critique (sévérité 5)" value={s.withSev5} sub={`${fmt(s.d5)} vulnérabilités critiques`} tone="text-red-600" active={Boolean(f.sev5)} onClick={() => one("sev5", true)} />
              <ThreatTile label="Vulnérabilité hors délai" value={s.withOverdue} sub={`${fmt(s.overdue)} vulnérabilités hors délai`} tone="text-amber-600" active={Boolean(f.overdue)} onClick={() => one("overdue", true)} />
            </CardContent>
          </Card>
          <PriorityFixes assets={d.assets} idx={d.idx} />
          <AssetTable assets={d.assets} title={<><Server className="w-4 h-4 text-primary" /> Actifs les plus exposés</>} initial={10} csvName="qualys-actifs-exposes.csv"
            help={<>Actifs classés par score de risque TruRisk (0 à 1 000), qui combine leurs vulnérabilités et leur criticité ; tri possible par vulnérabilités, exploitables ou hors délai. Cliquer sur un actif pour voir toutes ses caractéristiques et vulnérabilités. Le type (serveur, poste) est déduit du système d&apos;exploitation.</>} />
        </>
      ) : !e ? <Card><CardContent><Pending /></CardContent></Card> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* VULNÉRABILITÉS ARMÉES */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Vulnérabilités exploitables
                <Help>Vulnérabilités ouvertes qu&apos;un attaquant peut utiliser dès maintenant : exploitées activement (catalogue CISA KEV), utilisées par des ransomwares, attaques actives constatées par Qualys, ou exploit public disponible.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[["Exploitées activement (CISA KEV)", r.kev.detections], ["Ransomware", r.ransomware.detections], ["Attaques actives", r.activeAttacks.detections], ["Exploit public", e.armed.exploitPublic]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <div className="text-lg font-black">{fmt(Number(v))}</div>
                    <div className="text-[10px] text-muted-foreground font-semibold">{l}</div>
                  </div>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Les plus répandues</TableHead>
                    <TableHead className="text-right">Actifs</TableHead>
                    <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.topArmed.map((v) => (
                    <TableRow key={v.qid}>
                      <TableCell className="max-w-[300px] py-1.5">
                        <div className="text-sm font-medium truncate" title={v.title ?? ""}>{v.title ?? `QID ${v.qid}`}</div>
                        <div className="text-[11px] text-muted-foreground truncate"><VulnBadges v={v} /> {v.cves && <span className="font-mono">{v.cves}</span>}</div>
                      </TableCell>
                      <TableCell className="text-right font-semibold py-1.5">{fmt(v.hosts)}</TableCell>
                      <TableCell className="text-right py-1.5">{fmt(v.servers ?? null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" /> Top 10 des actifs les plus exposés
                <Help>Actifs au score de risque TruRisk le plus élevé (0 à 1 000). La fiche détaillée de chaque actif sera disponible après le prochain calcul.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actif</TableHead>
                    <TableHead className="text-right whitespace-nowrap">TruRisk</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Crit. / Élev. / Mod.</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.topRisk.map((h, i) => (
                    <TableRow key={h.id ?? i}>
                      <TableCell className="max-w-[240px] py-1.5">
                        <div className="text-sm font-medium truncate" title={h.name ?? ""}>{h.name ?? h.ip ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground truncate"><Badge tone={TYPE_TONE[h.type]}>{ASSET_TYPE_LABELS[h.type]}</Badge> {h.os}</div>
                      </TableCell>
                      <TableCell className="text-right font-black py-1.5">{fmt(h.trurisk)}</TableCell>
                      <TableCell className="text-right py-1.5 whitespace-nowrap">{h.d5 === null ? "—" : `${fmt(h.d5)} / ${fmt(h.d4)}${h.d3 != null ? ` / ${fmt(h.d3)}` : ""}`}</TableCell>
                      <TableCell className="text-right py-1.5">{fmt(h.overdue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
      <ExposureSearch />
    </AxisSection>
  );
}

// ---------------------------------------------------------------------------
// Axe 3 : efficacité opérationnelle
// ---------------------------------------------------------------------------

function FixRow({ label, f, target, targetLabel }: { readonly label: React.ReactNode; readonly f: QualysFixView; readonly target?: number; readonly targetLabel?: string }) {
  return (
    <TableRow>
      <TableCell className="py-2 font-semibold">{label}</TableCell>
      <TableCell className="text-right py-2">{fmt(f.fixed)}</TableCell>
      <TableCell className="py-2"><SlaBar rate={f.slaRate} /></TableCell>
      <TableCell className={`text-right py-2 font-bold ${target && f.mttr !== null && f.mttr > target ? "text-red-600" : ""}`}>{f.mttr === null ? "—" : `${fmt(f.mttr)} j`}</TableCell>
      <TableCell className="text-right py-2 text-muted-foreground">{f.median === null ? "—" : `${fmt(f.median)} j`}</TableCell>
      <TableCell className="text-right py-2 text-muted-foreground whitespace-nowrap">{targetLabel ?? (target ? `${target} j` : "")}</TableCell>
    </TableRow>
  );
}

function OperationsAxis({ r, d }: { readonly r: QualysResults; readonly d: DView | null }) {
  const o = r.operations;
  const ctx = useQualysCtx();
  const sevTotal = r.severities.reduce((t, s) => t + s.total, 0);
  return (
    <AxisSection id="axe3" n={3} title="Efficacité de la remédiation" subtitle="Les vulnérabilités sont-elles corrigées dans les délais fixés par la politique de gestion des correctifs ?"
      metrics={o?.fixedCollected ? [
        { value: o.fixed.all.slaRate === null ? "—" : `${fmt(o.fixed.all.slaRate)} %`, label: "dans les délais" },
        { value: o.fixed.bySev["5"]?.mttr == null ? "—" : `${fmt(o.fixed.bySev["5"]!.mttr)} j`, label: "MTTR critiques" },
        { value: fmt(r.severities.reduce((t, x) => t + x.overdue, 0)), label: "hors délai" },
      ] : undefined}>
      {d && isFiltered(ctx?.filters ?? {}) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 text-sm flex flex-wrap gap-x-5 gap-y-1">
            <span className="font-semibold">Sur la sélection ({fmt(d.sum.total)} actifs) :</span>
            <span><b className="text-red-600">{fmt(d.sum.d5)}</b> critiques</span><span><b>{fmt(d.sum.d4)}</b> élevées</span><span><b>{fmt(d.sum.d3)}</b> modérées ouvertes</span>
            <span><b className="text-red-600">{fmt(d.sum.overdue)}</b> hors délai ({pct(d.sum.overdue, d.sum.d5 + d.sum.d4 + d.sum.d3) ?? 0} %)</span>
            <span><b>{fmt(d.sum.reopened)}</b> réouvertes</span><span><b>{fmt(d.sum.ignored)}</b> en dérogation</span>
            <span className="text-xs text-muted-foreground w-full">Délais de correction (SLA, MTTR) et ancienneté ci-dessous : chiffres de tout le parc.</span>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> Respect des délais (SLA) et délai moyen de correction (MTTR)
            <Help>Vulnérabilités corrigées au cours des {o?.windowDays ?? 90} derniers jours. Délai de correction : de la première détection à la correction constatée par Qualys (corrections prises en compte avec un jour de décalage, le temps que Qualys traite les scans). Délais de la politique de gestion des correctifs : {r.severities.map((s) => `${slaText(s)} pour les ${(SEVERITY_LABELS[s.severity] ?? "").toLowerCase()}`).join(", ")} (mois calendaires). Une vulnérabilité critique est traitée comme un incident de sécurité. Temps médian : la moitié des vulnérabilités sont corrigées plus vite. Serveurs et postes de travail relèvent en général de deux équipes distinctes.</Help>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {o?.fixedError && <p className="text-xs text-amber-600 flex items-center gap-1.5 pb-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Les corrections de la nuit n&apos;ont pas pu être lues ({o.fixedError}) : chiffres calculés sur l&apos;historique déjà enregistré ; elles seront reprises au prochain calcul.</p>}
          {!o?.fixedCollected ? <Pending /> : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead className="text-right">Corrigées</TableHead>
                      <TableHead>Dans les délais</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Temps moyen</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Temps médian</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Délai fixé</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.severities.map((s) => <FixRow key={s.severity} label={SEVERITY_LABELS[s.severity]} f={o.fixed.bySev[String(s.severity) as "3" | "4" | "5"] ?? { fixed: 0, inSla: 0, slaRate: null, mttr: null, median: null }} target={s.slaDays} targetLabel={slaText(s)} />)}
                    {(["server", "workstation", "other"] as const).filter((t) => o.fixed.byType[t]?.fixed).map((t) => (
                      <FixRow key={t} label={<span className="text-muted-foreground font-normal">dont {ASSET_TYPE_LABELS[t].toLowerCase()}</span>} f={o.fixed.byType[t]} />
                    ))}
                  </TableBody>
                </Table>
              </div>
              {o.fixed.monthly.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">Mois après mois (le MTTR doit baisser au fil de l&apos;année)
                    <Help>Vulnérabilités corrigées chaque mois, sur les 8 derniers mois (l&apos;historique se constitue au fil des calculs, jusqu&apos;à 12 mois). Le premier mois de l&apos;historique peut être incomplet (« partiel ») et le mois en cours n&apos;est pas terminé.</Help>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {o.fixed.monthly.slice(-8).map((m) => (
                      <div key={m.month} className="rounded-lg border border-border px-3 py-2 text-xs">
                        <div className="font-bold"><span className="capitalize">{formatMonth(m.month)}</span>{m.partial && <span className="ml-1.5"><Badge tone="muted">{m.partial === "start" ? "partiel" : "en cours"}</Badge></span>}</div>
                        <div className="text-muted-foreground">{fmt(m.fixed)} corrigées · {m.slaRate === null ? "—" : `${fmt(m.slaRate)} %`} dans les délais</div>
                        <div>MTTR : critiques <b>{m.mttr5 === null ? "—" : `${fmt(m.mttr5)} j`}</b> · élevées <b>{m.mttr4 === null ? "—" : `${fmt(m.mttr4)} j`}</b>{m.mttr3 != null && <> · modérées <b>{fmt(m.mttr3)} j</b></>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* BACKLOG */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Hourglass className="w-4 h-4 text-amber-500" /> Ancienneté des vulnérabilités ouvertes
              <Help>Vulnérabilités encore ouvertes, par ancienneté depuis leur première détection. Une part croissante au-delà de 180 jours signale une dette qui s&apos;accumule.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {r.severities.map((s) => (
              <div key={s.severity} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-foreground">{SEVERITY_LABELS[s.severity]} · {fmt(s.total)} ouvertes{s.avgAge != null ? ` · âge moyen ${fmt(s.avgAge)} j` : ""}</span>
                  <span className="text-xs text-muted-foreground">
                    délai fixé {slaText(s)} · <b className={s.overdue ? "text-red-600" : "text-emerald-600"}>{fmt(s.overdue)} hors délai ({pct(s.overdue, s.total) ?? 0} %)</b>
                  </span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                  {s.ages.map((n, i) => <div key={i} className={AGE_COLORS[i]} style={{ width: `${(n / Math.max(1, s.total)) * 100}%` }} title={`${AGE_LABELS[i]} : ${fmt(n)}`} />)}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {AGE_LABELS.map((l, i) => <span key={l} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${AGE_COLORS[i]}`} /> {l}</span>)}
            </div>
            {o && (
              <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-3">
                {(["server", "workstation", "other"] as const).map((t) => (
                  <div key={t}>
                    <div className="font-semibold">{ASSET_TYPE_LABELS[t]}</div>
                    <div className="text-muted-foreground">{fmt(o.open.byType[t].total)} ouvertes · <span className={o.open.byType[t].overdue ? "text-red-600" : ""}>{pct(o.open.byType[t].overdue, o.open.byType[t].total) ?? 0} % hors délai</span></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* RÉOUVERTURE */}
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-start justify-between gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> Taux de réouverture</span>
                <Help>Part des vulnérabilités ouvertes qui avaient été corrigées puis sont réapparues au scan suivant : souvent un problème de masterisation ou un retour arrière sur des serveurs.</Help>
              </div>
              <div className="text-2xl font-black">{o?.reopenRate != null ? `${fmt(o.reopenRate)} %` : `${pct(r.severities.reduce((t, s) => t + s.reopened, 0), sevTotal) ?? 0} %`}</div>
              <div className="text-xs text-muted-foreground">{fmt(r.severities.reduce((t, s) => t + s.reopened, 0))} vulnérabilités réouvertes</div>
            </CardContent>
          </Card>
          {/* DÉROGATIONS */}
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-start justify-between gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5"><FileWarning className="w-4 h-4" /> Dérogations</span>
                <Help>Vulnérabilités marquées « ignorées » dans Qualys (risque accepté, exception de correctif). Elles sont exclues des autres chiffres. Leur ancienneté montre si des dérogations durent indéfiniment. Les dates d&apos;échéance ne sont pas disponibles par l&apos;API.</Help>
              </div>
              {!o ? <Pending /> : (
                <>
                  <div className="text-2xl font-black">{fmt(o.ignored.total)}</div>
                  <div className="text-xs text-muted-foreground">dont {fmt(o.ignored.sev5)} critiques · {fmt(o.ignored.ages[3])} depuis plus de 180 j</div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AxisSection>
  );
}

// ---------------------------------------------------------------------------
// Axe 1 : visibilité (partiel, en attendant CSAM) et diagnostic des accès
// ---------------------------------------------------------------------------

/** Détail de la dernière photo, filtré selon la page. */
interface DView { all: DAsset[]; assets: DAsset[]; idx: CatalogIndex; sum: Summary }

const TIER_BAR: [TruTier, string, string][] = [["critical", "bg-red-600", "critique"], ["high", "bg-orange-500", "élevé"], ["medium", "bg-amber-400", "moyen"], ["low", "bg-emerald-500", "faible"]];

/** Ligne « libellé : valeur » qui filtre la page au clic. */
function FilterLine({ label, value, active, onClick }: { readonly label: string; readonly value: string; readonly active?: boolean; readonly onClick?: () => void }) {
  return (
    <div className={`flex justify-between gap-2 px-1.5 py-0.5 ${onClick ? clickable(Boolean(active)) : ""}`} onClick={onClick} title={onClick ? "Cliquer pour filtrer la page" : undefined}>
      <dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd>
    </div>
  );
}

function VisibilityAxis({ r, d }: { readonly r: QualysResults; readonly d: DView | null }) {
  const ctx = useQualysCtx();
  const f = ctx?.filters ?? {};
  const set = ctx?.setFilters;
  const byType = r.coverage.byType;
  const s = d?.sum;
  const tiers = s ? s.tiers : r.coverage.trurisk;
  const trTotal = Math.max(1, tiers.critical + tiers.high + tiers.medium + tiers.low);
  const total = s ? s.total : r.coverage.total;
  const agent = s ? s.agent : r.coverage.agent;
  const recent = s ? s.recent : r.coverage.scanned;
  const never = s ? s.never : r.coverage.neverScanned;
  return (
    <AxisSection id="axe1" n={1} title="Visibilité du parc" subtitle="Le socle : un actif que Qualys n'analyse pas est un angle mort."
      metrics={[
        { value: fmt(total), label: "actifs suivis" },
        { value: `${pct(agent, total) ?? 0} %`, label: "avec agent" },
        { value: `${pct(recent, total) ?? 0} %`, label: "analysés < 30 j" },
        { value: fmt(never), label: "jamais analysés" },
      ]}>
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <dl className="space-y-1">
            <FilterLine label={d && isFiltered(f) ? "Actifs de la sélection" : "Actifs suivis par Qualys"} value={fmt(total)} />
            <FilterLine label="Équipés de l'agent Qualys" value={`${fmt(agent)} (${pct(agent, total) ?? 0} %)`} active={f.agent === true}
              onClick={set && d ? () => set((x) => ({ ...x, agent: x.agent === true ? undefined : true })) : undefined} />
            <FilterLine label="Sans agent Qualys" value={`${fmt(total - agent)} (${pct(total - agent, total) ?? 0} %)`} active={f.agent === false}
              onClick={set && d ? () => set((x) => ({ ...x, agent: x.agent === false ? undefined : false })) : undefined} />
            <FilterLine label={`Analysés depuis moins de ${r.coverage.recentDays} jours`} value={`${fmt(recent)} (${pct(recent, total) ?? 0} %)`} active={f.scan === "recent"}
              onClick={set && d ? () => set((x) => ({ ...x, scan: x.scan === "recent" ? undefined : "recent" })) : undefined} />
            {s && <FilterLine label={`Pas analysés depuis plus de ${r.coverage.recentDays} jours`} value={fmt(s.stale)} active={f.scan === "stale"}
              onClick={set ? () => set((x) => ({ ...x, scan: x.scan === "stale" ? undefined : "stale" })) : undefined} />}
            <FilterLine label="Jamais analysés" value={fmt(never)} active={f.scan === "never"}
              onClick={set && d ? () => set((x) => ({ ...x, scan: x.scan === "never" ? undefined : "never" })) : undefined} />
            {(["server", "workstation"] as const).map((t) => {
              const n = s ? s.byType[t] : byType?.[t].total ?? 0;
              const ok = s ? s.recentByType[t] : byType?.[t].scanned ?? 0;
              return <FilterLine key={t} label={`${ASSET_TYPE_LABELS[t]} analysés récemment`} value={`${fmt(ok)} sur ${fmt(n)} (${pct(ok, n) ?? 0} %)`} active={f.type?.length === 1 && f.type[0] === t}
                onClick={set && d ? () => set((x) => ({ ...x, type: x.type?.length === 1 && x.type[0] === t ? undefined : [t] })) : undefined} />;
            })}
            {s && <FilterLine label="Exposés sur Internet (IP publique)" value={fmt(s.publicIp)} active={f.publicIp === true}
              onClick={set ? () => set((x) => ({ ...x, publicIp: x.publicIp ? undefined : true })) : undefined} />}
          </dl>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>Score de risque des actifs (TruRisk)</span>
              <Help>Score de risque Qualys de chaque actif (0 à 1 000), qui combine ses vulnérabilités et sa criticité. Critique : 850 et plus ; élevé : 700 à 849 ; moyen : 500 à 699. Cliquer sur une tranche pour filtrer la page.</Help>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              {TIER_BAR.map(([k, c]) => (
                <div key={k} className={`${c} ${d ? "cursor-pointer" : ""} ${f.tier?.length && !f.tier.includes(k) ? "opacity-30" : ""}`} style={{ width: `${(tiers[k] / trTotal) * 100}%` }}
                  onClick={set && d ? () => set((x) => ({ ...x, tier: x.tier?.length === 1 && x.tier[0] === k ? undefined : [k] })) : undefined} />
              ))}
            </div>
            <div className="grid grid-cols-4 text-center text-[11px] text-muted-foreground">
              {TIER_BAR.map(([k, , l]) => (
                <span key={k} className={d ? clickable(Boolean(f.tier?.includes(k)), Boolean(f.tier?.length && !f.tier.includes(k))) : ""}
                  onClick={set && d ? () => set((x) => ({ ...x, tier: x.tier?.length === 1 && x.tier[0] === k ? undefined : [k] })) : undefined}>
                  <b className="text-foreground">{fmt(tiers[k])}</b><br />{l}
                </span>
              ))}
            </div>
            {s?.truriskAvg != null && <p className="text-xs text-muted-foreground pt-1">Score moyen de la sélection : <b className="text-foreground">{fmt(s.truriskAvg)}</b> / 1 000</p>}
            <p className="text-[11px] text-muted-foreground pt-2">Rapprochement avec la CMDB : nécessite un export de la CMDB (ServiceNow), à brancher.</p>
          </div>
        </CardContent>
      </Card>
      {d && (
        <AssetTable assets={d.assets} title={<><Server className="w-4 h-4 text-primary" /> Inventaire des actifs analysés (VMDR)</>} initial={25} csvName="qualys-inventaire-vmdr.csv"
          help={<>Tous les actifs suivis par Qualys VMDR, selon les filtres de la page : caractéristiques, score de risque, vulnérabilités ouvertes. Cliquer sur un actif pour ouvrir sa fiche complète ; cliquer sur un en-tête pour trier ; l&apos;export reprend toutes les colonnes.</>} />
      )}
      <InventoryCard r={r} />
      {d && <CsamInventory />}
      {d ? (
        <>
          <OsLifecycleCard r={r} />
          <EolList assets={d.assets} idx={d.idx} total={d.sum.total} />
        </>
      ) : <ObsolescenceCard r={r} />}
    </AxisSection>
  );
}

/** Cycle de vie des systèmes d'après CSAM (chiffres globaux). */
function OsLifecycleCard({ r }: { readonly r: QualysResults }) {
  const inv = r.inventory;
  if (!inv?.collected || inv.error || !inv.total) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Archive className="w-4 h-4 text-amber-600" /> Systèmes d&apos;exploitation hors support (CSAM)
          <Help>Cycle de vie des systèmes d&apos;exploitation fourni par Qualys CSAM, avec les dates de fin de support éditeur.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent><OsLifecycle r={r} /></CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, help, tone }: { readonly label: string; readonly value: string; readonly sub?: React.ReactNode; readonly help: React.ReactNode; readonly tone?: "red" | "amber" }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-start justify-between gap-1 text-[11px] font-semibold text-muted-foreground"><span>{label}</span><Help>{help}</Help></div>
      <div className={`text-2xl font-black ${tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Moyen de découverte d'un actif (libellés Qualys). */
const SOURCE_FR: Record<string, string> = { PASSIVE_SENSOR: "Capteur réseau passif", IP_SCANNER: "Scanner réseau", AGENT: "Agent", EASM: "Scan externe (EASM)", CLOUD_CONNECTOR: "Connecteur cloud" };
const sourceLabel = (src: string | null) => (src ? SOURCE_FR[src.trim().toUpperCase().replace(/\s+/g, "_")] ?? src : "—");

function InventoryCard({ r }: { readonly r: QualysResults }) {
  const inv = r.inventory;
  const ex = r.internetExposed;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Radar className="w-4 h-4 text-primary" /> Inventaire, agents et Shadow IT
          <Help>Inventaire des actifs de Qualys CSAM, qui réunit tout ce que Qualys voit (agents, scanners, capteur réseau passif). Permet de repérer les actifs non maîtrisés.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!inv?.collected ? <Pending /> : inv.error && !inv.total ? (
          <p className="text-sm text-amber-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Inventaire non disponible : {inv.error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="Actifs inventoriés" value={fmt(inv.total)} help={<>Tous les actifs connus de Qualys CSAM, quel que soit le moyen de découverte.</>} />
              <Stat label="Agent déployé" value={`${pct(inv.withAgent, inv.total) ?? 0} %`} sub={`${fmt(inv.withAgent)} actifs`}
                help={<>Part des actifs inventoriés équipés de l&apos;agent Qualys, qui les analyse en continu, même hors du réseau.</>} />
              <Stat label="Agents silencieux" value={fmt(inv.agentStale)} sub={`sans nouvelles depuis plus de ${inv.agentStaleDays} j`} tone={inv.agentStale ? "amber" : undefined}
                help={<>Agents installés qui n&apos;ont pas remonté d&apos;information depuis plus de {inv.agentStaleDays} jours : machine éteinte, retirée, ou agent en panne.</>} />
              <Stat label="Shadow IT" value={fmt(inv.unmanaged)} sub={`dont ${fmt(inv.unmanagedNew)} découverts en ${inv.newDays} j`} tone={inv.unmanaged ? "red" : undefined}
                help={<>Actifs découverts sur le réseau (capteur passif, découverte réseau) mais ni équipés de l&apos;agent ni analysés par un scan : on ne connaît pas leurs vulnérabilités.</>} />
              <Stat label="Exposés sur Internet" value={ex ? fmt(ex.total) : "—"} sub={ex ? `dont ${fmt(ex.byType.server)} serveurs` : undefined}
                help={<>Actifs analysés par Qualys dont l&apos;adresse IP est publique, donc joignables depuis Internet : notre surface d&apos;attaque externe. BitSight en donne la vue de l&apos;extérieur.</>} />
            </div>
            {inv.recentUnmanaged.length > 0 && (
              <div className="overflow-x-auto">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Derniers actifs inconnus découverts (à identifier et rattacher)</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Actif</TableHead>
                      <TableHead>Adresse IP</TableHead>
                      <TableHead>Système</TableHead>
                      <TableHead>Découvert par</TableHead>
                      <TableHead className="text-right">Le</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inv.recentUnmanaged.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="py-1.5 text-sm font-medium">{a.name ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs font-mono">{a.ip ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{a.os ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-xs">{sourceLabel(a.source)}</TableCell>
                        <TableCell className="py-1.5 text-xs text-right whitespace-nowrap">{a.created ? new Date(a.created).toLocaleDateString("fr-FR") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OsLifecycle({ r }: { readonly r: QualysResults }) {
  const inv = r.inventory;
  if (!inv?.collected || inv.error || !inv.total) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4 border-b border-border">
      <div className="space-y-1 text-sm">
        <div className="text-xs font-semibold text-muted-foreground">Systèmes d&apos;exploitation</div>
        <div className="text-3xl font-black">{fmt(inv.osEos)}</div>
        <div className="text-xs text-muted-foreground">actifs sous un système hors support éditeur, soit {pct(inv.osEos, inv.total) ?? 0} % de l&apos;inventaire</div>
        <div className="text-xs text-muted-foreground">dont {fmt(inv.osEol)} en fin de vie</div>
      </div>
      <div className="lg:col-span-2 overflow-x-auto">
        {inv.osOutdated.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-2">Aucun système hors support.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Système hors support</TableHead>
                <TableHead className="text-right">Actifs</TableHead>
                <TableHead className="text-right whitespace-nowrap">Fin de support</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.osOutdated.map((x) => (
                <TableRow key={x.os}>
                  <TableCell className="py-1.5 text-sm font-medium">{x.os}</TableCell>
                  <TableCell className="py-1.5 text-right font-semibold">{fmt(x.assets)}</TableCell>
                  <TableCell className="py-1.5 text-right text-xs whitespace-nowrap">{x.endOfSupport ? new Date(x.endOfSupport).toLocaleDateString("fr-FR") : x.endOfLife ? new Date(x.endOfLife).toLocaleDateString("fr-FR") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ObsolescenceCard({ r }: { readonly r: QualysResults }) {
  const o = r.obsolescence;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Archive className="w-4 h-4 text-amber-600" /> Obsolescence : systèmes et logiciels en fin de support
          <Help>Systèmes d&apos;exploitation et logiciels qui ne reçoivent plus de correctifs de sécurité de leur éditeur. Systèmes : cycle de vie fourni par Qualys CSAM, avec les dates de fin de support. Logiciels : vulnérabilités « EOL/Obsolete » de Qualys VMDR.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <OsLifecycle r={r} />
        {!o ? <Pending /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-3xl font-black">{o.hostsTracked ? fmt(o.hosts) : "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {o.hostsTracked ? <>actifs concernés, soit {pct(o.hosts, r.coverage.total) ?? 0} % du parc</> : "actifs concernés : dès la prochaine nuit (la liste des produits en fin de support est apprise d'une nuit sur l'autre)"}
                </div>
              </div>
              {o.hostsTracked && (
                <dl className="space-y-1 text-xs">
                  {(["server", "workstation", "other"] as const).map((t) => (
                    <div key={t} className="flex justify-between gap-2"><dt className="text-muted-foreground">{ASSET_TYPE_LABELS[t]}</dt><dd className="font-semibold">{fmt(o.byType[t])}</dd></div>
                  ))}
                </dl>
              )}
              <div className="text-xs text-muted-foreground border-t border-border pt-2">{fmt(o.products)} produits en fin de support, dont {fmt(o.osProducts)} systèmes d&apos;exploitation</div>
            </div>
            <div className="lg:col-span-2 overflow-x-auto">
              {o.top.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-4">Aucun produit en fin de support détecté.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit en fin de support</TableHead>
                      <TableHead className="text-right">Actifs</TableHead>
                      <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {o.top.map((p) => (
                      <TableRow key={p.qid}>
                        <TableCell className="max-w-[420px] py-1.5">
                          <div className="text-sm font-medium truncate" title={p.title}>{p.title}</div>
                          <div className="text-[11px] text-muted-foreground"><Badge tone={p.os ? "violet" : "muted"}>{p.os ? "Système" : "Logiciel"}</Badge> <span className="font-mono">QID {p.qid}</span></div>
                        </TableCell>
                        <TableCell className="text-right font-semibold py-1.5">{fmt(p.hosts)}</TableCell>
                        <TableCell className="text-right py-1.5">{fmt(p.servers)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Axe 5 : sécurité applicative (WAS)
// ---------------------------------------------------------------------------

function WebAppsAxis({ r, detail }: { readonly r: QualysResults; readonly detail: boolean }) {
  const w = r.webApps;
  const tot = (k: "sev5" | "sev4" | "sev3" | "overdue") => (w?.apps ?? []).reduce((t, a) => t + a[k], 0);
  return (
    <AxisSection id="axe5" n={5} title="Sécurité applicative" subtitle="Les vulnérabilités du code de nos applications web, et la rapidité des équipes de développement à les corriger (Qualys WAS)."
      metrics={w?.collected && !w.error ? [
        { value: fmt(w.open), label: "vulnérabilités ouvertes" },
        { value: fmt(tot("sev5")), label: "critiques" },
        { value: fmt(w.apps.length), label: "applications concernées" },
      ] : undefined}>
      <Card>
        <CardContent className="p-4 space-y-4">
          {!w?.collected ? <Pending /> : w.error && !w.apps.length ? (
            <p className="text-sm text-amber-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Applications web non disponibles : {w.error}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Vulnérabilités ouvertes" value={fmt(w.open)} sub={`sur ${fmt(w.apps.length)} applications`} help={<>Vulnérabilités de sévérité 3 à 5 encore présentes sur les applications web analysées par Qualys WAS (injections SQL, XSS…).</>} />
                <Stat label="Critiques" value={fmt(tot("sev5"))} sub={`${fmt(tot("sev4"))} élevées · ${fmt(tot("sev3"))} modérées`} tone={tot("sev5") ? "red" : undefined} help={<>Vulnérabilités applicatives de sévérité 5.</>} />
                <Stat label="Hors délai" value={fmt(tot("overdue"))} sub="selon la politique de gestion des correctifs" tone={tot("overdue") ? "amber" : undefined} help={<>Vulnérabilités ouvertes au-delà du délai de la politique (7 jours, 1 mois, 3 mois selon la sévérité).</>} />
                <Stat label="MTTR applicatif" value={w.fixed.mttr === null ? "—" : `${fmt(w.fixed.mttr)} j`} sub={w.fixed.fixed ? `${fmt(w.fixed.fixed)} corrigées en 90 j · ${fmt(w.fixed.slaRate)} % dans les délais` : "aucune correction sur 90 j"}
                  help={<>Délai moyen entre la détection d&apos;une vulnérabilité applicative et sa correction constatée par Qualys, sur les 90 derniers jours. La date de correction est approchée par le dernier test qui ne l&apos;a plus trouvée.</>} />
              </div>
              {detail ? null : <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Application</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Crit. / Élev. / Mod.</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {w.apps.slice(0, 15).map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="py-1.5 text-sm font-medium max-w-[360px] truncate" title={a.name}>{a.name}</TableCell>
                          <TableCell className="py-1.5 text-right whitespace-nowrap"><b className={a.sev5 ? "text-red-600" : ""}>{fmt(a.sev5)}</b> / {fmt(a.sev4)} / {fmt(a.sev3)}</TableCell>
                          <TableCell className={`py-1.5 text-right ${a.overdue ? "text-red-600" : "text-muted-foreground"}`}>{fmt(a.overdue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-2">
                    <span>Catégories OWASP Top 10</span>
                    <Help>Classement des vulnérabilités applicatives ouvertes selon les catégories du référentiel OWASP Top 10 (injection, contrôle d&apos;accès défaillant…), quand Qualys les indique.</Help>
                  </div>
                  {w.owasp.length === 0 ? <p className="text-xs text-muted-foreground">Catégories non indiquées par Qualys.</p> : (
                    <ul className="space-y-1.5 text-xs">
                      {w.owasp.map((c) => (
                        <li key={c.name} className="flex justify-between gap-2"><span className="truncate" title={c.name}>{c.name}</span><b>{fmt(c.count)}</b></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>}
            </>
          )}
        </CardContent>
      </Card>
      {detail && <WebAppsExplorer />}
    </AxisSection>
  );
}

// ---------------------------------------------------------------------------
// Axe 4 : conformité et durcissement (Policy Audit)
// ---------------------------------------------------------------------------

function ComplianceAxis({ r, points }: { readonly r: QualysResults; readonly points: QualysHistoryPoint[] }) {
  const c = r.compliance;
  return (
    <AxisSection id="axe4" n={4} title="Conformité et durcissement" subtitle="Le respect des référentiels de configuration que l'on s'est fixés (CIS, ANSSI…), mesuré par Qualys Policy Audit."
      metrics={c?.rate != null ? [
        { value: `${fmt(c.rate)} %`, label: "taux de conformité" },
        { value: fmt(c.policies.length), label: "politiques" },
        { value: fmt(c.failed), label: "contrôles en échec" },
      ] : undefined}>
      <Card>
        <CardContent className="p-4">
          {!c?.collected ? <Pending /> : c.error && c.policies.length === 0 ? (
            <div className="space-y-1.5 py-1">
              <p className="text-sm text-amber-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Conformité non disponible : {c.error}</p>
              {/license is not authorized|code 2012/i.test(c.error) && (
                <p className="text-xs text-muted-foreground">La licence Qualys n&apos;autorise pas l&apos;API qui donne l&apos;état de conformité par actif (la liste des politiques, elle, est accessible). C&apos;est une limite de l&apos;abonnement, pas des droits du compte : à voir avec l&apos;administrateur Qualys ou l&apos;interlocuteur commercial (option d&apos;accès API de Policy Audit).</p>
              )}
            </div>
          ) : c.policies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Aucune politique de conformité évaluée dans Policy Audit.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4" /> Taux de conformité</span>
                  <Help>Part des contrôles réussis parmi les contrôles évalués, toutes politiques et tous actifs confondus. Les contrôles en erreur (non évaluables) sont exclus.</Help>
                </div>
                <div className="text-4xl font-black">{c.rate === null ? "—" : `${fmt(c.rate)} %`}</div>
                <div className="text-xs text-muted-foreground">{fmt(c.passed)} contrôles réussis · {fmt(c.failed)} en échec · {fmt(c.policies.length)} politiques</div>
                {c.total != null && c.evaluated != null && c.evaluated < c.total && (c.stopped ? (
                  <div className="text-xs text-amber-600 pt-1">{fmt(c.evaluated)} politiques réévaluées cette nuit sur {fmt(c.total)} (limite de temps atteinte) : les autres affichent leur dernier résultat connu et passent en priorité la nuit prochaine.</div>
                ) : (
                  <div className="text-xs text-muted-foreground pt-1">Réévaluation hebdomadaire : {c.evaluated ? `${fmt(c.evaluated)} politiques réévaluées cette nuit sur ${fmt(c.total)}` : "aucune politique à réévaluer cette nuit"} ; les autres affichent leur résultat de moins de 7 jours.</div>
                ))}
                <div className="pt-1"><Delta value={trendOver(points, "complianceRate")} lowerIsBetter={false} unit=" pts" /></div>
              </div>
              <div className="lg:col-span-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Politique</TableHead>
                      <TableHead className="text-right">Actifs</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Entièrement conformes</TableHead>
                      <TableHead>Conformité</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.policies.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-[320px] py-1.5">
                          <div className="text-sm font-medium truncate" title={p.title}>{p.title}</div>
                          {p.stale && <div className="text-[11px] text-muted-foreground">résultat du {p.evaluatedAt ? new Date(p.evaluatedAt).toLocaleDateString("fr-FR") : "dernier calcul"}</div>}
                        </TableCell>
                        <TableCell className="text-right py-1.5">{fmt(p.hosts)}</TableCell>
                        <TableCell className="text-right py-1.5">{fmt(p.compliantHosts)}</TableCell>
                        <TableCell className="py-1.5"><SlaBar rate={p.rate} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {c?.collected && c.topFailed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" /> Top 5 des contrôles en échec
              <Help>Contrôles de sécurité en échec sur le plus grand nombre d&apos;actifs (ex. mots de passe par défaut, chiffrement des disques, SMBv1) : les chantiers de durcissement les plus rentables. Libellés d&apos;origine Qualys, en anglais.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrôle</TableHead>
                  <TableHead>Criticité</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actifs en échec</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Taux de réussite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.topFailed.map((x) => (
                  <TableRow key={x.cid}>
                    <TableCell className="max-w-[560px] py-1.5">
                      <div className="text-sm font-medium line-clamp-2" title={x.statement}>{x.statement}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">CID {x.cid}{x.policies > 1 ? ` · ${x.policies} politiques` : ""}</div>
                    </TableCell>
                    <TableCell className="py-1.5">{x.criticality ? <Badge tone={/urgent|critical/i.test(x.criticality) ? "red" : /serious|high/i.test(x.criticality) ? "orange" : "muted"}>{criticalityLabel(x.criticality)}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right font-semibold py-1.5">{fmt(x.failed)}</TableCell>
                    <TableCell className="text-right py-1.5">{x.rate === null ? "—" : `${fmt(x.rate)} %`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-[11px] text-muted-foreground">Conformité des environnements cloud (TotalCloud) : aucun environnement cloud n&apos;est raccordé à Qualys à ce jour.</p>
    </AxisSection>
  );
}

const PROBE_STYLE = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600", label: "Autorisé" },
  refused: { icon: XCircle, cls: "text-red-600", label: "Refusé" },
  unknown: { icon: HelpCircle, cls: "text-amber-600", label: "À vérifier" },
  error: { icon: AlertTriangle, cls: "text-amber-600", label: "Erreur" },
} as const;

function AccessDiagnostic() {
  const diag = useMutation({ mutationFn: () => callQualys<QualysDiagnostic>({ action: "diagnostic" }) });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" /> Accès aux modules Qualys
          <Help>Un petit appel en lecture seule par module, avec le compte configuré côté serveur. L&apos;API voit exactement ce que voit ce compte dans la console : « refusé » signifie que le module n&apos;est pas ouvert à ce compte, même s&apos;il figure dans la licence. Aucune donnée n&apos;est affichée, seulement le statut.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" size="sm" onClick={() => diag.mutate()} disabled={diag.isPending}>
          {diag.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} {diag.data ? "Relancer le diagnostic" : "Lancer le diagnostic"}
        </Button>
        {diag.isPending && <p className="text-xs text-muted-foreground">Un module à la fois, jusqu&apos;à une minute…</p>}
        {diag.error && <p className="text-sm text-destructive">{(diag.error as Error).message}</p>}
        {diag.data && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Sert à</TableHead>
                  <TableHead>Accès</TableHead>
                  <TableHead>Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diag.data.results.map((p) => {
                  const st = PROBE_STYLE[p.status];
                  return (
                    <TableRow key={p.module}>
                      <TableCell className="py-2"><div className="text-sm font-semibold">{p.module}</div><div className="text-[11px] text-muted-foreground">{p.label}</div></TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{p.purpose}</TableCell>
                      <TableCell className={`py-2 text-sm font-bold whitespace-nowrap ${st.cls}`}><st.icon className="w-4 h-4 inline mr-1 -mt-0.5" />{st.label}</TableCell>
                      <TableCell className="py-2 text-xs">{p.status === "ok" ? (p.count != null ? `${fmt(p.count)} éléments visibles` : "—") : p.detail}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-[11px] text-muted-foreground mt-2">Vérifié le {new Date(diag.data.checkedAt).toLocaleString("fr-FR")} · API {diag.data.apiBase} · Gateway {diag.data.gateway}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Évolution dans le temps
// ---------------------------------------------------------------------------

function History({ points }: { readonly points: QualysHistoryPoint[] }) {
  const [metric, setMetric] = useState<(typeof HISTORY_METRICS)[number]["key"]>("truriskAvg");
  const def = HISTORY_METRICS.find((m) => m.key === metric)!;
  const series = points.filter((p) => p[metric] !== null && p[metric] !== undefined).map((p) => ({ time: Date.parse(p.date), value: p[metric] as number }));
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
          <p className="text-sm text-muted-foreground py-6 text-center">La courbe apparaîtra après deux nuits de calcul. L&apos;historique démarre avec les premières photos : il ne remonte pas avant.</p>
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

// ---------------------------------------------------------------------------

export default function QualysPanel() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["qualys"],
    queryFn: () => callQualys<QualysState>(),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 60_000 : false),
  });
  const history = useQuery({ queryKey: ["qualys-history"], queryFn: () => callQualys<{ points: QualysHistoryPoint[] }>({ action: "history" }), staleTime: 60 * 60 * 1000, retry: false });
  const points = history.data?.points ?? [];
  const r = data?.latest ?? null;

  // Détail de la dernière photo : filtres appliqués à toute la page
  const details = useQuery({ queryKey: ["qualys-assets", r?.date ?? null], queryFn: () => callQualys<AssetsPayload>({ action: "assets" }), enabled: Boolean(r), staleTime: 30 * 60_000, retry: false });
  const [filters, setFilters] = useState<QFilters>({});
  const [assetOpen, setAssetOpen] = useState<{ host_id: number; name: string | null } | null>(null);
  const [vulnOpen, setVulnOpen] = useState<{ qid: number; title: string | null } | null>(null);
  const idx = useMemo(() => (details.data?.available ? indexCatalog(details.data.catalog) : null), [details.data]);
  const view = useMemo<DView | null>(() => {
    if (!details.data?.available || !idx || !details.data.assets.length) return null;
    const assets = filterAssets(details.data.assets, filters, idx);
    return { all: details.data.assets, assets, idx, sum: summarize(assets) };
  }, [details.data, idx, filters]);
  const openAsset = useCallback((hostId: number) => {
    const a = details.data?.assets.find((x) => x.host_id === hostId);
    setVulnOpen(null);
    setAssetOpen({ host_id: hostId, name: a?.name ?? a?.ip ?? null });
  }, [details.data]);
  const openVuln = useCallback((qid: number) => {
    setAssetOpen(null);
    setVulnOpen({ qid, title: idx?.byQid.get(qid)?.title ?? null });
  }, [idx]);
  const ctxValue = useMemo(() => ({ filters, setFilters, idx, openAsset, openVuln }), [filters, idx, openAsset, openVuln]);

  const header = (
    <div>
      <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-primary" /> Vulnérabilités — Qualys
      </h2>
      <p className="text-sm text-muted-foreground mt-1">Pilotage de la gestion des vulnérabilités : visibilité du parc, exposition aux menaces, efficacité de la remédiation et conformité. Sévérités 3 à 5.</p>
    </div>
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
        <AccessDiagnostic />
      </div>
    );
  }

  const e = r.exposure;
  const o = r.operations;
  const sum = view?.sum;
  const filtered = isFiltered(filters);
  const coverage = sum ? pct(sum.recent, sum.total) : pct(r.coverage.scanned, r.coverage.total);
  const mttr5 = o?.fixedCollected ? o.fixed.bySev["5"]?.mttr ?? null : null;
  const slaRate = o?.fixedCollected ? o.fixed.all.slaRate : null;
  const tierFilter = (t: TruTier[]) => setFilters((f) => ({ ...f, tier: JSON.stringify(f.tier) === JSON.stringify(t) ? undefined : t }));

  return (
    <QualysContext.Provider value={ctxValue}>
      <div className="space-y-6">
        {header}
        {banners}
        <p className="text-xs text-muted-foreground -mt-3">
          Photo du {new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
          {details.isLoading && <span className="ml-2 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> chargement du détail…</span>}
          {details.data && !details.data.available && <span className="ml-2">Détail par actif (inventaires, fiches, filtres) disponible après le prochain calcul de nuit.</span>}
          {details.error && <span className="ml-2 text-amber-600">Détail indisponible : {(details.error as Error).message}</span>}
          {r.details?.error && <span className="ml-2 text-amber-600">Détail partiel : {r.details.error}</span>}
        </p>

        {view && <FilterBar assets={view.all} shown={view.assets.length} />}

        {/* INDICATEURS CLÉS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className={view ? clickable(Boolean(filters.tier?.length)) : ""} onClick={view ? () => tierFilter(["critical", "high"]) : undefined} title={view ? "Cliquer pour filtrer sur les actifs à risque critique ou élevé" : undefined}>
            <Kpi title="Score de risque moyen (TruRisk)" icon={Gauge} color="border-l-red-500" value={sum?.truriskAvg != null ? fmt(sum.truriskAvg) : e?.truriskAvg != null ? fmt(e.truriskAvg) : "—"}
              help={<>Moyenne du score de risque Qualys (0 à 1 000) des actifs{filtered ? " de la sélection" : " du parc"} : la posture de risque globale. Doit baisser dans le temps.</>}
              sub={sum ? <><span>sur 1 000 · {fmt(sum.truriskN)} actifs</span> {!filtered && <Delta value={trendOver(points, "truriskAvg")} lowerIsBetter />}</> : e ? <><span>sur 1 000 · {fmt(e.truriskAssets)} actifs</span> <Delta value={trendOver(points, "truriskAvg")} lowerIsBetter /></> : "après le prochain calcul"} />
          </div>
          <div className={view ? clickable(filters.threat === "armed") : ""} onClick={view ? () => setFilters((f) => ({ ...f, threat: f.threat === "armed" ? undefined : "armed" })) : undefined} title={view ? "Cliquer pour filtrer sur ces actifs" : undefined}>
            {sum ? (
              <Kpi title="Actifs exposés à une vulnérabilité exploitable" icon={Flame} color="border-l-orange-500" value={fmt(sum.armedAssets)}
                help={<>Actifs portant au moins une vulnérabilité ouverte exploitée ou exploitable dès maintenant : CISA KEV, ransomware, attaques actives, exploit public.</>}
                sub={<span>{pct(sum.armedAssets, sum.total) ?? 0} % des actifs · dont {fmt(sum.kevAssets)} avec une vulnérabilité CISA KEV</span>} />
            ) : (
              <Kpi title="Vulnérabilités exploitables" icon={Flame} color="border-l-orange-500" value={e ? fmt(e.armed.detections) : fmt(r.kev.detections)}
                help={<>Vulnérabilités ouvertes exploitées ou exploitables dès maintenant : CISA KEV, ransomware, attaques actives, exploit public.</>}
                sub={e ? <><span>dont {fmt(e.armed.servers)} sur des serveurs</span> <Delta value={trendOver(points, "armed")} lowerIsBetter /></> : "CISA KEV seules (ancien calcul)"} />
            )}
          </div>
          <Kpi title="Respect des délais (SLA)" icon={CheckCircle2} color="border-l-emerald-500" value={slaRate === null ? "—" : `${fmt(slaRate)} %`}
            help={<>Part des vulnérabilités corrigées dans les délais de la politique de gestion des correctifs ({r.severities.map((x) => `${slaText(x)} pour les ${(SEVERITY_LABELS[x.severity] ?? "").toLowerCase()}`).join(", ")}), sur les {o?.windowDays ?? 90} derniers jours. Tout le parc (non filtré).</>}
            sub={o?.fixedCollected ? `sur ${fmt(o.fixed.all.fixed)} vulnérabilités corrigées en ${o.windowDays} j` : "après le prochain calcul"} />
          <Kpi title="MTTR – critiques" icon={Timer} color="border-l-sky-500" value={mttr5 === null ? "—" : `${fmt(mttr5)} j`}
            help={<>Délai moyen de correction (MTTR) des vulnérabilités critiques, de la détection à la correction. Délai fixé : 7 jours calendaires, une vulnérabilité critique étant traitée comme un incident de sécurité. Tout le parc (non filtré).</>}
            sub={mttr5 === null ? "après le prochain calcul" : <><span>délai moyen · cible 7 j</span> <Delta value={trendOver(points, "mttr5")} lowerIsBetter unit=" j" /></>} />
          <div className={view ? clickable(filters.scan === "stale" || filters.scan === "never") : ""} onClick={view ? () => setFilters((f) => ({ ...f, scan: f.scan === "stale" ? undefined : "stale" })) : undefined} title={view ? "Cliquer pour voir les actifs non analysés récemment" : undefined}>
            <Kpi title="Couverture des scans" icon={Radar} color="border-l-violet-500" value={coverage === null ? "—" : `${coverage} %`}
              help={<>Part des actifs analysés (agent ou scanner) dans les {r.coverage.recentDays} derniers jours.</>}
              sub={sum ? `${fmt(sum.recent)} actifs sur ${fmt(sum.total)} (${r.coverage.recentDays} derniers jours)` : `${fmt(r.coverage.scanned)} actifs sur ${fmt(r.coverage.total)} (${r.coverage.recentDays} derniers jours)`} />
          </div>
        </div>

        <VisibilityAxis r={r} d={view} />
        <ExposureAxis r={r} d={view} />
        <OperationsAxis r={r} d={view} />
        <ComplianceAxis r={r} points={points} />
        <WebAppsAxis r={r} detail={Boolean(view)} />
        <AxisSection id="history" n="Suivi" title="Évolution et accès" subtitle="Courbes nuit après nuit et diagnostic des accès aux modules Qualys.">
          <History points={points} />
          <AccessDiagnostic />
        </AxisSection>
      </div>
      <AssetSheet asset={assetOpen} onClose={() => setAssetOpen(null)} />
      <VulnSheet vuln={vulnOpen} onClose={() => setVulnOpen(null)} />
    </QualysContext.Provider>
  );
}
