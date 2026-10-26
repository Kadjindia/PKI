import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Globe2, Crown, UserMinus, KeyRound, Archive, FolderOpen, Users,
  RefreshCw, Loader2, AlertTriangle, Info, Clock,
} from "lucide-react";
import {
  formatCount, formatBytes, share, sourceLabel, snapshotProgress, formatAge, inactiveTotal, zoneTotal,
  allUnauthorized, shortError, displayPath, INACTIVE_DAYS, INACTIVE_BUCKETS, formatElapsed,
  type PostureResults, type PostureState,
} from "@/lib/varonisPosture";

// La posture est calculée côté serveur (tâche planifiée chaque nuit, ou à la
// demande) et enregistrée : l'écran lit la dernière photo terminée. Pendant un
// calcul, l'écran revient toutes les 20 s, ce qui fait aussi avancer le calcul.
const RUNNING_POLL_MS = 20_000;

async function callPosture(action: "posture-status" | "posture-refresh"): Promise<PostureState> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body: { action } });
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
const formatDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "jamais");

/** État d'une requête : chargement, erreur ou contenu. */
function Status({ r, children }: {
  readonly r?: { status: string; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string };
  readonly children: React.ReactNode;
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
  return (
    <>
      {children}
      {r.carriedFrom && (
        <div className="text-[11px] text-amber-600 mt-1" title={r.lastError}>
          Valeur du {formatDateTime(r.carriedFrom)} : le dernier calcul n&apos;a pas abouti pour cet indicateur
        </div>
      )}
    </>
  );
}

/** Définition d'un indicateur, au clic sur ⓘ (fonctionne aussi sur tablette). */
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

type KpiValue = { status: string; count?: number; capped?: boolean; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string };

/** Chiffre clé : titre court, grand nombre, une ligne de contexte, définition dans ⓘ. */
function Kpi({ title, help, icon: Icon, color, r, sub }: {
  readonly title: string; readonly help: React.ReactNode; readonly icon: typeof Info; readonly color: string;
  readonly r?: KpiValue; readonly sub?: React.ReactNode;
}) {
  const ok = r?.status === "done" && (r.count ?? 0) === 0;
  return (
    <Card className={`border-l-4 ${color}`}>
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

/** Pastille d'un point à traiter. */
function Chip({ children, tone = "orange" }: { readonly children: React.ReactNode; readonly tone?: "orange" | "red" }) {
  const cls = tone === "red" ? "bg-red-500/10 text-red-600" : "bg-orange-500/10 text-orange-600";
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

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

/** Ligne « dossier » : nom, source, chemin, taille et points à traiter. */
function FolderRow({ name, path, source, size, chips }: {
  readonly name?: string | null; readonly path: string; readonly source?: string | null; readonly size?: number | null; readonly chips: React.ReactNode;
}) {
  const label = sourceLabel(source);
  return (
    <li className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate flex items-center gap-2" title={name ?? ""}>
          <span className="truncate">{name ?? "—"}</span>
          {label && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{label}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground font-mono truncate" title={path}>{path}</div>
      </div>
      <div className="flex flex-wrap justify-end gap-1 max-w-[50%]">{chips}</div>
      <div className="text-sm font-semibold text-foreground w-16 text-right shrink-0">{formatBytes(size)}</div>
    </li>
  );
}

export default function VaronisPosturePanel() {
  const queryClient = useQueryClient();
  const { data: state, error, isLoading } = useQuery({
    queryKey: ["varonis-posture"],
    queryFn: () => callPosture("posture-status"),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? RUNNING_POLL_MS : false),
  });
  const refresh = useMutation({
    mutationFn: () => callPosture("posture-refresh"),
    onSuccess: (next) => queryClient.setQueryData(["varonis-posture"], next),
  });

  const latest = state?.latest ?? null;
  const running = state?.running ?? null;
  // Sans photo terminée, on montre la photo en cours (les blocs se remplissent au fur et à mesure)
  const r: PostureResults = latest?.results ?? running?.results ?? {};

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
  // Dossiers sensibles : ceux qui cumulent le plus de points à traiter d'abord, puis les plus gros
  const issues = (z: { isStale: boolean; staleAccess: boolean; ownerIssue: boolean }) => Number(z.isStale) + Number(z.staleAccess) + Number(z.ownerIssue);
  const priority = [...(zones?.top ?? [])].sort((a, b) => issues(b) - issues(a) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const zoneList = useShowMore(priority);
  const exposedList = useShowMore(exposed?.top);
  const [showAdmins, setShowAdmins] = useState(false);
  const errorMessage = (refresh.error ?? error) as Error | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-foreground flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" /> Posture des données
          </h3>
          <p className="text-sm text-muted-foreground">
            Où sont les données sensibles, qui peut y accéder, et l&apos;hygiène des comptes et des droits
          </p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {latest
              ? <>Photo du {formatDateTime(latest.started_at)} ({formatAge(latest.finished_at ?? latest.started_at)}) · {latest.trigger === "schedule" ? "calcul automatique de la nuit" : "calcul demandé"}</>
              : isLoading ? "Chargement…" : "Aucune photo terminée pour l'instant"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={isLoading || refresh.isPending || Boolean(running)}
          title={running ? "Un calcul est déjà en cours" : "Recalculer la posture maintenant (quelques minutes)"}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${refresh.isPending || running ? "animate-spin" : ""}`} /> Recalculer
        </button>
      </div>

      {running && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-1 text-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Calcul en cours depuis {formatElapsed(now - new Date(running.started_at).getTime())} : {snapshotProgress(running.results).done} / {snapshotProgress(running.results).total} recherches terminées
            </div>
            <p className="text-muted-foreground">
              Les recherches Varonis sont lancées quelques-unes à la fois pour ne pas dépasser la limite de requêtes : comptez de quelques minutes à une demi-heure.
              {latest && ` Les chiffres affichés restent ceux du ${formatDateTime(latest.started_at)} jusqu'à la fin du calcul.`}
              {state?.scheduled ? " Vous pouvez quitter la page : le calcul continue sur le serveur." : " Gardez la page ouverte pour que le calcul avance."}
            </p>
            {running.last_error && <p className="text-amber-600">{running.last_error}</p>}
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
            La posture n&apos;a encore jamais été calculée. Cliquez sur « Recalculer » pour lancer le premier calcul.
          </CardContent>
        </Card>
      )}

      {allUnauthorized(r) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-5 space-y-2 text-sm">
            <div className="flex items-center gap-2 font-bold text-amber-600">
              <AlertTriangle className="w-5 h-5" /> La clé d&apos;API Varonis n&apos;a pas accès aux données de posture
            </div>
            <p className="text-foreground">
              Elle permet de lire les alertes, mais Varonis refuse la lecture des ressources, identités, appartenances et permissions
              (« AUTH_NOT_AUTHORIZED »). Ce n&apos;est pas un problème de l&apos;application.
            </p>
            <p className="text-muted-foreground">
              À demander à l&apos;administrateur Varonis : étendre le rôle associé à la clé d&apos;API utilisée par le tableau de bord
              (secret <code>VARONIS_API_KEY</code>) à la <b>lecture</b> des ressources (classification, exposition), des identités,
              des appartenances aux groupes et des permissions. Aucun droit d&apos;écriture n&apos;est nécessaire.
            </p>
          </CardContent>
        </Card>
      )}

      {/* CHIFFRES CLÉS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          title="Dossiers sensibles ouverts à tous"
          help={<>
            Dossiers contenant des données sensibles (personnelles, financières, RH…) accessibles à <b>tous les salariés</b> :
            soit par un droit « Tout le monde » / « Utilisateurs du domaine », soit, sur SharePoint et OneDrive, par un
            <b> lien de partage « toute personne de l&apos;organisation »</b>. Dans ce cas, quiconque reçoit le lien ouvre le
            document, même si l&apos;adresse du site lui reste fermée. C&apos;est le premier risque de fuite.
          </>}
          icon={Globe2}
          color="border-l-red-500"
          r={exposed}
          sub={exposed?.status === "done" && `dont ${formatCount(exposed.withoutValidOwner)} sans responsable`}
        />
        <Kpi
          title="Données sensibles inutilisées"
          help={<>Partages et dossiers personnels contenant des données sensibles que <b>plus personne n&apos;ouvre ni ne modifie</b> (durée réglée dans Varonis). À archiver ou supprimer : moins de données, moins de risque.</>}
          icon={Archive}
          color="border-l-amber-500"
          r={r.zonesStale}
          sub={r.zonesStale?.status === "done" && `dossiers · ${formatBytes(r.zonesStale.sizeBytes)} à archiver`}
        />
        <Kpi
          title="Droits inutilisés"
          help={<>Partages et dossiers personnels sensibles où des personnes ont <b>un droit d&apos;accès dont elles ne se servent jamais</b> (ancien poste, projet terminé…). À retirer : si l&apos;un de ces comptes est piraté, les données sont exposées.</>}
          icon={KeyRound}
          color="border-l-orange-500"
          r={r.zonesStaleAccess}
          sub={r.zonesStaleAccess?.status === "done" && (zones.status === "done"
            ? `dossiers sensibles sur ${formatCount(zones.count, zones.capped)} (${share(r.zonesStaleAccess.count, zones.count) ?? 0} %)`
            : "dossiers sensibles")}
        />
        <Kpi
          title="Administrateurs inactifs"
          help={<>Comptes administrateurs <b>encore activés</b> mais sans connexion depuis plus de {INACTIVE_DAYS} jours. Personne ne les surveille : ce sont des cibles de choix. À désactiver ou justifier.</>}
          icon={Crown}
          color="border-l-violet-500"
          r={priv && { ...priv, count: priv.status === "done" ? priv.stale : undefined }}
          sub={priv?.status === "done" && `sur ${formatCount(priv.admins)} administrateurs`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* DOSSIERS SENSIBLES À TRAITER */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" /> Dossiers sensibles à traiter en priorité
            </CardTitle>
            <p className="text-xs text-muted-foreground">Partages et dossiers personnels (ex. D:\Shares\Partage_Finance, D:\Users\ALEX)</p>
          </CardHeader>
          <CardContent>
            {/* Chiffres de référence : total et propriétaires */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: "Contenant des données sensibles", value: zones, help: <>Partages et dossiers personnels où la classification Varonis a trouvé des données sensibles (personnelles, financières, RH…).</> },
                { label: "Propriétaire inactif", value: r.zonesStaleOwner, help: <>Dossiers sensibles dont le propriétaire <b>ne se connecte plus</b> : plus personne pour valider qui y a accès.</> },
                { label: "Propriétaire désactivé", value: r.zonesDisabledOwner, help: <>Dossiers sensibles dont le propriétaire a un <b>compte désactivé</b> (départ, mutation) : à réattribuer.</> },
              ].map(({ label, value, help }) => (
                <div key={label} className="rounded-lg bg-muted/50 p-2.5">
                  <div className="flex items-start justify-between gap-1 text-[11px] font-semibold text-muted-foreground">
                    <span>{label}</span><Help>{help}</Help>
                  </div>
                  <Status r={value}>
                    <div className="text-xl font-black text-foreground">{formatCount(value?.count, value?.capped)}</div>
                  </Status>
                </div>
              ))}
            </div>
            <Status r={zones}>
              {priority.length === 0 ? (
                <p className="text-sm text-emerald-600 py-2">Aucun dossier contenant des données sensibles.</p>
              ) : (
                <>
                  <ul>
                    {zoneList.visible.map((z, i) => (
                      <FolderRow
                        key={`${displayPath(z)}-${i}`}
                        name={z.name} path={displayPath(z)} source={z.source} size={z.sizeBytes}
                        chips={issues(z) === 0
                          ? <span className="text-[11px] text-muted-foreground">Rien à signaler</span>
                          : <>
                              {z.isStale && <Chip>Données inutilisées</Chip>}
                              {z.staleAccess && <Chip>Droits inutilisés</Chip>}
                              {z.staleOwner && <Chip tone="red">Propriétaire inactif</Chip>}
                              {z.disabledOwner && <Chip tone="red">Propriétaire désactivé</Chip>}
                              {z.ownerIssue && z.staleOwner === undefined && <Chip tone="red">Sans responsable</Chip>}
                            </>}
                      />
                    ))}
                  </ul>
                  {zoneList.toggle}
                </>
              )}
            </Status>
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
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <UserMinus className="w-4 h-4" /> Comptes activés inactifs
                </span>
                <Help>Comptes <b>encore activés</b> sans connexion depuis plus de {INACTIVE_DAYS} jours, par ancienneté. À désactiver en commençant par les plus anciens.</Help>
              </div>
              {inactiveUnreliable ? (
                <p className="text-sm text-amber-600 mt-1">
                  Chiffre non fiable : Varonis a plafonné la recherche. Correction en cours.
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
                <dt className="text-muted-foreground">Administrateurs</dt>
                <dd className="font-semibold"><Status r={priv}>{formatCount(priv?.admins)}</Status></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Comptes de service</dt>
                <dd className="font-semibold"><Status r={priv}>{formatCount(priv?.services)}</Status></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Comptes expirés encore actifs</dt>
                <dd className="font-semibold"><Status r={r.expiredEnabled}>{formatCount(r.expiredEnabled?.count)}</Status></dd>
              </div>
            </dl>

            {(priv?.staleList?.length ?? 0) > 0 && (
              <div>
                <button type="button" onClick={() => setShowAdmins(!showAdmins)} className="text-xs font-semibold text-primary hover:underline">
                  {showAdmins ? "Masquer" : "Voir"} les administrateurs inactifs
                </button>
                {showAdmins && (
                  <ul className="mt-2 space-y-1">
                    {priv!.staleList!.map((u, i) => (
                      <li key={`${u.name}-${i}`} className="flex justify-between gap-3 text-xs">
                        <span className="font-mono truncate text-foreground" title={u.name ?? ""}>{u.name}</span>
                        <span className="text-muted-foreground shrink-0">{formatDay(u.lastLogonTime)}</span>
                      </li>
                    ))}
                    {(priv!.stale ?? 0) > priv!.staleList!.length && (
                      <li className="text-[11px] text-muted-foreground">… et {formatCount((priv!.stale ?? 0) - priv!.staleList!.length)} autres</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DOSSIERS OUVERTS À TOUS */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-red-500" /> Dossiers sensibles ouverts à tous : les plus volumineux
          </CardTitle>
          <p className="text-xs text-muted-foreground">Retirer l&apos;accès « tout le monde » en commençant par ceux-ci</p>
        </CardHeader>
        <CardContent>
          <Status r={exposed}>
            {(exposed?.top?.length ?? 0) === 0 ? (
              <p className="text-sm text-emerald-600 py-2">Aucun dossier sensible ouvert à tous.</p>
            ) : (
              <>
                <ul>
                  {exposedList.visible.map((f, i) => (
                    <FolderRow
                      key={`${displayPath(f)}-${i}`}
                      name={f.name} path={displayPath(f)} source={f.source} size={f.sizeBytes}
                      chips={<>
                        {f.ownerIssue && <Chip tone="red">Sans responsable</Chip>}
                        {f.isStale && <Chip>Données inutilisées</Chip>}
                      </>}
                    />
                  ))}
                </ul>
                {exposedList.toggle}
              </>
            )}
          </Status>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Chiffres exacts calculés par Varonis. Cliquez sur ⓘ pour la définition de chaque indicateur.
        {state?.scheduled ? " Mise à jour automatique chaque nuit." : ""}
      </p>
    </div>
  );
}
