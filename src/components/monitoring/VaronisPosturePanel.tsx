import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VaronisPostureHistory from "./VaronisPostureHistory";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Globe2, Crown, UserMinus, KeyRound, Archive, FolderOpen, Users, X,
  Loader2, AlertTriangle, Info,
} from "lucide-react";
import {
  formatCount, formatBytes, share, sourceLabel, snapshotProgress, inactiveTotal, zoneTotal, priorityZones, mergeRunning,
  allUnauthorized, shortError, displayPath, INACTIVE_DAYS, INACTIVE_BUCKETS, formatElapsed,
  type PostureResults, type PostureState, type ZoneIssueKey, type ZoneResult, type InventoryList,
} from "@/lib/varonisPosture";

// La posture est calculée côté serveur par la tâche planifiée de la nuit et
// enregistrée : l'écran lit la dernière photo terminée. Pendant un calcul,
// l'écran revient toutes les 20 s pour afficher chaque chiffre dès qu'il est prêt.
const RUNNING_POLL_MS = 20_000;

async function fetchPosture(): Promise<PostureState> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body: { action: "posture-status" } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data as PostureState;
}

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** État d'une requête : chargement, erreur ou contenu (quiet : sans les mentions de date, pour les blocs compacts). */
function Status({ r, children, quiet = false }: {
  readonly r?: { status: string; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string; fresh?: boolean; doneAt?: string };
  readonly children: React.ReactNode;
  readonly quiet?: boolean;
}) {
  if (!r) return <span className="text-sm text-muted-foreground">—</span>;
  if (r.status === "queued" || r.status === "pending") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {r.status === "queued" ? "En attente…" : `En cours${r.progress ? ` (${Math.round(r.progress)} %)` : "…"}`}
      </span>
    );
  }
  if (r.status === "error") {
    return <span className="text-sm font-medium text-destructive" title={r.error}>{shortError(r)}</span>;
  }
  if (quiet) return <>{children}</>;
  return (
    <>
      {children}
      {r.fresh && r.doneAt && (
        <div className="text-[11px] text-emerald-600 mt-1">Mis à jour à {new Date(r.doneAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} (calcul en cours)</div>
      )}
      {r.carriedFrom && (
        <div className={`text-[11px] mt-1 ${r.lastError ? "text-amber-600" : "text-muted-foreground"}`} title={r.lastError}>
          Valeur du {formatDateTime(r.carriedFrom)}{r.lastError ? " : le dernier calcul n'a pas abouti pour cet indicateur" : ""}
        </div>
      )}
    </>
  );
}

/** Définition d'un indicateur, au clic sur ⓘ (fonctionne aussi sur tablette). */
function Help({ children }: { readonly children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger aria-label="Définition" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground shrink-0">
        <Info className="w-4 h-4" />
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-relaxed">{children}</PopoverContent>
    </Popover>
  );
}

type KpiValue = { status: string; count?: number; capped?: boolean; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string; fresh?: boolean; doneAt?: string };

/** Chiffre clé : titre court, grand nombre, une ligne de contexte, définition dans ⓘ. */
function Kpi({ title, help, icon: Icon, color, r, sub, onClick, active }: {
  readonly title: string; readonly help: React.ReactNode; readonly icon: typeof Info; readonly color: string;
  readonly r?: KpiValue; readonly sub?: React.ReactNode; readonly onClick?: () => void; readonly active?: boolean;
}) {
  const ok = r?.status === "done" && (r.count ?? 0) === 0;
  return (
    <Card
      className={`border-l-4 ${color} ${onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""} ${active ? "ring-2 ring-primary/60" : ""}`}
      onClick={onClick}
      title={onClick ? "Cliquer pour afficher le détail" : undefined}
    >
      <CardContent className="p-4 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Icon className="w-4 h-4 shrink-0" /> {title}
          </div>
          <Help>{help}</Help>
        </div>
        <Status r={r}>
          <div className={`text-3xl font-black ${ok ? "text-emerald-600" : "text-foreground"}`}>{formatCount(r?.count, r?.capped)}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </Status>
      </CardContent>
    </Card>
  );
}

