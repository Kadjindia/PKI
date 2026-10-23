import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Globe2, UserX, Crown, UserMinus, CalendarX, Users, KeyRound, Archive, FolderOpen,
  RefreshCw, Loader2, AlertTriangle, ExternalLink, Info, Clock,
} from "lucide-react";
import {
  formatCount, formatBytes, privilegedLabel, share, safeUrl, snapshotProgress, formatAge,
  allUnauthorized, shortError, sumCounts, displayPath, INACTIVE_DAYS, formatElapsed,
  POSTURE_KEYS, type PostureResults, type PostureKey, type PostureState,
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

function Kpi({ title, icon: Icon, color, r, sub }: {
  readonly title: string; readonly icon: typeof Info; readonly color: string;
  readonly r?: { status: string; count?: number; capped?: boolean; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string };
  readonly sub?: React.ReactNode;
}) {
  const alarming = r?.status !== "done" || (r.count ?? 0) > 0;
  return (
    <Card className={`border-l-4 ${color}`}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <Status r={r}>
          <div className={`text-3xl font-black ${alarming ? "text-foreground" : "text-emerald-600"}`}>{formatCount(r?.count, r?.capped)}</div>
          {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
        </Status>
      </CardContent>
    </Card>
  );
}

const HYGIENE: { key: PostureKey; label: string; help: string; icon: typeof Info }[] = [
  { key: "staleUsers", label: "Comptes inactifs encore activés", help: `Aucune connexion depuis plus de ${INACTIVE_DAYS} jours, compte toujours activé`, icon: UserMinus },
  { key: "expiredEnabled", label: "Comptes expirés encore actifs", help: "Date d'expiration passée, compte toujours activé", icon: CalendarX },
  { key: "staleMemberships", label: "Appartenances obsolètes", help: "Membres de groupes qui n'utilisent plus cet accès", icon: Users },
  { key: "stalePermissions", label: "Permissions inutilisées", help: "Droits jamais utilisés : candidats au retrait", icon: KeyRound },
];

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
  const sensitive = r.sensitive;
  const ownerless = sumCounts(r.sensitiveStaleOwner, r.sensitiveDisabledOwner);
  const ownerStatus = [r.sensitiveStaleOwner, r.sensitiveDisabledOwner].find((x) => !x || x.status !== "done") ?? r.sensitiveStaleOwner;
  const priv = r.privileged;
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
              Calcul en cours depuis {formatElapsed(now - new Date(running.started_at).getTime())} : {snapshotProgress(running.results)} / {POSTURE_KEYS.length} indicateurs prêts
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

      {/* INDICATEURS CLÉS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          title="Dossiers sensibles ouverts à toute l'organisation"
          icon={Globe2}
          color="border-l-red-500"
          r={exposed}
          sub={exposed?.status === "done" && <>dont <b className="text-foreground">{formatCount(exposed.withoutValidOwner)}</b> sans propriétaire valide</>}
        />
        <Kpi
          title="Ressources sensibles sans propriétaire valide"
          icon={UserX}
          color="border-l-orange-500"
          r={ownerStatus && { ...ownerStatus, status: ownerless.count === undefined ? ownerStatus.status : "done", count: ownerless.count, capped: ownerless.capped }}
          sub={ownerless.count !== undefined && <>
            propriétaire inactif : {formatCount(r.sensitiveStaleOwner?.count, r.sensitiveStaleOwner?.capped)} · désactivé : {formatCount(r.sensitiveDisabledOwner?.count, r.sensitiveDisabledOwner?.capped)}
          </>}
        />
        <Kpi
          title="Données sensibles obsolètes"
          icon={Archive}
          color="border-l-amber-500"
          r={r.sensitiveStale}
          sub={r.sensitiveStale?.status === "done" && <>
            non consultées depuis longtemps : à archiver ou supprimer
            {sensitive?.status === "done" && !sensitive.capped && !r.sensitiveStale.capped && ` (${share(r.sensitiveStale.count, sensitive.count) ?? 0} % des ${formatCount(sensitive.count)} ressources sensibles)`}
          </>}
        />
        <Kpi
          title="Comptes privilégiés actifs"
          icon={Crown}
          color="border-l-violet-500"
          r={priv}
          sub={priv?.status === "done" && <>dont <b className={priv.stale ? "text-red-500" : "text-foreground"}>{formatCount(priv.stale)}</b> sans connexion depuis {INACTIVE_DAYS} j</>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* DOSSIERS SENSIBLES EXPOSÉS */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-red-500" /> Dossiers sensibles ouverts à toute l&apos;organisation
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">Les 10 plus volumineux — à restreindre en priorité</p>
          </CardHeader>
          <CardContent className="pt-2">
            <Status r={exposed}>
              {(exposed?.top?.length ?? 0) === 0 ? (
                <p className="text-sm text-emerald-600 py-4">Aucun dossier sensible ouvert à toute l&apos;organisation.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dossier</TableHead>
                        <TableHead className="text-right">Objets</TableHead>
                        <TableHead className="text-right">Taille</TableHead>
                        <TableHead>Propriétaire</TableHead>
                        <TableHead>Obsolète</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exposed!.top!.map((f, i) => (
                        <TableRow key={`${displayPath(f)}-${i}`}>
                          <TableCell className="max-w-[320px]">
                            <div className="font-medium truncate" title={f.name ?? ""}>{f.name ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate" title={f.path ?? ""}>{displayPath(f)}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{(f.objects ?? 0).toLocaleString("fr-FR")}</TableCell>
                          <TableCell className="text-right text-sm whitespace-nowrap">{formatBytes(f.sizeBytes)}</TableCell>
                          <TableCell className="text-sm">{f.ownerIssue ? <span className="text-orange-600 font-semibold">À désigner</span> : "OK"}</TableCell>
                          <TableCell className="text-sm">{f.isStale ? "Oui" : "Non"}</TableCell>
                          <TableCell>
                            {safeUrl(f.url) && (
                              <a href={safeUrl(f.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                                <ExternalLink className="w-3.5 h-3.5" /> Ouvrir
                              </a>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Status>
          </CardContent>
        </Card>

        {/* COMPTES PRIVILÉGIÉS */}
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <Crown className="w-4 h-4 text-violet-500" /> Comptes privilégiés actifs
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <Status r={priv}>
              <div className="space-y-2">
                {(priv?.byType ?? []).map((t) => (
                  <div key={t.type} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground">{privilegedLabel(t.type)}</span>
                      <span className="font-bold">{t.count.toLocaleString("fr-FR")}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-violet-500" style={{ width: `${(t.count / Math.max(1, priv?.byType?.[0]?.count ?? 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">
                  Sans connexion depuis plus de {INACTIVE_DAYS} jours ({formatCount(priv?.stale)}) — à désactiver ou justifier
                </p>
                {(priv?.staleList ?? []).length === 0 ? (
                  <p className="text-sm text-emerald-600">Aucun compte privilégié inactif.</p>
                ) : (
                  <ul className="space-y-1">
                    {priv!.staleList!.map((u, i) => (
                      <li key={`${u.name}-${i}`} className="flex justify-between gap-3 text-xs">
                        <span className="font-mono truncate text-foreground" title={u.name ?? ""}>{u.name}</span>
                        <span className="text-muted-foreground shrink-0">dernière connexion : {formatDay(u.lastLogonTime)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Status>
          </CardContent>
        </Card>
      </div>

      {/* HYGIÈNE DES ACCÈS */}
      <Card>
        <CardHeader className="pb-2 border-b border-border/50">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-500" /> Hygiène des comptes et des droits (moindre privilège)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HYGIENE.map(({ key, label, help, icon: Icon }) => {
            const item = r[key];
            return (
              <div key={key} className="p-4 rounded-xl border border-border">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Icon className="w-4 h-4" /> {label}
                </div>
                <div className="mt-2">
                  <Status r={item}>
                    <span className="text-2xl font-black text-foreground">{formatCount(item?.count, item?.capped)}</span>
                  </Status>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{help}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Indicateurs calculés par Varonis (classification, exposition, activité). L&apos;API limite le nombre de résultats par requête
        (10 000 à 15 000) : un total suivi de « ou plus » est un minimum. Comptes inactifs : aucune connexion depuis plus de {INACTIVE_DAYS} jours.
        {state?.scheduled ? " La posture est recalculée automatiquement chaque nuit." : ""} Chaque photo est conservée pour suivre l&apos;évolution dans le temps.
      </p>
    </div>
  );
}
