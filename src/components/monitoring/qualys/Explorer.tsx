import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Filter, X, ChevronDown, ChevronRight, Download, ArrowUpDown, Loader2, Search, Wrench, Archive, Radar, Globe, AlertTriangle,
} from "lucide-react";
import { ASSET_TYPE_LABELS, fmt, pct, type AssetType } from "@/lib/qualys";
import {
  chips, removeChip, isFiltered, toggle, facetCounts, osFamily, truTier, scanState, hasAgent, productGroups, groupPriority, eolProducts,
  TIER_LABELS, SCAN_LABELS, THREAT_LABELS, ARMED_FLAGS, fmtDate, toCsv, downloadCsv, wasStatusLabel,
  type DAsset, type QFilters, type TruTier, type CatalogIndex, type ScanState, type CsamAsset, type WasApp, type WasFinding,
} from "@/lib/qualysDetails";
import { callQualys } from "./api";
import { Badge, FlagBadges, FoldTitle, Help, TYPE_TONE, sevTone, clickable, useQualysCtx } from "./ui";

const TYPES: AssetType[] = ["server", "workstation", "other"];
const TIERS: TruTier[] = ["critical", "high", "medium", "low", "none"];

// ---------------------------------------------------------------------------
// Section d'axe repliable
// ---------------------------------------------------------------------------

const AXES_KEY = "qualys-axes-open";
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(AXES_KEY) ?? "{}"); } catch { return {}; }
}

/** Indicateur affiché dans l'en-tête d'un axe replié. */
export interface AxisMetric { value: string; label: string }

