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
      {v.kev && <Badge tone="red">Déjà exploitée</Badge>}
      {v.ransomware && <Badge tone="violet">Rançongiciel</Badge>}
      {v.activeAttacks && !v.kev && <Badge tone="orange">Attaques en cours</Badge>}
      {v.exploitPublic && !v.kev && !v.activeAttacks && <Badge tone="orange">Méthode d&apos;attaque publiée</Badge>}
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
  const [q, setQ] = useState("");
  const search = useMutation({ mutationFn: (query: string) => callQualys<QualysSearch>({ action: "search", q: query }) });
  const r = search.data;
  const progress = r ? remediationProgress(r.trend) : null;
  const series = (r?.trend ?? []).map((t) => ({ time: Date.parse(t.date), value: t.hosts }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-red-500" /> Sommes-nous touchés par une faille de l&apos;actualité ?
          <Help>Quand une faille fait l&apos;actualité (ex. Log4Shell), saisissez sa référence (CVE, ou QID chez Qualys) ou son nom : nombre de machines touchées d&apos;après le calcul de la nuit, et évolution nuit après nuit pour suivre la correction. Failles critiques, élevées et modérées.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) search.mutate(q.trim()); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou référence de la faille (ex. Log4j ou CVE-2021-44228)" maxLength={100} />
          <Button type="submit" disabled={q.trim().length < 3 || search.isPending}>
            {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Rechercher
          </Button>
        </form>
        {search.error && <p className="text-sm text-destructive">{(search.error as Error).message}</p>}
        {r && (r.matches.length === 0 ? (
          <p className="text-sm text-emerald-600 font-semibold">Aucune machine touchée par « {r.query} » d&apos;après le dernier calcul{r.date ? ` (${new Date(r.date).toLocaleDateString("fr-FR")})` : ""}.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">Machines touchées aujourd&apos;hui</div>
                <div className="text-2xl font-black">{fmt(r.matches.reduce((t, m) => t + m.hosts, 0))}</div>
                <div className="text-[11px] text-muted-foreground">dont {fmt(r.matches.reduce((t, m) => t + m.servers, 0))} sur des serveurs</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">Avancement de la correction</div>
                <div className="text-2xl font-black">{progress?.pct === null || !progress ? "—" : `${progress.pct} %`}</div>
                <div className="text-[11px] text-muted-foreground">{progress && progress.peak ? `jusqu'à ${fmt(progress.peak)} machines touchées` : "après plusieurs nuits de calcul"}</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2 h-[86px]">
                {series.length < 2 ? <div className="text-[11px] text-muted-foreground pt-6 text-center">La courbe apparaîtra après deux nuits.</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={formatDay} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <RechartsTooltip {...TOOLTIP_STYLE} labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("fr-FR")} formatter={(v) => [fmt(Number(v)), "Machines touchées"]} />
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
                    <TableHead>Faille</TableHead>
                    <TableHead className="text-center">Gravité</TableHead>
                    <TableHead className="text-right">Machines</TableHead>
                    <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
                    <TableHead className="text-right whitespace-nowrap">En retard</TableHead>
                    <TableHead>Particularités</TableHead>
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
      <Axis n={2} title="Exposition aux menaces" subtitle="Les failles qui menacent vraiment l'entreprise aujourd'hui, plutôt que leur nombre total." />
      {!e ? <Card><CardContent><Pending /></CardContent></Card> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* VULNÉRABILITÉS ARMÉES */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Failles exploitables par un attaquant
                <Help>Failles non corrigées qu&apos;un attaquant peut utiliser dès maintenant : déjà exploitées par des attaquants (catalogue officiel américain CISA KEV), utilisées par des rançongiciels, attaques en cours constatées par Qualys, ou méthode d&apos;attaque publiée sur Internet (« exploit public »).</Help>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[["Déjà exploitées", r.kev.detections], ["Rançongiciels", r.ransomware.detections], ["Attaques en cours", r.activeAttacks.detections], ["Attaque publiée", e.armed.exploitPublic]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <div className="text-lg font-black">{fmt(Number(v))}</div>
                    <div className="text-[10px] text-muted-foreground font-semibold">{l}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">Une faille peut entrer dans plusieurs cases : le total ({fmt(e.armed.detections)}) n&apos;est pas leur somme.</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Les plus répandues</TableHead>
                    <TableHead className="text-right">Machines</TableHead>
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

          {/* ACTIFS LES PLUS RISQUÉS */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" /> Les 10 machines les plus à risque
                <Help>Machines au niveau de risque le plus élevé, selon le score calculé par Qualys (TruRisk, de 0 à 1 000), qui combine leurs failles et leur importance. Le type (serveur, poste) est déduit du système détecté par Qualys. L&apos;importance pour le métier n&apos;apparaît que si elle est renseignée dans Qualys.</Help>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Risque /1000</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Failles crit. / élev. / mod.</TableHead>
                      <TableHead className="text-right">Exploitables</TableHead>
                      <TableHead className="text-right whitespace-nowrap">En retard</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.topRisk.map((h, i) => (
                      <TableRow key={h.id ?? i}>
                        <TableCell className="max-w-[240px] py-1.5">
                          <div className="text-sm font-medium truncate" title={h.name ?? ""}>{h.name ?? h.ip ?? "—"}</div>
                          <div className="text-[11px] text-muted-foreground truncate"><Badge tone={TYPE_TONE[h.type]}>{ASSET_TYPE_LABELS[h.type]}</Badge> {h.os}{h.criticality ? ` · importance ${h.criticality}/5` : ""}</div>
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
      <Axis n={3} title="Rapidité de correction" subtitle="Les failles sont-elles corrigées dans les délais fixés par notre politique de gestion des correctifs ?" />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> Failles corrigées dans les délais et temps de correction
            <Help>Failles corrigées au cours des {o?.windowDays ?? 90} derniers jours. Temps de correction : du jour où Qualys a détecté la faille au jour où il l&apos;a vue corrigée. Délais de notre politique : {r.severities.map((s) => `${slaText(s)} pour une faille ${(SEVERITY_LABELS[s.severity] ?? "").toLowerCase()}`).join(", ")} (mois calendaires). Une faille critique est traitée comme un incident de sécurité. « Temps moyen » : la moyenne (appelée MTTR) ; « temps médian » : la moitié des failles sont corrigées plus vite. Serveurs et postes de travail correspondent en général à deux équipes différentes.</Help>
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
                  <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">Mois après mois (le temps de correction doit baisser au fil de l&apos;année)
                    <Help>Failles corrigées chaque mois. Le premier mois est coupé par la fenêtre de {o.windowDays} jours (« partiel ») : il ne compte que ses derniers jours, et ses chiffres ne sont pas comparables. Le mois en cours n&apos;est pas terminé.</Help>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {o.fixed.monthly.map((m) => (
                      <div key={m.month} className="rounded-lg border border-border px-3 py-2 text-xs">
                        <div className="font-bold"><span className="capitalize">{formatMonth(m.month)}</span>{m.partial && <span className="ml-1.5"><Badge tone="muted">{m.partial === "start" ? "partiel" : "en cours"}</Badge></span>}</div>
                        <div className="text-muted-foreground">{fmt(m.fixed)} corrigées · {m.slaRate === null ? "—" : `${fmt(m.slaRate)} %`} dans les délais</div>
                        <div>Temps moyen : critiques <b>{m.mttr5 === null ? "—" : `${fmt(m.mttr5)} j`}</b> · élevées <b>{m.mttr4 === null ? "—" : `${fmt(m.mttr4)} j`}</b>{m.mttr3 != null && <> · modérées <b>{fmt(m.mttr3)} j</b></>}</div>
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
              <Hourglass className="w-4 h-4 text-amber-500" /> Failles en attente de correction, par ancienneté
              <Help>Failles pas encore corrigées, classées selon le temps écoulé depuis leur détection. Si une part croissante dépasse 180 jours, le retard s&apos;accumule.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {r.severities.map((s) => (
              <div key={s.severity} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-foreground">{SEVERITY_LABELS[s.severity]} · {fmt(s.total)} à corriger{s.avgAge != null ? ` · en attente depuis ${fmt(s.avgAge)} j en moyenne` : ""}</span>
                  <span className="text-xs text-muted-foreground">
                    délai fixé {slaText(s)} · <b className={s.overdue ? "text-red-600" : "text-emerald-600"}>{fmt(s.overdue)} en retard ({pct(s.overdue, s.total) ?? 0} %)</b>
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
                    <div className="text-muted-foreground">{fmt(o.open.byType[t].total)} à corriger · <span className={o.open.byType[t].overdue ? "text-red-600" : ""}>{pct(o.open.byType[t].overdue, o.open.byType[t].total) ?? 0} % en retard</span></div>
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
                <span className="flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> Failles réapparues</span>
                <Help>Part des failles à corriger qui avaient déjà été corrigées, puis sont revenues : souvent une machine réinstallée à partir d&apos;une image ancienne, ou une mise à jour annulée.</Help>
              </div>
              <div className="text-2xl font-black">{o?.reopenRate != null ? `${fmt(o.reopenRate)} %` : `${pct(r.severities.reduce((t, s) => t + s.reopened, 0), sevTotal) ?? 0} %`}</div>
              <div className="text-xs text-muted-foreground">{fmt(r.severities.reduce((t, s) => t + s.reopened, 0))} failles revenues après correction</div>
            </CardContent>
          </Card>
          {/* DÉROGATIONS */}
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-start justify-between gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5"><FileWarning className="w-4 h-4" /> Exceptions accordées</span>
                <Help>Failles que l&apos;on a décidé de ne pas corriger pour l&apos;instant (risque accepté), marquées « ignorées » dans Qualys. Elles sont retirées des autres chiffres. Leur ancienneté montre si des exceptions durent trop longtemps. Les dates de fin des exceptions ne sont pas disponibles.</Help>
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
      <Axis n={1} title="Connaissance du parc" subtitle="Le socle : une machine que Qualys n'analyse pas est un angle mort." />
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <dl className="space-y-1.5">
            {[
              ["Machines connues de Qualys", fmt(r.coverage.total)],
              ["Équipées de l'agent Qualys", `${fmt(r.coverage.agent)} (${pct(r.coverage.agent, r.coverage.total) ?? 0} %)`],
              [`Analysées depuis moins de ${r.coverage.recentDays} jours`, `${fmt(r.coverage.scanned)} (${pct(r.coverage.scanned, r.coverage.total) ?? 0} %)`],
              ["Jamais analysées", fmt(r.coverage.neverScanned)],
              ...(byType ? (["server", "workstation"] as const).map((t) => [`${ASSET_TYPE_LABELS[t]} analysés récemment`, `${fmt(byType[t].scanned)} sur ${fmt(byType[t].total)} (${pct(byType[t].scanned, byType[t].total) ?? 0} %)`]) : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>Niveau de risque des machines</span>
              <Help>Score de risque calculé par Qualys pour chaque machine (TruRisk, de 0 à 1 000), qui combine ses failles et son importance. Critique : 850 et plus ; élevé : 700 à 849 ; moyen : 500 à 699.</Help>
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
            <p className="text-[11px] text-muted-foreground pt-2">Comparaison avec l&apos;inventaire officiel (CMDB) et repérage des machines inconnues : nécessitent un module Qualys (CSAM) non ouvert à notre compte (voir « Accès aux données Qualys » en bas de page).</p>
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
          <Archive className="w-4 h-4 text-amber-600" /> Systèmes et logiciels obsolètes (plus mis à jour par leur éditeur)
          <Help>Systèmes et logiciels dont l&apos;éditeur ne publie plus de correctifs de sécurité : leurs failles ne seront jamais corrigées. Repérés par Qualys (failles intitulées « EOL/Obsolete »). Le module CSAM, non ouvert à notre compte, donnerait la liste complète avec les dates de fin de support.</Help>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!o ? <Pending /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-3xl font-black">{o.hostsTracked ? fmt(o.hosts) : "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {o.hostsTracked ? <>machines concernées, soit {pct(o.hosts, r.coverage.total) ?? 0} % du parc</> : "machines concernées : dès la prochaine nuit (la liste des produits obsolètes est apprise d'une nuit sur l'autre)"}
                </div>
              </div>
              {o.hostsTracked && (
                <dl className="space-y-1 text-xs">
                  {(["server", "workstation", "other"] as const).map((t) => (
                    <div key={t} className="flex justify-between gap-2"><dt className="text-muted-foreground">{ASSET_TYPE_LABELS[t]}</dt><dd className="font-semibold">{fmt(o.byType[t])}</dd></div>
                  ))}
                </dl>
              )}
              <div className="text-xs text-muted-foreground border-t border-border pt-2">{fmt(o.products)} produits obsolètes, dont {fmt(o.osProducts)} systèmes d&apos;exploitation</div>
            </div>
            <div className="lg:col-span-2 overflow-x-auto">
              {o.top.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-4">Aucun produit obsolète détecté.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit obsolète</TableHead>
                      <TableHead className="text-right">Machines</TableHead>
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
// Axe 4 : conformité et durcissement (Policy Audit)
// ---------------------------------------------------------------------------

function ComplianceAxis({ r, points }: { readonly r: QualysResults; readonly points: QualysHistoryPoint[] }) {
  const c = r.compliance;
  return (
    <div className="space-y-4">
      <Axis n={4} title="Règles de configuration" subtitle="Les machines sont-elles configurées selon les règles de sécurité que l'on s'est fixées (CIS, ANSSI…) ?" />
      <Card>
        <CardContent className="p-4">
          {!c?.collected ? <Pending /> : c.error && c.policies.length === 0 ? (
            <div className="space-y-1.5 py-1">
              <p className="text-sm text-amber-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Conformité non disponible : {c.error}</p>
              {/license is not authorized|code 2012/i.test(c.error) && (
                <p className="text-xs text-muted-foreground">La licence Qualys n&apos;autorise pas l&apos;accès automatique au détail des règles respectées par machine (la liste des politiques, elle, est accessible). C&apos;est une limite de l&apos;abonnement, pas des droits du compte : à voir avec l&apos;administrateur Qualys ou l&apos;interlocuteur commercial (option d&apos;accès API de Policy Audit).</p>
              )}
            </div>
          ) : c.policies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Aucun référentiel de règles évalué dans Qualys.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4" /> Règles respectées</span>
                  <Help>Part des règles de configuration respectées, sur toutes les machines et tous les référentiels vérifiés par Qualys (module Policy Audit). Les règles qui n&apos;ont pas pu être vérifiées ne sont pas comptées.</Help>
                </div>
                <div className="text-4xl font-black">{c.rate === null ? "—" : `${fmt(c.rate)} %`}</div>
                <div className="text-xs text-muted-foreground">{fmt(c.passed)} vérifications réussies · {fmt(c.failed)} en échec · {fmt(c.policies.length)} référentiels</div>
                <div className="pt-1"><Delta value={trendOver(points, "complianceRate")} lowerIsBetter={false} unit=" pts" /></div>
              </div>
              <div className="lg:col-span-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Référentiel</TableHead>
                      <TableHead className="text-right">Machines</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Sans aucun écart</TableHead>
                      <TableHead>Règles respectées</TableHead>
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
              <XCircle className="w-4 h-4 text-red-500" /> Les 5 règles les moins respectées
              <Help>Règles de sécurité non respectées sur le plus grand nombre de machines (ex. mots de passe par défaut, disques non chiffrés, anciens protocoles de partage) : les chantiers les plus rentables. Libellés d&apos;origine Qualys, en anglais.</Help>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Règle</TableHead>
                  <TableHead>Importance</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Machines en écart</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Respectée sur</TableHead>
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
      <p className="text-[11px] text-muted-foreground">Règles de configuration des environnements cloud : nécessitent un module Qualys (TotalCloud) non ouvert à notre compte.</p>
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
          <KeyRound className="w-4 h-4 text-primary" /> Accès aux données Qualys
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
                  <TableHead>Utile pour</TableHead>
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
        <ShieldAlert className="w-7 h-7 text-primary" /> Failles de sécurité — Qualys
      </h2>
      <p className="text-sm text-muted-foreground mt-1">Suivi des failles de sécurité : connaissance du parc, menaces, rapidité de correction et règles de configuration. Failles critiques, élevées et modérées.</p>
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
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Les failles n&apos;ont pas encore été calculées : elles le seront automatiquement la nuit prochaine.</CardContent></Card>
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
        <Kpi title="Niveau de risque moyen" icon={Gauge} color="border-l-red-500" value={e?.truriskAvg != null ? fmt(e.truriskAvg) : "—"}
          help={<>Moyenne du score de risque calculé par Qualys pour chaque machine (TruRisk, de 0 à 1 000) : le niveau de risque global du parc. Doit baisser dans le temps.</>}
          sub={e ? <><span>sur 1 000 · {fmt(e.truriskAssets)} machines</span> <Delta value={trendOver(points, "truriskAvg")} lowerIsBetter /></> : "après le prochain calcul"} />
        <Kpi title="Failles exploitables" icon={Flame} color="border-l-orange-500" value={e ? fmt(e.armed.detections) : fmt(r.kev.detections)}
          help={<>Failles non corrigées qu&apos;un attaquant peut utiliser dès maintenant : déjà exploitées (CISA KEV), utilisées par des rançongiciels, attaques en cours, ou méthode d&apos;attaque publiée.</>}
          sub={e ? <><span>dont {fmt(e.armed.servers)} sur des serveurs</span> <Delta value={trendOver(points, "armed")} lowerIsBetter /></> : "failles déjà exploitées seulement (ancien calcul)"} />
        <Kpi title="Corrigées dans les délais" icon={CheckCircle2} color="border-l-emerald-500" value={slaRate === null ? "—" : `${fmt(slaRate)} %`}
          help={<>Part des failles corrigées dans les délais de notre politique ({r.severities.map((s) => `${slaText(s)} pour une faille ${(SEVERITY_LABELS[s.severity] ?? "").toLowerCase()}`).join(", ")}), sur les {o?.windowDays ?? 90} derniers jours.</>}
          sub={o?.fixedCollected ? `sur ${fmt(o.fixed.all.fixed)} failles corrigées en ${o.windowDays} jours` : "après le prochain calcul"} />
        <Kpi title="Temps de correction (critiques)" icon={Timer} color="border-l-sky-500" value={mttr5 === null ? "—" : `${fmt(mttr5)} j`}
          help={<>Temps moyen pour corriger une faille critique, de sa détection à sa correction (indicateur appelé MTTR). Délai fixé : 7 jours calendaires, une faille critique étant traitée comme un incident de sécurité.</>}
          sub={mttr5 === null ? "après le prochain calcul" : <><span>en moyenne · délai fixé 7 j</span> <Delta value={trendOver(points, "mttr5")} lowerIsBetter unit=" j" /></>} />
        <Kpi title="Machines analysées" icon={Radar} color="border-l-violet-500" value={coverage === null ? "—" : `${coverage} %`}
          help={<>Part des machines analysées par Qualys (agent ou scanner) dans les {r.coverage.recentDays} derniers jours.</>}
          sub={`${fmt(r.coverage.scanned)} sur ${fmt(r.coverage.total)}, ces ${r.coverage.recentDays} derniers jours`} />
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
