import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, ChevronDown, ChevronRight, Filter } from "lucide-react";
import { ASSET_TYPE_LABELS, FLAGS, fmt, type AssetType } from "@/lib/qualys";
import {
  DETECTION_STATUS, fmtDate, toCsv, downloadCsv, scanState, SCAN_LABELS, hasAgent, truTier, TIER_LABELS,
  type Detection, type DAsset,
} from "@/lib/qualysDetails";
import { callQualys } from "./api";
import { Badge, FlagBadges, FoldTitle, TYPE_TONE, sevTone, useQualysCtx } from "./ui";

const PAGE = 100;

/** Attributs bruts (nom technique Qualys -> valeur), repliables. */
function RawAttributes({ attrs, title = "Tous les attributs Qualys" }: { readonly attrs: Record<string, unknown> | null | undefined; readonly title?: string }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(attrs ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  if (!entries.length) return null;
  /** Valeur lisible : texte tel quel, objet ou liste en JSON. */
  const show = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
  return (
    <div className="border border-border rounded-lg">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} {title} ({entries.length})
      </button>
      {open && (
        <dl className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-0.5 min-w-0">
              <dt className="text-muted-foreground font-mono shrink-0">{k}</dt>
              <dd className="text-right truncate" title={show(v)}>{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="text-sm truncate">{children ?? "—"}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche actif
// ---------------------------------------------------------------------------

interface AssetDetail {
  date: string;
  asset: DAsset & { netbios: string | null; attrs: Record<string, string> };
  counts: Partial<DAsset>;
  detections: Detection[];
  csam: (Record<string, unknown> & { attrs?: Record<string, unknown> }) | null;
}

const DET_CSV = [
  { key: "qid", label: "QID" }, { key: "title", label: "Vulnérabilité" }, { key: "severity", label: "Sévérité" }, { key: "statusLabel", label: "Statut" },
  { key: "firstFound", label: "Première détection" }, { key: "lastFound", label: "Dernière détection" }, { key: "overdueLabel", label: "Hors délai" },
  { key: "qds", label: "QDS" }, { key: "cvss3", label: "CVSS v3" }, { key: "cves", label: "CVE" }, { key: "threats", label: "Menaces" },
  { key: "port", label: "Port" }, { key: "category", label: "Catégorie" }, { key: "solution", label: "Solution" },
];

const threatText = (flags: number) => [flags & FLAGS.kev && "CISA KEV", flags & FLAGS.ransomware && "Ransomware", flags & FLAGS.activeAttacks && "Attaques actives", flags & FLAGS.exploitPublic && "Exploit public"].filter(Boolean).join(", ");

function AssetBody({ hostId }: { readonly hostId: number }) {
  const ctx = useQualysCtx();
  const q = useQuery({ queryKey: ["qualys-asset", hostId], queryFn: () => callQualys<AssetDetail>({ action: "asset", hostId }), staleTime: 10 * 60_000 });
  const [sev, setSev] = useState<number | null>(null);
  const [threat, setThreat] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [showList, setShowList] = useState(false);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.detections ?? [])
      .filter((d) => (sev === null || d.severity === sev) && (!threat || d.flags & (FLAGS.kev | FLAGS.ransomware | FLAGS.activeAttacks | FLAGS.exploitPublic))
        && (status === null || (status === "overdue" ? d.overdue : d.status === status))
        && (!s || `${d.title} ${d.qid} ${d.cves.join(" ")}`.toLowerCase().includes(s)))
      .sort((a, b) => b.severity - a.severity || Number(b.overdue) - Number(a.overdue) || (b.cvss3 ?? 0) - (a.cvss3 ?? 0));
  }, [q.data, sev, threat, status, search]);

  if (q.isLoading) return <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Chargement de la fiche…</div>;
  if (q.error) return <p className="text-sm text-destructive py-6">{(q.error as Error).message}</p>;
  const d = q.data!;
  const a = d.asset;
  const all = d.detections;
  const count = (f: (x: Detection) => boolean) => all.filter(f).length;
  const chip = (active: boolean) => `text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  const csam = d.csam;
  return (
    <div className="space-y-5 pt-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Type"><Badge tone={TYPE_TONE[a.asset_type as AssetType]}>{ASSET_TYPE_LABELS[a.asset_type as AssetType]}</Badge></Field>
        <Field label="Adresse IP"><span className="font-mono">{a.ip ?? "—"}</span>{a.public_ip && <> <Badge tone="red">IP publique</Badge></>}</Field>
        <Field label="Système">{a.os}</Field>
        <Field label="Nom NetBIOS">{a.netbios}</Field>
        <Field label="TruRisk"><b className={a.trurisk !== null && a.trurisk >= 850 ? "text-red-600" : ""}>{fmt(a.trurisk)}</b> <span className="text-xs text-muted-foreground">{TIER_LABELS[truTier(a.trurisk)]}</span></Field>
        <Field label="Criticité de l'actif">{a.criticality ? `${a.criticality} / 5` : "Non renseignée"}</Field>
        <Field label="Suivi">{hasAgent(a) ? "Agent Qualys" : a.tracking ?? "—"}</Field>
        <Field label="Dernier scan">{fmtDate(a.last_scan)} <span className="text-xs text-muted-foreground">({SCAN_LABELS[scanState(a)].toLowerCase()})</span></Field>
        <Field label="Dernière activité">{fmtDate(a.last_activity)}</Field>
        <Field label="Identifiant Qualys"><span className="font-mono text-xs">{a.host_id}{a.asset_id ? ` · actif ${a.asset_id}` : ""}</span></Field>
      </div>
      {a.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1">Tags</span>
          {a.tags.map((t) => (
            <button key={t} type="button" title="Filtrer la page sur ce tag" onClick={() => ctx?.setFilters((f) => ({ ...f, tag: [...new Set([...(f.tag ?? []), t])] }))}
              className="text-[11px] px-1.5 py-0.5 rounded bg-muted hover:bg-primary/10">{t}</button>
          ))}
        </div>
      )}

      {csam && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="text-xs font-bold">Inventaire CSAM</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Agent">{csam.has_agent ? `Oui · dernier contact ${fmtDate(csam.agent_last_checkin as string | null)}` : "Non"}</Field>
            <Field label="Cycle de vie du système">{(csam.lifecycle_stage as string) || "—"}</Field>
            <Field label="Fin de support">{fmtDate(csam.eos as string | null)}</Field>
            <Field label="Matériel">{(csam.hardware as string) || "—"}</Field>
            <Field label="Découvert le">{fmtDate(csam.created as string | null)}</Field>
            <Field label="Sources">{(csam.sources as string) || "—"}</Field>
          </div>
          <RawAttributes attrs={csam.attrs} title="Tous les attributs CSAM" />
        </div>
      )}
      <RawAttributes attrs={a.attrs} title="Tous les attributs VMDR" />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="text-sm font-bold"><FoldTitle open={showList} onToggle={() => setShowList(!showList)}>Vulnérabilités ({fmt(all.length)})
            {!showList && <span className="text-xs font-normal text-muted-foreground">{count((x) => x.severity === 5 && !x.ignored)} critiques · {count((x) => x.overdue)} hors délai · {count((x) => Boolean(x.flags & (FLAGS.kev | FLAGS.ransomware | FLAGS.activeAttacks | FLAGS.exploitPublic)))} exploitables</span>}</FoldTitle></div>
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`qualys-${a.name ?? a.host_id}-vulnerabilites.csv`, toCsv(list.map((x) => ({
            ...x, statusLabel: DETECTION_STATUS[x.status] ?? x.status, overdueLabel: x.overdue ? "Oui" : "Non", threats: threatText(x.flags),
          })), DET_CSV))}><Download className="w-4 h-4" /> Exporter</Button>
        </div>
        {showList && <><div className="flex flex-wrap gap-1.5">
          {[5, 4, 3].map((s) => <button key={s} type="button" className={chip(sev === s)} onClick={() => setSev(sev === s ? null : s)}>Sévérité {s} ({count((x) => x.severity === s && !x.ignored)})</button>)}
          <button type="button" className={chip(threat)} onClick={() => setThreat(!threat)}>Exploitables ({count((x) => Boolean(x.flags & (FLAGS.kev | FLAGS.ransomware | FLAGS.activeAttacks | FLAGS.exploitPublic)))})</button>
          <button type="button" className={chip(status === "overdue")} onClick={() => setStatus(status === "overdue" ? null : "overdue")}>Hors délai ({count((x) => x.overdue)})</button>
          {(["N", "R", "I"] as const).map((s) => <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(status === s ? null : s)}>{DETECTION_STATUS[s]}s ({count((x) => x.status === s)})</button>)}
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Titre, QID, CVE…" className="h-7 w-48 text-xs" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vulnérabilité</TableHead>
                <TableHead className="text-center">Sév.</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="whitespace-nowrap">Détectée le</TableHead>
                <TableHead className="text-right">CVSS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.slice(0, limit).map((x, i) => (
                <Fragment key={`${x.qid}-${x.port}-${i}`}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === i ? null : i)}>
                    <TableCell className="py-1.5 max-w-[380px]">
                      <div className="text-sm font-medium truncate" title={x.title ?? ""}>{x.title ?? `QID ${x.qid}`}</div>
                      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center">
                        <span className="font-mono">QID {x.qid}{x.port ? ` · port ${x.port}` : ""}</span> <FlagBadges flags={x.flags} compact />
                      </div>
                    </TableCell>
                    <TableCell className="text-center py-1.5"><Badge tone={sevTone(x.severity)}>{x.severity}</Badge></TableCell>
                    <TableCell className="py-1.5 text-xs whitespace-nowrap">{DETECTION_STATUS[x.status] ?? x.status}{x.overdue && <> · <span className="text-red-600 font-semibold">hors délai</span></>}</TableCell>
                    <TableCell className="py-1.5 text-xs whitespace-nowrap">{fmtDate(x.firstFound)}</TableCell>
                    <TableCell className="py-1.5 text-right text-xs">{x.cvss3 ?? "—"}</TableCell>
                  </TableRow>
                  {open === i && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/30 text-xs space-y-1.5 py-2">
                        {x.cves.length > 0 && <div><b>CVE :</b> <span className="font-mono">{x.cves.join(", ")}</span></div>}
                        {x.category && <div><b>Catégorie :</b> {x.category}</div>}
                        <div><b>Dernière détection :</b> {fmtDate(x.lastFound)} · <b>QDS :</b> {x.qds || "—"}{x.patchPublished && <> · <b>Correctif publié le</b> {fmtDate(x.patchPublished)}</>}</div>
                        {x.solution && <div className="whitespace-pre-line"><b>Solution :</b> {x.solution}</div>}
                        <button type="button" className="text-primary underline" onClick={(e) => { e.stopPropagation(); ctx?.openVuln(x.qid); }}>Voir tous les actifs touchés</button>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
        {list.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE * 2)}>Afficher plus ({fmt(list.length - limit)} restantes)</Button>}</>}
      </div>
    </div>
  );
}

export function AssetSheet({ asset, onClose }: { readonly asset: { host_id: number; name: string | null } | null; readonly onClose: () => void }) {
  return (
    <Sheet open={Boolean(asset)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{asset?.name ?? "Actif"}</SheetTitle>
          <SheetDescription>Fiche de l&apos;actif d&apos;après le dernier calcul : caractéristiques, inventaire et vulnérabilités ouvertes.</SheetDescription>
        </SheetHeader>
        {asset && <AssetBody hostId={asset.host_id} />}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Fiche vulnérabilité : description et actifs touchés
// ---------------------------------------------------------------------------

interface VulnDetail {
  date: string;
  kb: Record<string, unknown> | null;
  hosts: (Partial<DAsset> & { host_id: number; firstFound: string | null; lastFound: string | null; status: string; qds: number; ignored: boolean; overdue: boolean; port: number | null })[];
}

const VULN_HOST_CSV = [
  { key: "name", label: "Actif" }, { key: "ip", label: "Adresse IP" }, { key: "os", label: "Système" }, { key: "typeLabel", label: "Type" },
  { key: "trurisk", label: "TruRisk" }, { key: "criticality", label: "Criticité" }, { key: "statusLabel", label: "Statut" },
  { key: "firstFound", label: "Première détection" }, { key: "lastFound", label: "Dernière détection" }, { key: "overdueLabel", label: "Hors délai" },
  { key: "port", label: "Port" }, { key: "tags", label: "Tags" },
];

function VulnBody({ qid }: { readonly qid: number }) {
  const ctx = useQualysCtx();
  const q = useQuery({ queryKey: ["qualys-vuln", qid], queryFn: () => callQualys<VulnDetail>({ action: "vuln", qid }), staleTime: 10 * 60_000 });
  const [search, setSearch] = useState("");
  const [type, setType] = useState<AssetType | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [showList, setShowList] = useState(false);
  const hosts = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.hosts ?? []).filter((h) => (!type || h.asset_type === type) && (!overdue || h.overdue)
      && (!s || `${h.name} ${h.ip} ${h.os} ${(h.tags ?? []).join(" ")}`.toLowerCase().includes(s)))
      .sort((a, b) => (b.trurisk ?? 0) - (a.trurisk ?? 0));
  }, [q.data, search, type, overdue]);
  if (q.isLoading) return <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Chargement…</div>;
  if (q.error) return <p className="text-sm text-destructive py-6">{(q.error as Error).message}</p>;
  const k = (q.data?.kb ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => {
    if (typeof x === "string") return x || null;
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    return null;
  };
  const list = (x: unknown) => (Array.isArray(x) ? x : []) as unknown[];
  const all = q.data?.hosts ?? [];
  const chip = (active: boolean) => `text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Badge tone={sevTone(Number(k.severity))}>Sévérité {str(k.severity) ?? "—"}</Badge>
        <FlagBadges flags={Number(k.flags ?? 0)} />
        {str(k.cvss3) && <Badge tone="muted">CVSS v3 {str(k.cvss3)}</Badge>}
        {str(k.category) && <Badge tone="muted">{str(k.category)}</Badge>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Publiée le">{fmtDate(str(k.published))}</Field>
        <Field label="Correctif publié le">{fmtDate(str(k.patch_published))}</Field>
        <Field label="Produits">{list(k.products).map((p) => (Array.isArray(p) ? p.filter(Boolean).join(" ") : str(p) ?? "")).filter(Boolean).join(", ") || "—"}</Field>
        <Field label="Type">{str(k.vuln_type)}</Field>
      </div>
      {list(k.cves).length > 0 && <div className="text-xs"><b>CVE :</b> <span className="font-mono">{list(k.cves).join(", ")}</span></div>}
      {list(k.threats).length > 0 && <div className="text-xs"><b>Renseignement sur la menace :</b> {list(k.threats).map((t) => String(t).replace(/_/g, " ")).join(", ")}</div>}
      {str(k.consequence) && <div className="text-xs whitespace-pre-line"><b>Conséquence :</b> {str(k.consequence)}</div>}
      {str(k.solution) && <div className="text-xs whitespace-pre-line rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2"><b>Solution :</b> {str(k.solution)}</div>}
      {str(k.diagnosis) && <details className="text-xs"><summary className="cursor-pointer font-semibold">Diagnostic Qualys</summary><p className="whitespace-pre-line pt-1">{str(k.diagnosis)}</p></details>}
      {list(k.vendor_refs).length > 0 && <div className="text-xs"><b>Références éditeur :</b> {list(k.vendor_refs).join(", ")}</div>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="text-sm font-bold"><FoldTitle open={showList} onToggle={() => setShowList(!showList)}>Actifs touchés ({fmt(all.length)})
            {!showList && <span className="text-xs font-normal text-muted-foreground">{all.filter((h) => h.asset_type === "server").length} serveurs · {all.filter((h) => h.overdue).length} hors délai</span>}</FoldTitle></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => ctx?.setFilters((f) => ({ ...f, qid }))} title="Restreindre toute la page aux actifs touchés"><Filter className="w-4 h-4" /> Filtrer la page</Button>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`qualys-qid-${qid}-actifs.csv`, toCsv(hosts.map((h) => ({
              ...h, typeLabel: h.asset_type ? ASSET_TYPE_LABELS[h.asset_type] : "", statusLabel: DETECTION_STATUS[h.status] ?? h.status, overdueLabel: h.overdue ? "Oui" : "Non",
            })), VULN_HOST_CSV))}><Download className="w-4 h-4" /> Exporter</Button>
          </div>
        </div>
        {showList && <><div className="flex flex-wrap gap-1.5">
          {(["server", "workstation", "other"] as const).map((t) => <button key={t} type="button" className={chip(type === t)} onClick={() => setType(type === t ? null : t)}>{ASSET_TYPE_LABELS[t]} ({all.filter((h) => h.asset_type === t).length})</button>)}
          <button type="button" className={chip(overdue)} onClick={() => setOverdue(!overdue)}>Hors délai ({all.filter((h) => h.overdue).length})</button>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, IP, système, tag…" className="h-7 w-48 text-xs" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Actif</TableHead>
                <TableHead className="text-right">TruRisk</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="whitespace-nowrap">Détectée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hosts.slice(0, limit).map((h, i) => (
                <TableRow key={`${h.host_id}-${h.port}-${i}`} className="cursor-pointer hover:bg-muted/50" onClick={() => ctx?.openAsset(h.host_id)}>
                  <TableCell className="py-1.5 max-w-[360px]">
                    <div className="text-sm font-medium truncate">{h.name ?? h.ip ?? h.host_id}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{h.asset_type && <Badge tone={TYPE_TONE[h.asset_type]}>{ASSET_TYPE_LABELS[h.asset_type]}</Badge>} <span className="font-mono">{h.ip}</span> · {h.os}</div>
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-semibold">{fmt(h.trurisk ?? null)}</TableCell>
                  <TableCell className="py-1.5 text-xs whitespace-nowrap">{DETECTION_STATUS[h.status] ?? h.status}{h.overdue && <> · <span className="text-red-600 font-semibold">hors délai</span></>}</TableCell>
                  <TableCell className="py-1.5 text-xs whitespace-nowrap">{fmtDate(h.firstFound)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {hosts.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE * 2)}>Afficher plus ({fmt(hosts.length - limit)} restants)</Button>}</>}
      </div>
    </div>
  );
}

export function VulnSheet({ vuln, onClose }: { readonly vuln: { qid: number; title?: string | null } | null; readonly onClose: () => void }) {
  return (
    <Sheet open={Boolean(vuln)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-6">{vuln?.title || `Vulnérabilité ${vuln?.qid ?? ""}`}</SheetTitle>
          <SheetDescription>QID {vuln?.qid} · description Qualys, solution et actifs touchés d&apos;après le dernier calcul.</SheetDescription>
        </SheetHeader>
        {vuln && <VulnBody qid={vuln.qid} />}
      </SheetContent>
    </Sheet>
  );
}