/** Pastille d'un signal sur un dossier. */
function Chip({ children, tone = "orange" }: { readonly children: React.ReactNode; readonly tone?: "orange" | "red" }) {
  const cls = tone === "red" ? "bg-red-500/10 text-red-600" : "bg-orange-500/10 text-orange-600";
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

/** Problèmes des dossiers sensibles : libellé, colonne du tableau et définition. */
const ZONE_ISSUES: { key: ZoneIssueKey; label: string; short: string; flag: "isStale" | "staleAccess" | "staleOwner" | "disabledOwner"; color: string; owners?: InventoryList; help: React.ReactNode }[] = [
  { key: "zonesStale", label: "Données inutilisées", short: "Inutilisées", flag: "isStale", color: "bg-amber-500", help: <>Plus personne n&apos;ouvre ni ne modifie ces données depuis longtemps.</> },
  { key: "zonesStaleAccess", label: "Droits inutilisés", short: "Droits", flag: "staleAccess", color: "bg-orange-500", help: <>Des personnes ont un droit d&apos;accès qu&apos;elles n&apos;utilisent jamais.</> },
  { key: "zonesStaleOwner", label: "Propriétaire inactif", short: "Propr. inactif", flag: "staleOwner", color: "bg-red-500", owners: "ownersStale", help: <>Le propriétaire du dossier ne se connecte plus.</> },
  { key: "zonesDisabledOwner", label: "Propriétaire désactivé", short: "Propr. désactivé", flag: "disabledOwner", color: "bg-red-700", owners: "ownersDisabled", help: <>Le propriétaire du dossier a un compte désactivé (départ, mutation…).</> },
];
const ZONE_VIEWS = Object.fromEntries(ZONE_ISSUES.map((i) => [i.key, i.label])) as Record<ZoneIssueKey, string>;

/** Liste courte (5 lignes) avec un bouton pour afficher le reste. */
function useShowMore<T>(items: T[] | undefined, initial = 5) {
  const [all, setAll] = useState(false);
  const list = items ?? [];
  return {
    visible: all ? list : list.slice(0, initial),
    toggle: list.length > initial
      ? <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-primary hover:underline mt-2">
          {all ? "Afficher moins" : `Afficher les ${list.length}`}
        </button>
      : null,
  };
}

/** Cellule « dossier » : nom, type de source et chemin. */
function FolderCell({ name, path, source }: { readonly name?: string | null; readonly path: string; readonly source?: string | null }) {
  const label = sourceLabel(source);
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium flex items-center gap-2" title={name ?? ""}>
        <span className="truncate">{name ?? "—"}</span>
        {label && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{label}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground font-mono truncate" title={path}>{path}</div>
    </div>
  );
}

const formatDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

export default function VaronisPosturePanel({ onOpenInventory }: { readonly onOpenInventory?: (list: InventoryList) => void } = {}) {
  // Ouvre l'inventaire des comptes sur une liste (sinon, ne fait rien)
  const inventory = (list: InventoryList) => (e?: React.MouseEvent) => { e?.stopPropagation(); onOpenInventory?.(list); };
  const { data: state, error, isLoading } = useQuery({
    queryKey: ["varonis-posture"],
    queryFn: fetchPosture,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? RUNNING_POLL_MS : false),
  });

  const latest = state?.latest ?? null;
  const running = state?.running ?? null;
  // Sans photo terminée, on montre la photo en cours (les blocs se remplissent au fur et à mesure)
  // Pendant un calcul : chaque indicateur terminé remplace aussitôt l'ancien
  const r: PostureResults = mergeRunning(latest?.results, running?.results);

  // Horloge pour la durée du calcul en cours
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const exposed = r.sensitiveExposed;
  // Total des dossiers sensibles (une recherche par source de données) et les plus volumineux
  const zones = zoneTotal(r);
  const priv = r.privileged;
  const inactive = inactiveTotal(r);
  // Une tranche plafonnée par Varonis ne donne pas un chiffre fiable : on ne l'affiche pas
  const inactiveUnreliable = INACTIVE_BUCKETS.some((b) => r[b.key]?.status === "done" && r[b.key]?.capped);
  const inactiveStatus = INACTIVE_BUCKETS.map((b) => r[b.key]).find((x) => !x || x.status !== "done");
  // Dossiers sensibles : ceux qui cumulent le plus de problèmes d'abord, puis les plus gros
  const priority = priorityZones(r);
  // Clic sur une barre ou un chiffre : le tableau montre les dossiers de ce cas
  const [zoneView, setZoneView] = useState<ZoneIssueKey | null>(null);
  const showZones = (v: ZoneIssueKey | null) => {
    setZoneView((cur) => (cur === v ? null : v));
    zonesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const viewResult: ZoneResult | undefined = zoneView ? r[zoneView] : zones;
  const listItems = zoneView ? (r[zoneView]?.top ?? []) : priority;
  const zoneList = useShowMore(listItems);
  const zonesRef = useRef<HTMLDivElement>(null);
  const exposedRef = useRef<HTMLDivElement>(null);
  const exposedList = useShowMore(exposed?.top);
  const errorMessage = error as Error | null;

  return (
    <div className="space-y-6">
      <div>
          <h3 className="text-xl font-black text-foreground flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" /> Posture des données
          </h3>
      </div>

      {running && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-1 text-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Calcul en cours depuis {formatElapsed(now - new Date(running.started_at).getTime())} : {snapshotProgress(running.results).done} / {snapshotProgress(running.results).total} recherches terminées
            </div>
          </CardContent>
        </Card>
      )}

      {errorMessage && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {errorMessage.message}
          </CardContent>
        </Card>
      )}

      {!isLoading && !latest && !running && !error && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            La posture n&apos;a encore jamais été calculée : elle le sera automatiquement la nuit prochaine.
          </CardContent>
        </Card>
      )}

      {allUnauthorized(r) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-5 space-y-2 text-sm">
            <div className="flex items-center gap-2 font-bold text-amber-600">
              <AlertTriangle className="w-5 h-5" /> La clé d&apos;API Varonis n&apos;a pas accès aux données de posture
            </div>
            <p className="text-muted-foreground">
              Varonis refuse la lecture des dossiers et des comptes au tableau de bord. À signaler à l&apos;administrateur Varonis :
              le rôle de la clé d&apos;API doit inclure la <b>lecture</b> des ressources, des identités, des groupes et des permissions.
            </p>
          </CardContent>
        </Card>
      )}

      {/* CHIFFRES CLÉS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          title="Dossiers sensibles ouverts à tous"
          help={<>Dossiers contenant des données sensibles que <b>tous les salariés</b> peuvent ouvrir : droit « Tout le monde » ou « Utilisateurs du domaine », ou lien de partage valable pour toute l&apos;organisation (SharePoint, OneDrive).</>}
          icon={Globe2}
          color="border-l-red-500"
          r={exposed}
          sub={exposed?.status === "done" && `dont ${formatCount(exposed.withoutValidOwner)} sans responsable`}
          onClick={() => exposedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
        <Kpi
          title="Données sensibles inutilisées"
          help={<>Dossiers contenant des données sensibles que <b>plus personne n&apos;ouvre ni ne modifie</b> depuis longtemps (durée définie dans Varonis).</>}
          icon={Archive}
          color="border-l-amber-500"
          r={r.zonesStale}
          onClick={() => showZones("zonesStale")}
          active={zoneView === "zonesStale"}
          sub={r.zonesStale?.status === "done" && `dossiers · ${formatBytes(r.zonesStale.sizeBytes)}`}
        />
        <Kpi
          title="Droits inutilisés"
          help={<>Dossiers sensibles où des personnes ont un <b>droit d&apos;accès qu&apos;elles n&apos;utilisent jamais</b>.</>}
          icon={KeyRound}
          color="border-l-orange-500"
          r={r.zonesStaleAccess}
          onClick={() => showZones("zonesStaleAccess")}
          active={zoneView === "zonesStaleAccess"}
          sub={r.zonesStaleAccess?.status === "done" && (zones.status === "done"
            ? `dossiers sensibles sur ${formatCount(zones.count, zones.capped)} (${share(r.zonesStaleAccess.count, zones.count) ?? 0} %)`
            : "dossiers sensibles")}
        />
        <Kpi
          title="Administrateurs inactifs"
          help={<>Comptes administrateurs <b>encore activés</b> sans connexion depuis plus de {INACTIVE_DAYS} jours, ou sans aucune connexion connue.</>}
          icon={Crown}
          color="border-l-violet-500"
          r={priv && { ...priv, count: priv.status === "done" ? priv.stale : undefined }}
          onClick={inventory("adminsInactive")}
          sub={priv?.status === "done" && `sur ${formatCount(priv.admins)} administrateurs`}
        />
      </div>

      {/* ÉVOLUTION DANS LE TEMPS */}
      <VaronisPostureHistory />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* DOSSIERS SENSIBLES À TRAITER */}
        <Card className="lg:col-span-2 scroll-mt-4" ref={zonesRef}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" /> Dossiers sensibles à traiter
              </CardTitle>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Status r={zones} quiet>
                  <span><b className="text-foreground">{formatCount(zones.count, zones.capped)}</b> dossiers sensibles · {formatBytes(zones.sizeBytes)}</span>
                </Status>
                <Help>Partages et dossiers personnels dans lesquels Varonis a détecté des données sensibles (personnelles, financières, RH…).</Help>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Part des dossiers sensibles concernés par chaque problème */}
            <div className="space-y-1">
              {ZONE_ISSUES.map((issue) => {
                const v = r[issue.key];
                const pct = v?.status === "done" ? share(v.count, zones.count) : null;
                return (
                  <div
                    key={issue.key}
                    onClick={() => showZones(issue.key)}
                    title="Cliquer pour afficher ces dossiers"
                    className={`grid grid-cols-[150px_1fr_210px] items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 ${zoneView === issue.key ? "ring-2 ring-primary/60 bg-muted/40" : ""} ${zoneView && zoneView !== issue.key ? "opacity-50" : ""}`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      {issue.label} <Help>{issue.help}</Help>
                    </span>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${issue.color}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                    </div>
                    <span className="text-xs text-right whitespace-nowrap">
                      <Status r={v} quiet>
                        <b className="text-foreground">{formatCount(v?.count, v?.capped)}</b>
                        <span className="text-muted-foreground">{pct !== null ? ` · ${pct} %` : ""} · {formatBytes(v?.sizeBytes)}</span>
                        {issue.owners && onOpenInventory && (
                          <button type="button" onClick={inventory(issue.owners)} className="ml-2 font-semibold text-primary hover:underline">propriétaires →</button>
                        )}
                      </Status>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Dossiers : problèmes cumulés, ou les plus gros d'un problème */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-bold text-muted-foreground uppercase">
                  {zoneView ? `${ZONE_VIEWS[zoneView]} : les plus volumineux` : "Dossiers cumulant le plus de problèmes"}
                </span>
                {zoneView && (
                  <button type="button" onClick={() => setZoneView(null)} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20">
                    {ZONE_VIEWS[zoneView]} <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <Status r={viewResult} quiet>
                {listItems.length === 0 ? (
                  <p className="text-sm py-2 text-emerald-600">{zoneView ? "Aucun dossier dans ce cas." : "Aucun dossier sensible à traiter."}</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Dossier</TableHead>
                            <TableHead className="text-right">Volume</TableHead>
                            {ZONE_ISSUES.map((issue) => (
                              <TableHead key={issue.key} className="text-center whitespace-nowrap text-[11px] px-2" title={issue.label}>{issue.short}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {zoneList.visible.map((z, i) => (
                            <TableRow key={`${displayPath(z)}-${i}`}>
                              <TableCell className="max-w-[320px] py-2"><FolderCell name={z.name} path={displayPath(z)} source={z.source} /></TableCell>
                              <TableCell className="text-right text-sm font-semibold whitespace-nowrap py-2">{formatBytes(z.sizeBytes)}</TableCell>
                              {ZONE_ISSUES.map((issue) => (
                                <TableCell key={issue.key} className="text-center px-2 py-2">
                                  {z[issue.flag]
                                    ? <span className={`inline-block w-2.5 h-2.5 rounded-full ${issue.color}`} title={issue.label} />
                                    : <span className="text-muted-foreground/40">·</span>}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {zoneList.toggle}
                  </>
                )}
              </Status>
            </div>
          </CardContent>
        </Card>

        {/* COMPTES */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-500" /> Comptes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={inventory("inactive")} disabled={!onOpenInventory} title="Voir la liste des comptes" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 hover:text-foreground hover:underline">
                  <UserMinus className="w-4 h-4" /> Comptes activés inactifs
                </button>
                <Help>Comptes <b>encore activés</b> sans connexion depuis plus de {INACTIVE_DAYS} jours, répartis par ancienneté.</Help>
              </div>
              {inactiveUnreliable ? (
                <p className="text-sm text-amber-600 mt-1">
                  Chiffre indisponible pour ce calcul : il sera recalculé la nuit prochaine.
                </p>
              ) : (
              <Status r={inactiveStatus ?? { status: "done" }}>
                <div className="text-2xl font-black text-foreground">{formatCount(inactive.count, inactive.capped)}</div>
                <div className="mt-2 space-y-1.5">
                  {INACTIVE_BUCKETS.map(({ key, label }) => {
                    const n = r[key]?.count ?? 0;
                    return (
                      <div key={key} className="grid grid-cols-[112px_1fr_56px] items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-sky-500" style={{ width: `${(n / Math.max(1, inactive.count ?? 1)) * 100}%` }} />
                        </div>
                        <span className="text-right font-semibold">{formatCount(n, r[key]?.capped)}</span>
                      </div>
                    );
                  })}
                </div>
              </Status>
              )}
            </div>

            <dl className="border-t border-border pt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground cursor-pointer hover:text-foreground hover:underline" onClick={inventory("admins")} title="Voir la liste des administrateurs">Administrateurs</dt>
                <dd className="font-semibold"><Status r={priv}>{formatCount(priv?.admins)}</Status></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground cursor-pointer hover:text-foreground hover:underline" onClick={inventory("services")} title="Voir la liste des comptes de service">Comptes de service</dt>
                <dd className="font-semibold"><Status r={priv}>{formatCount(priv?.services)}</Status></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground cursor-pointer hover:text-foreground hover:underline" onClick={inventory("expired")} title="Voir la liste des comptes expirés">Comptes expirés encore actifs</dt>
                <dd className="font-semibold"><Status r={r.expiredEnabled}>{formatCount(r.expiredEnabled?.count)}</Status></dd>
              </div>
            </dl>

          </CardContent>
        </Card>
      </div>

      {/* DOSSIERS OUVERTS À TOUS */}
      <Card ref={exposedRef} className="scroll-mt-4">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-red-500" /> Dossiers sensibles ouverts à tous
            </CardTitle>
            {exposed?.status === "done" && (exposed.top?.length ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">
                {(exposed.count ?? 0) > (exposed.top?.length ?? 0)
                  ? <>Les {exposed.top!.length} contenant le plus de fichiers, sur <b className="text-foreground">{formatCount(exposed.count, exposed.capped)}</b></>
                  : <><b className="text-foreground">{formatCount(exposed.count)}</b> dossier{(exposed.count ?? 0) > 1 ? "s" : ""}</>}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Status r={exposed} quiet>
            {(exposed?.top?.length ?? 0) === 0 ? (
              <p className="text-sm text-emerald-600 py-2">Aucun dossier sensible ouvert à tous.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dossier</TableHead>
                        <TableHead className="text-right">Fichiers</TableHead>
                        <TableHead className="text-right">Volume</TableHead>
                        <TableHead className="whitespace-nowrap">Dernière activité</TableHead>
                        <TableHead>Signaux</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exposedList.visible.map((f, i) => (
                        <TableRow key={`${displayPath(f)}-${i}`}>
                          <TableCell className="max-w-[360px] py-2"><FolderCell name={f.name} path={displayPath(f)} source={f.source} /></TableCell>
                          <TableCell className="text-right text-sm font-semibold whitespace-nowrap py-2">{formatCount(f.objects ?? undefined)}</TableCell>
                          <TableCell className="text-right text-sm whitespace-nowrap py-2">{formatBytes(f.sizeBytes)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap py-2">{formatDay(f.lastEventDate)}</TableCell>
                          <TableCell className="py-2 space-x-1 whitespace-nowrap">
                            {f.ownerIssue && <Chip tone="red">Sans responsable</Chip>}
                            {f.isStale && <Chip>Données inutilisées</Chip>}
                            {!f.ownerIssue && !f.isStale && <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {exposedList.toggle}
              </>
            )}
          </Status>
        </CardContent>
      </Card>
    </div>
  );
}
