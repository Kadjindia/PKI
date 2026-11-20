import { useState } from "react";
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

// Vulnérabilités Qualys VMDR, organisées par axes de gouvernance :
//   1. Visibilité (socle)  2. Exposition aux menaces  3. Efficacité opérationnelle.
// Photo calculée chaque nuit côté serveur (qualys-proxy) ; l'écran lit la dernière photo.

async function callQualys<T>(body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("qualys-proxy", { body });
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

/** Titre d'un axe de gouvernance. */
function Axis({ n, title, subtitle }: { readonly n: number; readonly title: string; readonly subtitle: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-2 border-t border-border">
      <span className="text-xs font-black text-primary-foreground bg-primary rounded px-2 py-0.5">AXE {n}</span>
      <div>
        <h3 className="text-lg font-black text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
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
      {v.patchable && <Badge tone="muted">Correctif dispo.</Badge>}
    </span>
  );
}

const flagsToBadges = (flags: number) => ({
  kev: Boolean(flags & FLAGS.kev), ransomware: Boolean(flags & FLAGS.ransomware), activeAttacks: Boolean(flags & FLAGS.activeAttacks),
  exploitPublic: Boolean(flags & FLAGS.exploitPublic), patchable: Boolean(flags & FLAGS.patchable),
});

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
  const [q, setQ] = useState("");
  const search = useMutation({ mutationFn: (query: string) => callQualys<QualysSearch>({ action: "search", q: query }) });
  const r = search.data;
  const progress = r ? remediationProgress(r.trend) : null;
  const series = (r?.trend ?? []).map((t) => ({ time: Date.parse(t.date), value: t.hosts }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-red-500" /> Exposition à une faille du moment
          <Help>Quand une faille fait l&apos;actualité (ex. Log4Shell), saisissez sa référence CVE, son QID Qualys ou un mot de son titre : nombre d&apos;actifs touchés d&apos;après la dernière photo, et évolution nuit après nuit pour suivre la correction. Vulnérabilités de sévérités 3 à 5.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) search.mutate(q.trim()); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE-2021-44228, QID ou mot du titre (ex. Log4j)" maxLength={100} />
          <Button type="submit" disabled={q.trim().length < 3 || search.isPending}>
            {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Rechercher
          </Button>
        </form>
        {search.error && <p className="text-sm text-destructive">{(search.error as Error).message}</p>}
        {r && (r.matches.length === 0 ? (
          <p className="text-sm text-emerald-600 font-semibold">Aucun actif touché par « {r.query} » dans la dernière photo{r.date ? ` (${new Date(r.date).toLocaleDateString("fr-FR")})` : ""}.</p>
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
                <div className="text-[11px] text-muted-foreground">{progress && progress.peak ? `pic à ${fmt(progress.peak)} actifs touchés` : "après plusieurs nuits de calcul"}</div>
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
                    <TableHead className="text-center">Sév.</TableHead>
                    <TableHead className="text-right">Actifs</TableHead>
                    <TableHead className="text-right">Serveurs</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                    <TableHead>Signaux</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.matches.map((m) => (
                    <TableRow key={m.qid}>
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

function ExposureAxis({ r }: { readonly r: QualysResults }) {
  const e = r.exposure;
  return (
    <div className="space-y-4">
      <Axis n={2} title="Exposition aux menaces" subtitle="Ce qui menace l'entreprise aujourd'hui, plutôt que le volume total de vulnérabilités." />
      {!e ? <Card><CardContent><Pending /></CardContent></Card> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* VULNÉRABILITÉS ARMÉES */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Vulnérabilités armées
                <Help>Vulnérabilités ouvertes (sévérités 3 à 5) qu&apos;un attaquant peut utiliser dès maintenant : catalogue CISA KEV (exploitées activement), liées à des rançongiciels, attaques en cours constatées par Qualys, ou exploit public disponible.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[["CISA KEV", r.kev.detections], ["Ransomware", r.ransomware.detections], ["Attaques actives", r.activeAttacks.detections], ["Exploit public", e.armed.exploitPublic]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <div className="text-lg font-black">{fmt(Number(v))}</div>
                    <div className="text-[10px] text-muted-foreground font-semibold">{l}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">Une vulnérabilité peut porter plusieurs signaux : le total armé ({fmt(e.armed.detections)}) n&apos;est pas la somme des cases.</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Les plus répandues</TableHead>
                    <TableHead className="text-right">Actifs</TableHead>
                    <TableHead className="text-right">Serveurs</TableHead>
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

          {/* ACTIFS LES PLUS RISQUÉS */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" /> Top 10 des actifs les plus risqués
                <Help>Actifs au score TruRisk le plus élevé (0 à 1 000), qui combine leurs vulnérabilités et leur criticité. Le type (serveur, poste) est déduit du système d&apos;exploitation détecté par Qualys. La criticité métier n&apos;apparaît que si elle est renseignée dans Qualys.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Actif</TableHead>
                      <TableHead className="text-right">TruRisk</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Crit./Élev./Mod.</TableHead>
                      <TableHead className="text-right">Armées</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.topRisk.map((h, i) => (
                      <TableRow key={h.id ?? i}>
                        <TableCell className="max-w-[240px] py-1.5">
                          <div className="text-sm font-medium truncate" title={h.name ?? ""}>{h.name ?? h.ip ?? "—"}</div>
                          <div className="text-[11px] text-muted-foreground truncate"><Badge tone={TYPE_TONE[h.type]}>{ASSET_TYPE_LABELS[h.type]}</Badge> {h.os}{h.criticality ? ` · criticité ${h.criticality}/5` : ""}</div>
                        </TableCell>
                        <TableCell className={`text-right font-black py-1.5 ${h.trurisk >= 850 ? "text-red-600" : h.trurisk >= 700 ? "text-orange-600" : ""}`}>{fmt(h.trurisk)}</TableCell>
                        <TableCell className="text-right py-1.5 whitespace-nowrap">{h.d5 === null ? "—" : `${fmt(h.d5)} / ${fmt(h.d4)}${h.d3 != null ? ` / ${fmt(h.d3)}` : ""}`}</TableCell>
                        <TableCell className="text-right py-1.5">{fmt(h.armed)}</TableCell>
                        <TableCell className={`text-right py-1.5 ${h.overdue ? "text-red-600" : "text-muted-foreground"}`}>{fmt(h.overdue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      <ExposureSearch />
    </div>
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

function OperationsAxis({ r }: { readonly r: QualysResults }) {
  const o = r.operations;
  const sevTotal = r.severities.reduce((t, s) => t + s.total, 0);
  return (
    <div className="space-y-4">
      <Axis n={3} title="Efficacité opérationnelle" subtitle="Le maintien en conditions de sécurité : les vulnérabilités sont-elles corrigées dans les délais fixés par la PSSI ?" />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> Respect des délais et temps moyen de correction (MTTR)
            <Help>Vulnérabilités de sévérités 3 à 5 corrigées au cours des {o?.windowDays ?? 90} derniers jours. Délai de correction : de la première détection à la correction constatée par Qualys. Délais de la politique de gestion des correctifs : {r.severities.map((s) => `${slaText(s)} pour la sévérité ${s.severity}`).join(", ")} (mois calendaires, à date anniversaire). Une vulnérabilité critique est traitée comme un incident de sécurité. La ventilation par équipe s&apos;appuie sur le type d&apos;actif (serveurs : équipes d&apos;infrastructure ; postes : poste de travail), faute de tags fiables.</Help>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!o?.fixedCollected ? <Pending /> : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead className="text-right">Corrigées</TableHead>
                      <TableHead>Dans les délais</TableHead>
                      <TableHead className="text-right">MTTR</TableHead>
                      <TableHead className="text-right">Médiane</TableHead>
                      <TableHead className="text-right">Cible</TableHead>
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
                  <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">Mois après mois (MTTR : doit baisser au fil de l&apos;année)
                    <Help>Vulnérabilités corrigées chaque mois. Le premier mois est coupé par la fenêtre de {o.windowDays} jours (« partiel ») : il ne compte que ses derniers jours, et ses chiffres ne sont pas comparables. Le mois en cours n&apos;est pas terminé.</Help>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {o.fixed.monthly.map((m) => (
                      <div key={m.month} className="rounded-lg border border-border px-3 py-2 text-xs">
                        <div className="font-bold"><span className="capitalize">{formatMonth(m.month)}</span>{m.partial && <span className="ml-1.5"><Badge tone="muted">{m.partial === "start" ? "partiel" : "en cours"}</Badge></span>}</div>
                        <div className="text-muted-foreground">{fmt(m.fixed)} corrigées · {m.slaRate === null ? "—" : `${fmt(m.slaRate)} %`} dans les délais</div>
                        <div>MTTR critiques <b>{m.mttr5 === null ? "—" : `${fmt(m.mttr5)} j`}</b> · élevées <b>{m.mttr4 === null ? "—" : `${fmt(m.mttr4)} j`}</b>{m.mttr3 != null && <> · modérées <b>{fmt(m.mttr3)} j</b></>}</div>
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
              <Hourglass className="w-4 h-4 text-amber-500" /> Âge du backlog
              <Help>Vulnérabilités de sévérités 3 à 5 encore ouvertes, par ancienneté depuis leur première détection. Un backlog qui vieillit (au-delà de 180 jours) signale une dette qui s&apos;accumule.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {r.severities.map((s) => (
              <div key={s.severity} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-foreground">{SEVERITY_LABELS[s.severity]} · {fmt(s.total)} ouvertes{s.avgAge != null ? ` · âge moyen ${fmt(s.avgAge)} j` : ""}</span>
                  <span className="text-xs text-muted-foreground">
                    délai cible {slaText(s)} · <b className={s.overdue ? "text-red-600" : "text-emerald-600"}>{fmt(s.overdue)} hors délai ({pct(s.overdue, s.total) ?? 0} %)</b>
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
                <Help>Part des vulnérabilités ouvertes qui avaient été corrigées puis sont réapparues au scan suivant : signe d&apos;un problème de masterisation ou d&apos;un retour arrière sur des serveurs.</Help>
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
                <Help>Vulnérabilités de sévérités 3 à 5 marquées « ignorées » dans Qualys (risque accepté, exception de correctif). Elles sont exclues des autres chiffres. Leur ancienneté montre si des exceptions durent indéfiniment. Les dates d&apos;échéance des exceptions ne sont pas lisibles par l&apos;API.</Help>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Axe 1 : visibilité (partiel, en attendant CSAM) et diagnostic des accès
// ---------------------------------------------------------------------------

function VisibilityAxis({ r }: { readonly r: QualysResults }) {
  const trTotal = Math.max(1, r.coverage.trurisk.critical + r.coverage.trurisk.high + r.coverage.trurisk.medium + r.coverage.trurisk.low);
  const byType = r.coverage.byType;
  return (
    <div className="space-y-4">
      <Axis n={1} title="Visibilité du parc" subtitle="Le socle : un actif que Qualys n'analyse pas est un angle mort." />
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <dl className="space-y-1.5">
            {[
              ["Actifs suivis par Qualys", fmt(r.coverage.total)],
              ["Équipés de l'agent", `${fmt(r.coverage.agent)} (${pct(r.coverage.agent, r.coverage.total) ?? 0} %)`],
              [`Analysés depuis moins de ${r.coverage.recentDays} j`, `${fmt(r.coverage.scanned)} (${pct(r.coverage.scanned, r.coverage.total) ?? 0} %)`],
              ["Jamais analysés", fmt(r.coverage.neverScanned)],
              ...(byType ? (["server", "workstation"] as const).map((t) => [`${ASSET_TYPE_LABELS[t]} analysés`, `${fmt(byType[t].scanned)} sur ${fmt(byType[t].total)} (${pct(byType[t].scanned, byType[t].total) ?? 0} %)`]) : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="space-y-1.5">
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
            <p className="text-[11px] text-muted-foreground pt-2">Inventaire complet face à la CMDB et Shadow IT : nécessitent le module CSAM, non ouvert au compte configuré (voir le diagnostic des accès en bas de page).</p>
          </div>
        </CardContent>
      </Card>
      <ObsolescenceCard r={r} />
    </div>
  );
}

function ObsolescenceCard({ r }: { readonly r: QualysResults }) {
  const o = r.obsolescence;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Archive className="w-4 h-4 text-amber-600" /> Dette technique : systèmes et logiciels en fin de vie
          <Help>Systèmes d&apos;exploitation et logiciels qui ne reçoivent plus de correctifs de sécurité de leur éditeur, repérés par Qualys VMDR (vulnérabilités « EOL/Obsolete », sévérités 3 à 5). En attendant l&apos;accès au module CSAM, qui donnerait la liste complète avec les dates de fin de support.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!o ? <Pending /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-3xl font-black">{o.hostsTracked ? fmt(o.hosts) : "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {o.hostsTracked ? <>actifs concernés, soit {pct(o.hosts, r.coverage.total) ?? 0} % du parc</> : "actifs concernés : dès la prochaine nuit (la liste des produits en fin de vie est apprise d'une nuit sur l'autre)"}
                </div>
              </div>
              {o.hostsTracked && (
                <dl className="space-y-1 text-xs">
                  {(["server", "workstation", "other"] as const).map((t) => (
                    <div key={t} className="flex justify-between gap-2"><dt className="text-muted-foreground">{ASSET_TYPE_LABELS[t]}</dt><dd className="font-semibold">{fmt(o.byType[t])}</dd></div>
                  ))}
                </dl>
              )}
              <div className="text-xs text-muted-foreground border-t border-border pt-2">{fmt(o.products)} produits en fin de vie, dont {fmt(o.osProducts)} systèmes d&apos;exploitation</div>
            </div>
            <div className="lg:col-span-2 overflow-x-auto">
              {o.top.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-4">Aucun produit en fin de vie détecté.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit en fin de vie</TableHead>
                      <TableHead className="text-right">Actifs</TableHead>
                      <TableHead className="text-right">Serveurs</TableHead>
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
// Axe 4 : conformité et durcissement (Policy Audit)
// ---------------------------------------------------------------------------

function ComplianceAxis({ r, points }: { readonly r: QualysResults; readonly points: QualysHistoryPoint[] }) {
  const c = r.compliance;
  return (
    <div className="space-y-4">
      <Axis n={4} title="Conformité et durcissement" subtitle="Le respect des référentiels de configuration que l'on s'est fixés (CIS, ANSSI…), mesuré par Qualys Policy Audit." />
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
                  <span className="flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4" /> Taux de conformité global</span>
                  <Help>Part des contrôles réussis parmi les contrôles évalués (réussis et échoués), toutes politiques et tous actifs confondus. Les contrôles en erreur (non évaluables) sont exclus.</Help>
                </div>
                <div className="text-4xl font-black">{c.rate === null ? "—" : `${fmt(c.rate)} %`}</div>
                <div className="text-xs text-muted-foreground">{fmt(c.passed)} contrôles réussis · {fmt(c.failed)} échoués · {fmt(c.policies.length)} politiques</div>
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
                        <TableCell className="max-w-[320px] py-1.5"><div className="text-sm font-medium truncate" title={p.title}>{p.title}</div></TableCell>
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
              <XCircle className="w-4 h-4 text-red-500" /> Top 5 des contrôles qui échouent le plus
              <Help>Contrôles de sécurité en échec sur le plus grand nombre d&apos;actifs (ex. mots de passe par défaut, chiffrement des disques, partages SMB ouverts) : les chantiers de durcissement les plus rentables.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrôle</TableHead>
                  <TableHead>Criticité</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Échecs</TableHead>
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
                    <TableCell className="py-1.5">{x.criticality ? <Badge tone={/urgent|critical/i.test(x.criticality) ? "red" : /serious|high/i.test(x.criticality) ? "orange" : "muted"}>{x.criticality}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right font-semibold py-1.5">{fmt(x.failed)}</TableCell>
                    <TableCell className="text-right py-1.5">{x.rate === null ? "—" : `${fmt(x.rate)} %`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-[11px] text-muted-foreground">Conformité des environnements cloud (TotalCloud) : module non ouvert au compte configuré.</p>
    </div>
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

  const header = (
    <div>
      <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-primary" /> Vulnérabilités — Qualys
      </h2>
      <p className="text-sm text-muted-foreground mt-1">Pilotage de la gestion des vulnérabilités : visibilité du parc, exposition aux menaces et efficacité de la correction. Sévérités 3 à 5.</p>
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
  const coverage = pct(r.coverage.scanned, r.coverage.total);
  const mttr5 = o?.fixedCollected ? o.fixed.bySev["5"]?.mttr ?? null : null;
  const slaRate = o?.fixedCollected ? o.fixed.all.slaRate : null;

  return (
    <div className="space-y-6">
      {header}
      {banners}
      <p className="text-xs text-muted-foreground -mt-3">Photo du {new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.</p>

      {/* INDICATEURS CLÉS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi title="TruRisk moyen" icon={Gauge} color="border-l-red-500" value={e?.truriskAvg != null ? fmt(e.truriskAvg) : "—"}
          help={<>Moyenne du score de risque Qualys (0 à 1 000) des actifs du parc : la posture de risque globale. Doit baisser dans le temps.</>}
          sub={e ? <><span>sur {fmt(e.truriskAssets)} actifs</span> <Delta value={trendOver(points, "truriskAvg")} lowerIsBetter /></> : "après le prochain calcul"} />
        <Kpi title="Vulnérabilités armées" icon={Flame} color="border-l-orange-500" value={e ? fmt(e.armed.detections) : fmt(r.kev.detections)}
          help={<>Vulnérabilités ouvertes exploitées ou exploitables dès maintenant : CISA KEV, rançongiciels, attaques actives, exploit public.</>}
          sub={e ? <><span>dont {fmt(e.armed.servers)} sur des serveurs</span> <Delta value={trendOver(points, "armed")} lowerIsBetter /></> : "CISA KEV seules (photo ancienne)"} />
        <Kpi title="Respect des délais" icon={CheckCircle2} color="border-l-emerald-500" value={slaRate === null ? "—" : `${fmt(slaRate)} %`}
          help={<>Part des vulnérabilités corrigées dans les délais de la politique de gestion des correctifs ({r.severities.map((s) => `${slaText(s)} pour la sévérité ${s.severity}`).join(", ")}), sur les {o?.windowDays ?? 90} derniers jours.</>}
          sub={o?.fixedCollected ? `${fmt(o.fixed.all.fixed)} corrigées en ${o.windowDays} j` : "après le prochain calcul"} />
        <Kpi title="MTTR critiques" icon={Timer} color="border-l-sky-500" value={mttr5 === null ? "—" : `${fmt(mttr5)} j`}
          help={<>Temps moyen de correction des vulnérabilités critiques (sévérité 5), de la détection à la correction. Cible : 7 jours calendaires (une vulnérabilité critique est traitée comme un incident de sécurité).</>}
          sub={mttr5 === null ? "après le prochain calcul" : <><span>cible 7 j</span> <Delta value={trendOver(points, "mttr5")} lowerIsBetter unit=" j" /></>} />
        <Kpi title="Couverture des scans" icon={Radar} color="border-l-violet-500" value={coverage === null ? "—" : `${coverage} %`}
          help={<>Part des actifs analysés (agent ou scanner) dans les {r.coverage.recentDays} derniers jours.</>}
          sub={`${fmt(r.coverage.scanned)} actifs sur ${fmt(r.coverage.total)}`} />
      </div>

      <VisibilityAxis r={r} />
      <ExposureAxis r={r} />
      <OperationsAxis r={r} />
      <ComplianceAxis r={r} points={points} />
      <History points={points} />
      <AccessDiagnostic />
    </div>
  );
}