export function AxisSection({ id, n, title, subtitle, metrics, children }: {
  readonly id: string; readonly n: number | string; readonly title: string; readonly subtitle: string;
  readonly metrics?: AxisMetric[]; readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => readOpen()[id] ?? false);
  const flip = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(AXES_KEY, JSON.stringify({ ...readOpen(), [id]: next })); } catch { /* stockage indisponible */ }
  };
  return (
    <section className={open ? "space-y-4 pb-4" : "space-y-4"}>
      <button type="button" onClick={flip} aria-expanded={open}
        className={`w-full text-left flex items-center gap-4 px-3 py-4 border-b border-l-[3px] transition-colors ${open
          ? "bg-muted/40 border-l-primary border-b-primary/30 rounded-t-md"
          : "border-l-transparent border-b-border hover:bg-muted/30"}`}>
        <span className={`text-[11px] font-semibold uppercase tracking-wider w-12 shrink-0 ${open ? "text-primary" : "text-muted-foreground"}`}>{typeof n === "number" ? `Axe ${n}` : n}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground truncate" title={subtitle}>{subtitle}</p>
          {!open && metrics && metrics.length > 0 && (
            <p className="lg:hidden text-xs text-muted-foreground mt-1">
              {metrics.map((m, k) => <span key={m.label}>{k > 0 && " · "}<span className="font-semibold text-foreground tabular-nums">{m.value}</span> {m.label}</span>)}
            </p>
          )}
        </div>
        {!open && metrics && metrics.length > 0 && (
          <dl className="hidden lg:flex items-center gap-8 shrink-0">
            {metrics.map((m) => (
              <div key={m.label} className="text-right">
                <dd className="text-sm font-semibold text-foreground tabular-nums">{m.value}</dd>
                <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
              </div>
            ))}
          </dl>
        )}
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180 text-primary" : "text-muted-foreground"}`} />
      </button>
      {open && <div className="space-y-4 pl-4 border-l-[3px] border-l-primary/20 pb-2">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Barre de filtres de la page
// ---------------------------------------------------------------------------

function FacetMenu<T extends string | number>({ label, active, options, isOn, onToggle }: {
  readonly label: string; readonly active: boolean; readonly options: { value: T; label: string; count?: number }[];
  readonly isOn: (v: T) => boolean; readonly onToggle: (v: T) => void;
}) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-md border ${active ? "border-primary text-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
          {label}{active ? " •" : ""} <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 space-y-1">
        {options.length > 8 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="h-7 text-xs mb-1" />}
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {shown.map((o) => (
            <label key={String(o.value)} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-muted cursor-pointer">
              <input type="checkbox" checked={isOn(o.value)} onChange={() => onToggle(o.value)} />
              <span className="flex-1 truncate" title={o.label}>{o.label}</span>
              {o.count !== undefined && <span className="text-xs text-muted-foreground">{fmt(o.count)}</span>}
            </label>
          ))}
          {!shown.length && <p className="text-xs text-muted-foreground px-1.5 py-1">Aucune valeur.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({ assets, shown }: { readonly assets: DAsset[]; readonly shown: number }) {
  const ctx = useQualysCtx()!;
  const f = ctx.filters;
  const set = ctx.setFilters;
  const facets = useMemo(() => facetCounts(assets), [assets]);
  const typeCount = useMemo(() => Object.fromEntries(TYPES.map((t) => [t, assets.filter((a) => a.asset_type === t).length])), [assets]);
  const tierCount = useMemo(() => Object.fromEntries(TIERS.map((t) => [t, assets.filter((a) => truTier(a.trurisk) === t).length])), [assets]);
  const [search, setSearch] = useState(f.search ?? "");
  const one = <K extends keyof QFilters>(key: K, value: QFilters[K]) => set((x) => ({ ...x, [key]: x[key] === value ? undefined : value }));
  const list = chips(f, ASSET_TYPE_LABELS, ctx.idx ?? undefined);
  return (
    <Card className="sticky top-0 z-20 shadow-sm">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <form onSubmit={(e) => { e.preventDefault(); set((x) => ({ ...x, search: search.trim() || undefined })); }} className="flex items-center gap-1">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Actif, IP, système, tag…" className="h-8 w-52 text-sm" />
            <Button type="submit" size="sm" variant="outline" className="h-8 px-2"><Search className="w-4 h-4" /></Button>
          </form>
          <FacetMenu label="Type" active={Boolean(f.type?.length)} options={TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t], count: typeCount[t] }))}
            isOn={(v) => f.type?.includes(v) ?? false} onToggle={(v) => set((x) => toggle(x, "type", v))} />
          <FacetMenu label="TruRisk" active={Boolean(f.tier?.length)} options={TIERS.map((t) => ({ value: t, label: TIER_LABELS[t], count: tierCount[t] }))}
            isOn={(v) => f.tier?.includes(v) ?? false} onToggle={(v) => set((x) => toggle(x, "tier", v))} />
          <FacetMenu label="Criticité" active={Boolean(f.criticality?.length)} options={facets.criticality.map(([c, n]) => ({ value: c, label: c ? `${c} / 5` : "Non renseignée", count: n }))}
            isOn={(v) => f.criticality?.includes(v) ?? false} onToggle={(v) => set((x) => toggle(x, "criticality", v))} />
          <FacetMenu label="Système" active={Boolean(f.os?.length)} options={facets.os.map(([o, n]) => ({ value: o, label: o, count: n }))}
            isOn={(v) => f.os?.includes(v) ?? false} onToggle={(v) => set((x) => toggle(x, "os", v))} />
          <FacetMenu label="Tag" active={Boolean(f.tag?.length)} options={facets.tags.map(([t, n]) => ({ value: t, label: t, count: n }))}
            isOn={(v) => f.tag?.includes(v) ?? false} onToggle={(v) => set((x) => toggle(x, "tag", v))} />
          <FacetMenu label="Couverture" active={f.scan !== undefined || f.agent !== undefined || f.publicIp !== undefined}
            options={[
              ...(["recent", "stale", "never"] as ScanState[]).map((s) => ({ value: `scan:${s}`, label: SCAN_LABELS[s] })),
              { value: "agent:1", label: "Avec agent Qualys" }, { value: "agent:0", label: "Sans agent Qualys" },
              { value: "public:1", label: "Exposés sur Internet (IP publique)" },
            ]}
            isOn={(v) => (v.startsWith("scan:") ? f.scan === v.slice(5) : v.startsWith("agent:") ? f.agent === (v === "agent:1") : f.publicIp === true)}
            onToggle={(v) => (v.startsWith("scan:") ? one("scan", v.slice(5) as ScanState) : v.startsWith("agent:") ? one("agent", v === "agent:1") : one("publicIp", true))} />
          <FacetMenu label="Menaces" active={Boolean(f.threat || f.eol || f.overdue || f.sev5)}
            options={[
              ...(["kev", "ransomware", "armed"] as const).map((t) => ({ value: `threat:${t}`, label: THREAT_LABELS[t] })),
              { value: "sev5", label: "Vulnérabilités critiques" }, { value: "overdue", label: "Vulnérabilités hors délai" }, { value: "eol", label: "Produit en fin de support" },
            ]}
            isOn={(v) => (v.startsWith("threat:") ? f.threat === v.slice(7) : Boolean(f[v as "sev5" | "overdue" | "eol"]))}
            onToggle={(v) => (v.startsWith("threat:") ? one("threat", v.slice(7) as QFilters["threat"]) : one(v as "sev5" | "overdue" | "eol", true))} />
          <span className="text-sm text-muted-foreground ml-auto">{isFiltered(f) ? <><b className="text-foreground">{fmt(shown)}</b> actifs sur {fmt(assets.length)}</> : <>{fmt(assets.length)} actifs</>}</span>
        </div>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {list.map((c) => (
              <button key={`${c.key}-${JSON.stringify(c.value ?? null)}`} type="button" onClick={() => { set((x) => removeChip(x, c)); if (c.key === "search") setSearch(""); }}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20">
                {c.label} <X className="w-3 h-3" />
              </button>
            ))}
            <button type="button" onClick={() => { set({}); setSearch(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground underline">Tout effacer</button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Les filtres s&apos;appliquent à toute la page (actifs, vulnérabilités, obsolescence, inventaire). Cliquer sur un chiffre, une barre ou une ligne filtre aussi. Délais de correction et conformité restent globaux.</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inventaire des actifs (VMDR)
// ---------------------------------------------------------------------------

type SortKey = "name" | "trurisk" | "vulns" | "armed" | "overdue" | "last_scan" | "criticality";
const ASSET_CSV = [
  { key: "name", label: "Actif" }, { key: "ip", label: "Adresse IP" }, { key: "typeLabel", label: "Type" }, { key: "os", label: "Système" },
  { key: "trurisk", label: "TruRisk" }, { key: "criticality", label: "Criticité" }, { key: "tracking", label: "Suivi" }, { key: "last_scan", label: "Dernier scan" },
  { key: "last_activity", label: "Dernière activité" }, { key: "publicLabel", label: "IP publique" }, { key: "d5", label: "Critiques" }, { key: "d4", label: "Élevées" },
  { key: "d3", label: "Modérées" }, { key: "armed", label: "Exploitables" }, { key: "kev", label: "CISA KEV" }, { key: "overdue", label: "Hors délai" },
  { key: "eol", label: "Produits en fin de support" }, { key: "ignored", label: "Dérogations" }, { key: "tags", label: "Tags" }, { key: "host_id", label: "Identifiant Qualys" },
];

export function AssetTable({ assets, title, help, initial = 25, csvName = "qualys-actifs.csv", defaultSort = "trurisk" }: {
  readonly assets: DAsset[]; readonly title: React.ReactNode; readonly help?: React.ReactNode; readonly initial?: number; readonly csvName?: string; readonly defaultSort?: SortKey;
}) {
  const ctx = useQualysCtx()!;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: defaultSort, desc: true });
  const [limit, setLimit] = useState(initial);
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => {
    const v = (a: DAsset): number | string => sort.key === "name" ? (a.name ?? a.ip ?? "").toLowerCase() : sort.key === "vulns" ? a.d5 * 1e6 + a.d4 * 1e3 + a.d3
      : sort.key === "last_scan" ? (a.last_scan ?? "") : sort.key === "criticality" ? a.criticality ?? 0 : sort.key === "trurisk" ? a.trurisk ?? -1 : a[sort.key];
    return [...assets].sort((x, y) => { const a = v(x), b = v(y); const c = a < b ? -1 : a > b ? 1 : 0; return sort.desc ? -c : c; });
  }, [assets, sort]);
  const head = (key: SortKey, label: string, right = true) => (
    <TableHead className={`${right ? "text-right" : ""} whitespace-nowrap`}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
        {label} <ArrowUpDown className={`w-3 h-3 ${sort.key === key ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
  return (
    <Card>
      <CardHeader className={open ? "pb-2" : ""}>
        <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
          <FoldTitle open={open} onToggle={() => setOpen(!open)}>{title} <span className="text-muted-foreground font-normal">({fmt(assets.length)})</span></FoldTitle>
          {help && <Help>{help}</Help>}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCsv(csvName, toCsv(sorted.map((a) => ({ ...a, typeLabel: ASSET_TYPE_LABELS[a.asset_type], publicLabel: a.public_ip ? "Oui" : "Non" })), ASSET_CSV))}>
            <Download className="w-4 h-4" /> Exporter ({fmt(assets.length)})
          </Button>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {head("name", "Actif", false)}
              {head("trurisk", "TruRisk")}
              {head("criticality", "Criticité")}
              {head("vulns", "Crit. / Élev. / Mod.")}
              {head("armed", "Exploitables")}
              {head("overdue", "Hors délai")}
              {head("last_scan", "Dernier scan")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, limit).map((a) => (
              <TableRow key={a.host_id} className="cursor-pointer hover:bg-muted/50" onClick={() => ctx.openAsset(a.host_id)}>
                <TableCell className="py-1.5 max-w-[320px]">
                  <div className="text-sm font-medium truncate" title={a.name ?? ""}>{a.name ?? a.ip ?? a.host_id}</div>
                  <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                    <Badge tone={TYPE_TONE[a.asset_type]}>{ASSET_TYPE_LABELS[a.asset_type]}</Badge>
                    {a.public_ip && <Badge tone="red">Internet</Badge>}
                    {!hasAgent(a) && <Badge tone="muted">sans agent</Badge>}
                    <span className="font-mono">{a.ip}</span> · {a.os}
                  </div>
                </TableCell>
                <TableCell className={`text-right font-black py-1.5 ${(a.trurisk ?? 0) >= 850 ? "text-red-600" : (a.trurisk ?? 0) >= 700 ? "text-orange-600" : ""}`}>{fmt(a.trurisk)}</TableCell>
                <TableCell className="text-right py-1.5">{a.criticality ? `${a.criticality}/5` : "—"}</TableCell>
                <TableCell className="text-right py-1.5 whitespace-nowrap">{fmt(a.d5)} / {fmt(a.d4)} / {fmt(a.d3)}</TableCell>
                <TableCell className="text-right py-1.5">{fmt(a.armed)}{a.kev ? <span className="text-red-600 text-[11px]"> · {fmt(a.kev)} KEV</span> : null}</TableCell>
                <TableCell className={`text-right py-1.5 ${a.overdue ? "text-red-600" : "text-muted-foreground"}`}>{fmt(a.overdue)}</TableCell>
                <TableCell className={`text-right py-1.5 text-xs whitespace-nowrap ${scanState(a) !== "recent" ? "text-amber-600" : ""}`}>{fmtDate(a.last_scan)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {sorted.length > limit && (
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 100)}>Afficher 100 de plus</Button>
            <Button variant="ghost" size="sm" onClick={() => setLimit(sorted.length)}>Tout afficher ({fmt(sorted.length)})</Button>
          </div>
        )}
        {!sorted.length && <p className="text-sm text-muted-foreground py-4 text-center">Aucun actif ne correspond aux filtres.</p>}
      </CardContent>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Axe 2 : correctifs prioritaires (vulnérabilités regroupées par produit)
// ---------------------------------------------------------------------------

export function PriorityFixes({ assets, idx }: { readonly assets: DAsset[]; readonly idx: CatalogIndex }) {
  const ctx = useQualysCtx()!;
  const [onlyArmed, setOnlyArmed] = useState(true);
  const [limit, setLimit] = useState(15);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState("");
  const groups = useMemo(() => productGroups(assets, idx).sort((a, b) => groupPriority(b) - groupPriority(a)), [assets, idx]);
  const list = groups.filter((g) => (!onlyArmed || g.flags & ARMED_FLAGS) && (!q || g.key.toLowerCase().includes(q.toLowerCase())));
  const hostsByQid = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of assets) for (const x of a.qids) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  }, [assets]);
  return (
    <Card>
      <CardHeader className={shown ? "pb-2" : ""}>
        <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
          <FoldTitle open={shown} onToggle={() => setShown(!shown)}><Wrench className="w-4 h-4 text-orange-500" /> Correctifs prioritaires, par produit <span className="text-muted-foreground font-normal">({fmt(list.length)})</span></FoldTitle>
          <Help>Les vulnérabilités ouvertes regroupées par produit à corriger (ex. toutes les vulnérabilités de jackson-databind sur une ligne) : une ligne correspond à un chantier de remédiation. Classement : exploitées activement (CISA KEV) et ransomware d&apos;abord, puis exploitables, sévérité, nombre de serveurs et d&apos;actifs touchés. Cliquer sur une ligne pour voir ses vulnérabilités ; l&apos;entonnoir filtre toute la page sur ce produit.</Help>
          {shown && <span className="ml-auto flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produit…" className="h-7 w-40 text-xs" />
            <label className="text-xs font-normal flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyArmed} onChange={() => setOnlyArmed(!onlyArmed)} /> exploitables seulement</label>
          </span>}
        </CardTitle>
      </CardHeader>
      {shown && <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit à corriger</TableHead>
              <TableHead className="text-right whitespace-nowrap">Actifs touchés</TableHead>
              <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
              <TableHead className="text-right whitespace-nowrap">Vulnérabilités</TableHead>
              <TableHead className="text-center">Sév. max</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.slice(0, limit).map((g) => (
              <Fragment key={g.key}>
                <TableRow className={`cursor-pointer hover:bg-muted/50 ${ctx.filters.product === g.key ? "bg-primary/5" : ""}`} onClick={() => setOpen(open === g.key ? null : g.key)}>
                  <TableCell className="py-1.5 max-w-[380px]">
                    <div className="text-sm font-medium truncate flex items-center gap-1" title={g.key}>{open === g.key ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />} {g.key}</div>
                    <div className="pl-5"><FlagBadges flags={g.flags} />{g.publicHosts > 0 && <span className="ml-1"><Badge tone="red">{fmt(g.publicHosts)} exposés sur Internet</Badge></span>}</div>
                  </TableCell>
                  <TableCell className="text-right font-semibold py-1.5">{fmt(g.hosts)}</TableCell>
                  <TableCell className="text-right py-1.5">{fmt(g.servers)}</TableCell>
                  <TableCell className="text-right py-1.5">{fmt(g.qids.length)}{g.kevQids ? <span className="text-red-600 text-[11px]"> · {g.kevQids} KEV</span> : null}</TableCell>
                  <TableCell className="text-center py-1.5"><Badge tone={sevTone(g.maxSeverity)}>{g.maxSeverity || "—"}</Badge>{g.maxCvss !== null && <div className="text-[10px] text-muted-foreground">CVSS {g.maxCvss}</div>}</TableCell>
                  <TableCell className="py-1.5 text-right">
                    <button type="button" title="Filtrer toute la page sur ce produit" onClick={(e) => { e.stopPropagation(); ctx.setFilters((f) => ({ ...f, product: f.product === g.key ? undefined : g.key })); }}
                      className={`p-1 rounded hover:bg-muted ${ctx.filters.product === g.key ? "text-primary" : "text-muted-foreground"}`}><Filter className="w-4 h-4" /></button>
                  </TableCell>
                </TableRow>
                {open === g.key && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 py-2">
                      <ul className="space-y-1">
                        {g.qids.map((x) => idx.byQid.get(x)).filter(Boolean).sort((a, b) => (b!.severity ?? 0) - (a!.severity ?? 0) || (hostsByQid.get(b!.qid) ?? 0) - (hostsByQid.get(a!.qid) ?? 0)).map((c) => (
                          <li key={c!.qid}><button type="button" className="flex w-full items-center gap-2 text-left text-xs cursor-pointer hover:underline" onClick={() => ctx.openVuln(c!.qid)}>
                            <Badge tone={sevTone(c!.severity)}>{c!.severity ?? "?"}</Badge>
                            <span className="flex-1 truncate" title={c!.title}>{c!.title || `QID ${c!.qid}`}</span>
                            <FlagBadges flags={c!.flags} compact />
                            <span className="font-mono text-muted-foreground whitespace-nowrap">{c!.cves.slice(0, 2).join(", ")}</span>
                            <b className="whitespace-nowrap">{fmt(hostsByQid.get(c!.qid) ?? 0)} actifs</b>
                          </button></li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {list.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 30)}>Afficher plus ({fmt(list.length - limit)} produits restants)</Button>}
        {!list.length && <p className="text-sm text-muted-foreground py-4 text-center">Aucune vulnérabilité {onlyArmed ? "exploitable " : ""}sur la sélection.</p>}
      </CardContent>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Obsolescence : liste complète, recalculée sur la sélection
// ---------------------------------------------------------------------------

export function EolList({ assets, idx, total }: { readonly assets: DAsset[]; readonly idx: CatalogIndex; readonly total: number }) {
  const ctx = useQualysCtx()!;
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "os" | "sw">("all");
  const [limit, setLimit] = useState(20);
  const [open, setOpen] = useState(false);
  const all = useMemo(() => eolProducts(assets, idx), [assets, idx]);
  const list = all.filter((p) => (kind === "all" || (kind === "os") === p.os) && (!q || p.title.toLowerCase().includes(q.toLowerCase())));
  const eolAssets = assets.filter((a) => a.eol > 0);
  const byType = Object.fromEntries(TYPES.map((t) => [t, eolAssets.filter((a) => a.asset_type === t).length])) as Record<AssetType, number>;
  const chip = (active: boolean) => `text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  return (
    <Card>
      <CardHeader className={open ? "pb-2" : ""}>
        <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
          <FoldTitle open={open} onToggle={() => setOpen(!open)}><Archive className="w-4 h-4 text-amber-600" /> Obsolescence : systèmes et logiciels en fin de support</FoldTitle>
          <Help>Produits qui ne reçoivent plus de correctifs de sécurité de leur éditeur (vulnérabilités « EOL/Obsolete » de Qualys VMDR). Liste complète, recalculée selon les filtres de la page. Cliquer sur un produit pour voir les actifs concernés.</Help>
          {!open && <span className="text-xs font-normal text-muted-foreground"><b className="text-foreground">{fmt(eolAssets.length)}</b> actifs concernés · {fmt(all.length)} produits en fin de support</span>}
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2 text-sm">
          <button type="button" className={`text-left w-full p-1 ${clickable(Boolean(ctx.filters.eol))}`} onClick={() => ctx.setFilters((f) => ({ ...f, eol: f.eol ? undefined : true }))} title="Filtrer la page sur ces actifs">
            <div className="text-3xl font-black">{fmt(eolAssets.length)}</div>
            <div className="text-xs text-muted-foreground">actifs concernés, soit {pct(eolAssets.length, total) ?? 0} % de la sélection</div>
          </button>
          <div className="space-y-1 text-xs">
            {TYPES.map((t) => (
              <button type="button" key={t} className={`flex w-full justify-between gap-2 px-1 text-left ${clickable(Boolean(ctx.filters.eol && ctx.filters.type?.includes(t)))}`}
                onClick={() => ctx.setFilters((f) => ({ ...f, eol: true, type: [t] }))}>
                <span className="text-muted-foreground">{ASSET_TYPE_LABELS[t]}</span><span className="font-semibold">{fmt(byType[t])}</span>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground border-t border-border pt-2">{fmt(all.length)} produits en fin de support, dont {fmt(all.filter((p) => p.os).length)} systèmes d&apos;exploitation</div>
        </div>
        <div className="lg:col-span-2 space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            {([["all", "Tous"], ["os", "Systèmes"], ["sw", "Logiciels"]] as const).map(([k, l]) => <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>{l}</button>)}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produit…" className="h-7 w-44 text-xs" />
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCsv("qualys-fin-de-support.csv", toCsv(list.map((p) => ({ ...p, kind: p.os ? "Système" : "Logiciel" })), [
              { key: "title", label: "Produit" }, { key: "kind", label: "Nature" }, { key: "hosts", label: "Actifs" }, { key: "servers", label: "dont serveurs" }, { key: "qid", label: "QID" },
            ]))}><Download className="w-4 h-4" /> Exporter</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit en fin de support</TableHead>
                  <TableHead className="text-right">Actifs</TableHead>
                  <TableHead className="text-right whitespace-nowrap">dont serveurs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.slice(0, limit).map((p) => (
                  <TableRow key={p.qid} className="cursor-pointer hover:bg-muted/50" onClick={() => ctx.openVuln(p.qid)}>
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
          </div>
          {list.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(list.length)}>Afficher les {fmt(list.length)} produits</Button>}
          {!list.length && <p className="text-sm text-emerald-600 font-semibold py-2">Aucun produit en fin de support sur la sélection.</p>}
        </div>
      </CardContent>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inventaire CSAM complet (chargé à l'ouverture)
// ---------------------------------------------------------------------------

const CSAM_CSV = [
  { key: "name", label: "Actif" }, { key: "ip", label: "Adresse IP" }, { key: "typeLabel", label: "Type" }, { key: "os", label: "Système" },
  { key: "agentLabel", label: "Agent" }, { key: "agent_last_checkin", label: "Dernier contact de l'agent" }, { key: "scannerLabel", label: "Scanner réseau" },
  { key: "lifecycle_stage", label: "Cycle de vie" }, { key: "eos", label: "Fin de support" }, { key: "eol", label: "Fin de vie" }, { key: "hardware", label: "Matériel" },
  { key: "sources", label: "Sources" }, { key: "created", label: "Découvert le" }, { key: "last_seen", label: "Vu le" }, { key: "criticality", label: "Criticité" },
  { key: "tags", label: "Tags" }, { key: "asset_id", label: "Identifiant CSAM" },
];

type CsamView = "all" | "agent" | "shadow" | "stale" | "eos";

export function CsamInventory() {
  const ctx = useQualysCtx()!;
  const [show, setShow] = useState(false);
  const q = useQuery({ queryKey: ["qualys-inventory"], queryFn: () => callQualys<{ available: boolean; date: string | null; assets: CsamAsset[] }>({ action: "inventory" }), enabled: show, staleTime: 30 * 60_000 });
  const [view, setView] = useState<CsamView>("all");
  const [limit, setLimit] = useState(50);
  const [raw, setRaw] = useState<number | null>(null);
  const f = ctx.filters;
  const now = Date.now();
  const isStale = (a: CsamAsset) => a.has_agent && (!a.agent_last_checkin || now - Date.parse(a.agent_last_checkin) > 7 * 86_400_000);
  const isEos = (a: CsamAsset) => Boolean((a.eos && Date.parse(a.eos) < now) || /EOS|EOL|end of/i.test(a.lifecycle_stage ?? ""));
  const scoped = useMemo(() => (q.data?.assets ?? []).filter((a) => (!f.type?.length || f.type.includes(a.asset_type)) && (!f.os?.length || f.os.includes(osFamily(a.os)))
    && (!f.tag?.length || f.tag.some((t) => a.tags.includes(t))) && (!f.search || [a.name, a.ip, a.os, ...a.tags].some((x) => (x ?? "").toLowerCase().includes(f.search!.toLowerCase())))), [q.data, f]);
  const counts = { all: scoped.length, agent: scoped.filter((a) => a.has_agent).length, shadow: scoped.filter((a) => !a.has_agent && !a.has_scanner).length, stale: scoped.filter(isStale).length, eos: scoped.filter(isEos).length };
  const list = scoped.filter((a) => view === "all" || (view === "agent" ? a.has_agent : view === "shadow" ? !a.has_agent && !a.has_scanner : view === "stale" ? isStale(a) : isEos(a)));
  const labels: Record<CsamView, string> = { all: "Tous", agent: "Avec agent", shadow: "Shadow IT (ni agent ni scan)", stale: "Agents silencieux (> 7 j)", eos: "Système hors support" };
  const chip = (active: boolean) => `text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  const detail = useQuery({ queryKey: ["qualys-inventory-asset", raw], queryFn: () => callQualys<{ asset: Record<string, unknown> }>({ action: "inventory-asset", assetId: raw }), enabled: raw !== null });
  return (
    <Card>
      <CardHeader className={show ? "pb-2" : ""}>
        <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
          <FoldTitle open={show} onToggle={() => setShow(!show)}><Radar className="w-4 h-4 text-primary" /> Inventaire complet (CSAM)</FoldTitle>
          <Help>Tous les actifs connus de Qualys CSAM, quel que soit le moyen de découverte (agent, scanner, capteur passif, connecteur cloud). Les filtres de type, système, tag et la recherche de la page s&apos;appliquent. Cliquer sur une ligne pour voir tous ses attributs.</Help>
          {show && q.data?.available && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCsv("qualys-inventaire-csam.csv", toCsv(list.map((a) => ({
              ...a, typeLabel: ASSET_TYPE_LABELS[a.asset_type], agentLabel: a.has_agent ? "Oui" : "Non", scannerLabel: a.has_scanner ? "Oui" : "Non",
            })), CSAM_CSV))}><Download className="w-4 h-4" /> Exporter ({fmt(list.length)})</Button>
          )}
        </CardTitle>
      </CardHeader>
      {show && (
        <CardContent className="space-y-2">
          {q.isLoading ? <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Chargement de l&apos;inventaire…</div>
            : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            : !q.data?.available || !q.data.assets.length ? <p className="text-sm text-muted-foreground py-2">Inventaire CSAM pas encore disponible : il le sera après le prochain calcul de nuit réussi.</p>
            : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(labels) as CsamView[]).map((k) => <button key={k} type="button" className={chip(view === k)} onClick={() => { setView(k); setLimit(50); }}>{labels[k]} ({fmt(counts[k])})</button>)}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Actif</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Cycle de vie</TableHead>
                        <TableHead>Matériel</TableHead>
                        <TableHead>Sources</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Découvert le</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.slice(0, limit).map((a) => (
                        <Fragment key={a.asset_id}>
                          <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => (a.host_id ? ctx.openAsset(a.host_id) : setRaw(raw === a.asset_id ? null : a.asset_id))}>
                            <TableCell className="py-1.5 max-w-[300px]">
                              <div className="text-sm font-medium truncate">{a.name ?? a.ip ?? a.asset_id}</div>
                              <div className="text-[11px] text-muted-foreground truncate"><Badge tone={TYPE_TONE[a.asset_type]}>{ASSET_TYPE_LABELS[a.asset_type]}</Badge> <span className="font-mono">{a.ip}</span> · {a.os}</div>
                            </TableCell>
                            <TableCell className="py-1.5 text-xs whitespace-nowrap">{a.has_agent ? <span className={isStale(a) ? "text-amber-600" : ""}>Oui · {fmtDate(a.agent_last_checkin)}</span> : a.has_scanner ? "Scanner seul" : <span className="text-red-600 font-semibold">Non géré</span>}</TableCell>
                            <TableCell className="py-1.5 text-xs">{a.lifecycle_stage ?? "—"}{a.eos && <div className={isEos(a) ? "text-red-600" : "text-muted-foreground"}>fin de support {fmtDate(a.eos)}</div>}</TableCell>
                            <TableCell className="py-1.5 text-xs max-w-[200px] truncate" title={a.hardware ?? ""}>{a.hardware ?? "—"}</TableCell>
                            <TableCell className="py-1.5 text-xs">{a.sources ?? "—"}</TableCell>
                            <TableCell className="py-1.5 text-xs text-right whitespace-nowrap">{fmtDate(a.created)}</TableCell>
                          </TableRow>
                          {raw === a.asset_id && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/30 py-2">
                                {detail.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                                  <pre className="text-[11px] whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{JSON.stringify(detail.data?.asset?.attrs ?? detail.data?.asset ?? {}, null, 2)}</pre>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {list.length > limit && (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 200)}>Afficher 200 de plus</Button>
                    <Button variant="ghost" size="sm" onClick={() => setLimit(list.length)}>Tout afficher ({fmt(list.length)})</Button>
                  </div>
                )}
              </>
            )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Axe 5 : applications web, inventaire complet et vulnérabilités
// ---------------------------------------------------------------------------

const FINDING_CSV = [
  { key: "app_name", label: "Application" }, { key: "title", label: "Vulnérabilité" }, { key: "qid", label: "QID" }, { key: "severity", label: "Sévérité" },
  { key: "statusLabel", label: "Statut" }, { key: "owasp", label: "OWASP" }, { key: "url", label: "URL" }, { key: "first_detected", label: "Première détection" },
  { key: "last_detected", label: "Dernière détection" }, { key: "last_tested", label: "Dernier test" }, { key: "overdueLabel", label: "Hors délai" },
  { key: "times_detected", label: "Détections" }, { key: "potentialLabel", label: "Potentielle" },
];

export function WebAppsExplorer() {
  const q = useQuery({ queryKey: ["qualys-webapps"], queryFn: () => callQualys<{ available: boolean; apps: WasApp[]; findings: WasFinding[] }>({ action: "webapps" }), staleTime: 30 * 60_000 });
  const [app, setApp] = useState<number | null>(null);
  const [sev, setSev] = useState<number[]>([]);
  const [status, setStatus] = useState<"open" | "fixed" | "all">("open");
  const [owasp, setOwasp] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(50);
  const [shown, setShown] = useState(false);
  const data = q.data;
  const isOpen = (x: WasFinding) => !/FIXED/i.test(x.status ?? "");
  const apps = useMemo(() => {
    if (!data) return [];
    const byApp = new Map<number, { s5: number; s4: number; s3: number; overdue: number; fixed: number }>();
    for (const x of data.findings) {
      if (x.app_id === null) continue;
      const c = byApp.get(x.app_id) ?? { s5: 0, s4: 0, s3: 0, overdue: 0, fixed: 0 };
      if (!isOpen(x)) c.fixed++;
      else if ((x.severity ?? 0) >= 5) c.s5++; else if (x.severity === 4) c.s4++; else if (x.severity === 3) c.s3++;
      if (x.overdue) c.overdue++;
      byApp.set(x.app_id, c);
    }
    const known = new Map(data.apps.map((a) => [a.app_id, a]));
    for (const x of data.findings) if (x.app_id !== null && !known.has(x.app_id)) known.set(x.app_id, { app_id: x.app_id, name: x.app_name, url: null, tags: [], created: null, last_scan: null, attrs: {} });
    return [...known.values()].map((a) => ({ ...a, ...(byApp.get(a.app_id) ?? { s5: 0, s4: 0, s3: 0, overdue: 0, fixed: 0 }) }))
      .sort((a, b) => b.s5 * 1e6 + b.s4 * 1e3 + b.s3 - (a.s5 * 1e6 + a.s4 * 1e3 + a.s3) || (a.name ?? "").localeCompare(b.name ?? ""));
  }, [data]);
  const findings = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.findings ?? []).filter((x) => (app === null || x.app_id === app) && (!sev.length || sev.includes(Math.min(5, x.severity ?? 0)))
      && (status === "all" || (status === "open") === isOpen(x)) && (!owasp || x.owasp === owasp) && (!overdue || x.overdue)
      && (!s || `${x.title} ${x.url} ${x.qid}`.toLowerCase().includes(s)))
      .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || Number(b.overdue) - Number(a.overdue));
  }, [data, app, sev, status, owasp, overdue, search]);
  const owaspList = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of data?.findings ?? []) if (x.owasp && isOpen(x) && (app === null || x.app_id === app)) m.set(x.owasp, (m.get(x.owasp) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data, app]);
  if (q.isLoading) return <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Chargement des applications…</div>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  if (!data?.available || (!data.apps.length && !data.findings.length)) return null;
  const chip = (active: boolean) => `text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  const selected = apps.find((a) => a.app_id === app);
  const openCount = data.findings.filter(isOpen).length;
  if (!shown) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
            <FoldTitle open={false} onToggle={() => setShown(true)}><Globe className="w-4 h-4 text-primary" /> Applications web et vulnérabilités applicatives</FoldTitle>
            <span className="text-xs font-normal text-muted-foreground"><b className="text-foreground">{fmt(apps.length)}</b> applications · <b className="text-foreground">{fmt(openCount)}</b> vulnérabilités ouvertes</span>
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <FoldTitle open onToggle={() => setShown(false)}><Globe className="w-4 h-4 text-primary" /> Applications web <span className="text-muted-foreground font-normal">({fmt(apps.length)})</span></FoldTitle>
            <Help>Inventaire complet des applications web déclarées dans Qualys WAS, y compris celles sans vulnérabilité ouverte. Cliquer sur une application pour filtrer la liste des vulnérabilités.</Help>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto max-h-[640px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead className="text-right whitespace-nowrap">Crit. / Élev. / Mod.</TableHead>
                <TableHead className="text-right whitespace-nowrap">Hors délai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => (
                <TableRow key={a.app_id} className={`cursor-pointer ${app === a.app_id ? "bg-primary/10" : "hover:bg-muted/50"} ${app !== null && app !== a.app_id ? "opacity-50" : ""}`} onClick={() => { setApp(app === a.app_id ? null : a.app_id); setLimit(50); }}>
                  <TableCell className="py-1.5 max-w-[260px]">
                    <div className="text-sm font-medium truncate" title={a.name ?? ""}>{a.name ?? `Application ${a.app_id}`}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{a.url}{a.tags.length > 0 && ` · ${a.tags.join(", ")}`}</div>
                  </TableCell>
                  <TableCell className="py-1.5 text-right whitespace-nowrap"><b className={a.s5 ? "text-red-600" : ""}>{fmt(a.s5)}</b> / {fmt(a.s4)} / {fmt(a.s3)}</TableCell>
                  <TableCell className={`py-1.5 text-right ${a.overdue ? "text-red-600" : "text-muted-foreground"}`}>{fmt(a.overdue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="xl:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Vulnérabilités applicatives {selected && <>· <span className="text-primary">{selected.name}</span> <button type="button" onClick={() => setApp(null)}><X className="w-4 h-4" /></button></>}
            <span className="text-muted-foreground font-normal">({fmt(findings.length)})</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCsv("qualys-was-vulnerabilites.csv", toCsv(findings.map((x) => ({
              ...x, statusLabel: wasStatusLabel(x.status), overdueLabel: x.overdue ? "Oui" : "Non", potentialLabel: x.potential ? "Oui" : "Non",
            })), FINDING_CSV))}><Download className="w-4 h-4" /> Exporter</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            {([["open", "Ouvertes"], ["fixed", "Corrigées"], ["all", "Toutes"]] as const).map(([k, l]) => <button key={k} type="button" className={chip(status === k)} onClick={() => setStatus(k)}>{l}</button>)}
            <span className="w-px h-5 bg-border mx-1" />
            {[5, 4, 3].map((s) => <button key={s} type="button" className={chip(sev.includes(s))} onClick={() => setSev(sev.includes(s) ? sev.filter((x) => x !== s) : [...sev, s])}>Sévérité {s}</button>)}
            <button type="button" className={chip(overdue)} onClick={() => setOverdue(!overdue)}>Hors délai</button>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Titre, URL, QID…" className="h-7 w-44 text-xs" />
          </div>
          {owaspList.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {owaspList.map(([o, n]) => <button key={o} type="button" className={chip(owasp === o)} onClick={() => setOwasp(owasp === o ? null : o)} title="Catégorie OWASP Top 10">{o} ({n})</button>)}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vulnérabilité</TableHead>
                  <TableHead className="text-center">Sév.</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="whitespace-nowrap">Détectée le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.slice(0, limit).map((x) => (
                  <Fragment key={x.finding_id}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(open === x.finding_id ? null : x.finding_id)}>
                      <TableCell className="py-1.5 max-w-[380px]">
                        <div className="text-sm font-medium truncate" title={x.title ?? ""}>{x.title ?? `QID ${x.qid}`}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{app === null && <b>{x.app_name} · </b>}{x.owasp ?? ""}{x.potential ? " · potentielle" : ""}</div>
                      </TableCell>
                      <TableCell className="text-center py-1.5"><Badge tone={sevTone(Math.min(5, x.severity ?? 0))}>{x.severity ?? "?"}</Badge></TableCell>
                      <TableCell className="py-1.5 text-xs whitespace-nowrap">{wasStatusLabel(x.status)}{x.overdue && <> · <span className="text-red-600 font-semibold">hors délai</span></>}</TableCell>
                      <TableCell className="py-1.5 text-xs whitespace-nowrap">{fmtDate(x.first_detected)}</TableCell>
                    </TableRow>
                    {open === x.finding_id && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/30 text-xs space-y-1 py-2">
                          {x.url && <div className="break-all"><b>URL :</b> <span className="font-mono">{x.url}</span></div>}
                          <div><b>QID :</b> {x.qid ?? "—"} · <b>Dernière détection :</b> {fmtDate(x.last_detected)} · <b>Dernier test :</b> {fmtDate(x.last_tested)}{x.fixed_date && <> · <b>Corrigée le</b> {fmtDate(x.fixed_date)}</>} · <b>Détections :</b> {x.times_detected ?? "—"}</div>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                            {Object.entries(x.attrs ?? {}).map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-border/40"><dt className="font-mono text-muted-foreground">{k}</dt><dd className="truncate" title={v}>{v}</dd></div>)}
                          </dl>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          {findings.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 100)}>Afficher plus ({fmt(findings.length - limit)} restantes)</Button>}
          {!findings.length && <p className="text-sm text-muted-foreground py-4 text-center">Aucune vulnérabilité ne correspond aux filtres.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

