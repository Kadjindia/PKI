import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Globe2, UserX, Crown, UserMinus, CalendarX, KeyRound, Archive, FolderOpen, Server,
  RefreshCw, Loader2, AlertTriangle, ExternalLink, Info, Clock,
} from "lucide-react";
import {
  formatCount, formatBytes, share, safeUrl, snapshotProgress, formatAge, inactiveTotal,
  allUnauthorized, shortError, displayPath, INACTIVE_DAYS, INACTIVE_BUCKETS, ZONE_DEPTH, formatElapsed,
  POSTURE_KEYS, type PostureResults, type PostureState, type ZoneTotals,
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

function Kpi({ title, help, icon: Icon, color, r, sub }: {
  readonly title: string; readonly help: string; readonly icon: typeof Info; readonly color: string;
  readonly r?: { status: string; count?: number; capped?: boolean; error?: string; code?: string; field?: string; progress?: number | null; carriedFrom?: string; lastError?: string };
  readonly sub?: React.ReactNode;
}) {
  const alarming = r?.status !== "done" || (r.count ?? 0) > 0;
  return (
    <Card className={`border-l-4 ${color}`}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      </CardHeader>
      <p className="px-6 -mt-1 mb-2 text-[11px] text-muted-foreground leading-snug">{help}</p>
      <CardContent>
        <Status r={r}>
          <div className={`text-3xl font-black ${alarming ? "text-foreground" : "text-emerald-600"}`}>{formatCount(r?.count, r?.capped)}</div>
          {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
        </Status>
      </CardContent>
    </Card>
  );
}

/** Indicateur oui/non d'un dossier : orange si problème. */
function Flag({ on, label }: { readonly on: boolean; readonly label: string }) {
  return on
    ? <span className="text-xs font-semibold text-orange-600">{label}</span>
    : <span className="text-xs text-muted-foreground">Non</span>;
}

/** Volume d'un ensemble de dossiers : « 1,2 To · 350 000 fichiers ». */
const volume = (t?: ZoneTotals) => (t ? `${formatBytes(t.sizeBytes)} · ${t.files.toLocaleString("fr-FR")} fichiers` : "");

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
  const zones = r.zones;
  const priv = r.privileged;
  const inactive = inactiveTotal(r);
  const inactiveStatus = INACTIVE_BUCKETS.map((b) => r[b.key]).find((x) => !x || x.status !== "done");
  const zonePart = (part?: ZoneTotals) => zones && { ...zones, count: zones.status === "done" ? part?.count : undefined };
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
          title="Dossiers sensibles ouverts à tous"
          help="Dossiers contenant des données sensibles que tous les salariés peuvent ouvrir (groupe « Tout le monde », « Utilisateurs du domaine »…)."
          icon={Globe2}
          color="border-l-red-500"
          r={exposed}
          sub={exposed?.status === "done" && <>dont <b className="text-foreground">{formatCount(exposed.withoutValidOwner)}</b> sans responsable actif</>}
        />
        <Kpi
          title="Données sensibles qui ne servent plus"
          help="Partages et dossiers personnels contenant des données sensibles que plus personne n'ouvre ni ne modifie."
          icon={Archive}
          color="border-l-amber-500"
          r={zonePart(zones?.stale)}
          sub={zones?.status === "done" && <>
            dossiers sur {formatCount(zones.count)} contenant des données sensibles ({share(zones.stale?.count, zones.count) ?? 0} %) · {volume(zones.stale)} : à archiver ou supprimer
          </>}
        />
        <Kpi
          title="Droits inutilisés sur des données sensibles"
          help="Partages et dossiers personnels sensibles où des personnes ont un droit d'accès dont elles ne se servent jamais."
          icon={KeyRound}
          color="border-l-orange-500"
          r={zonePart(zones?.staleAccess)}
          sub={zones?.status === "done" && <>dossiers sur {formatCount(zones.count)} ({share(zones.staleAccess?.count, zones.count) ?? 0} %) : droits à retirer pour réduire le risque de fuite</>}
        />
        <Kpi
          title="Administrateurs actifs"
          help="Comptes administrateurs encore activés : ceux qui ne se connectent plus sont des cibles faciles."
          icon={Crown}
          color="border-l-violet-500"
          r={priv && { ...priv, count: priv.status === "done" ? priv.admins : undefined }}
          sub={priv?.status === "done" && <>dont <b className={priv.stale ? "text-red-500" : "text-foreground"}>{formatCount(priv.stale)}</b> sans connexion depuis {INACTIVE_DAYS} j</>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ZONES SENSIBLES */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" /> Partages et dossiers personnels contenant des données sensibles
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Ex. D:\Shares\Partage_Finance, D:\Users\ALEX — les 15 plus volumineux
              {zones?.status === "done" && <> sur {formatCount(zones.count)} · {volume(zones as ZoneTotals)} au total</>}
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <Status r={zones}>
              {(zones?.top?.length ?? 0) === 0 ? (
                <p className="text-sm text-emerald-600 py-4">Aucun partage ni dossier personnel contenant des données sensibles.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dossier</TableHead>
                        <TableHead className="text-right">Taille</TableHead>
                        <TableHead className="text-right">Fichiers</TableHead>
                        <TableHead title="Contient des données que plus personne n'ouvre ni ne modifie">Données qui ne servent plus</TableHead>
                        <TableHead title="Des personnes ont un droit d'accès dont elles ne se servent jamais">Droits inutilisés</TableHead>
                        <TableHead title="Responsable du dossier (propriétaire) encore actif">Responsable</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {zones!.top!.map((z, i) => (
                        <TableRow key={`${displayPath(z)}-${i}`}>
                          <TableCell className="max-w-[280px]">
                            <div className="font-medium truncate" title={z.name ?? ""}>{z.name ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate" title={z.path ?? ""}>{displayPath(z)}</div>
                          </TableCell>
                          <TableCell className="text-right text-sm whitespace-nowrap">{formatBytes(z.sizeBytes)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{(z.files ?? 0).toLocaleString("fr-FR")}</TableCell>
                          <TableCell><Flag on={z.isStale} label="Oui" /></TableCell>
                          <TableCell><Flag on={z.staleAccess} label="Oui" /></TableCell>
                          <TableCell>{z.ownerIssue ? <span className="text-xs font-semibold text-orange-600">À désigner</span> : <span className="text-xs text-muted-foreground">OK</span>}</TableCell>
                          <TableCell>
                            {safeUrl(z.url) && (
                              <a href={safeUrl(z.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
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
              <Crown className="w-4 h-4 text-violet-500" /> Comptes à privilèges (activés)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <Status r={priv}>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-border">
                  <div className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> Administrateurs</div>
                  <div className="text-2xl font-black text-foreground">{formatCount(priv?.admins)}</div>
                  <div className="text-[11px] text-muted-foreground">dont {formatCount(priv?.stale)} inactifs</div>
                </div>
                <div className="p-3 rounded-xl border border-border">
                  <div className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Comptes de service</div>
                  <div className="text-2xl font-black text-foreground">{formatCount(priv?.services)}</div>
                  <div className="text-[11px] text-muted-foreground">dont {formatCount(priv?.servicesStale)} sans connexion depuis {INACTIVE_DAYS} j</div>
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">
                  Administrateurs sans connexion depuis plus de {INACTIVE_DAYS} jours — à désactiver ou justifier
                </p>
                {(priv?.staleList ?? []).length === 0 ? (
                  <p className="text-sm text-emerald-600">Aucun administrateur inactif.</p>
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
                {(priv?.stale ?? 0) > (priv?.staleList?.length ?? 0) && (
                  <p className="text-[11px] text-muted-foreground mt-1">… et {formatCount((priv!.stale ?? 0) - priv!.staleList!.length)} autres</p>
                )}
              </div>
            </Status>
          </CardContent>
        </Card>
      </div>

        {/* DOSSIERS SENSIBLES EXPOSÉS */}
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-red-500" /> Dossiers sensibles ouverts à tous les salariés
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">Les 10 plus volumineux : retirer l&apos;accès « tout le monde » en priorité</p>
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
                        <TableHead className="text-right">Fichiers et dossiers</TableHead>
                        <TableHead className="text-right">Taille</TableHead>
                        <TableHead>Responsable</TableHead>
                        <TableHead>Ne sert plus</TableHead>
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


      {/* HYGIÈNE DES COMPTES */}
      <Card>
        <CardHeader className="pb-2 border-b border-border/50">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
            <UserMinus className="w-4 h-4 text-sky-500" /> Hygiène des comptes et des propriétaires
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-border lg:col-span-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <UserMinus className="w-4 h-4" /> Comptes activés sans connexion depuis plus de {INACTIVE_DAYS} jours
            </div>
            <div className="mt-2">
              <Status r={inactiveStatus ?? { status: "done" }}>
                <span className="text-2xl font-black text-foreground">{formatCount(inactive.count, inactive.capped)}</span>
                <div className="mt-3 space-y-2">
                  {INACTIVE_BUCKETS.map(({ key, label }) => {
                    const n = r[key]?.count ?? 0;
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground">{label}</span>
                          <span className="font-bold">{formatCount(n, r[key]?.capped)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-sky-500" style={{ width: `${(n / Math.max(1, inactive.count ?? 1)) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Status>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Comptes toujours activés : à désactiver en priorité à partir des plus anciens</p>
          </div>
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <CalendarX className="w-4 h-4" /> Comptes expirés encore actifs
              </div>
              <div className="mt-2">
                <Status r={r.expiredEnabled}>
                  <span className="text-2xl font-black text-foreground">{formatCount(r.expiredEnabled?.count, r.expiredEnabled?.capped)}</span>
                </Status>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Date d&apos;expiration passée, compte toujours activé</p>
            </div>
            <div className="p-4 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <UserX className="w-4 h-4" /> Dossiers sensibles sans responsable actif
              </div>
              <div className="mt-2">
                <Status r={zonePart(zones?.ownerIssue)}>
                  <span className="text-2xl font-black text-foreground">{formatCount(zones?.ownerIssue?.count)}</span>
                </Status>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Partages et dossiers personnels sensibles dont le propriétaire a quitté l&apos;entreprise ou ne se connecte plus : personne pour valider qui y a accès</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Chiffres exacts calculés par Varonis. « Données sensibles » : contenu repéré par la classification Varonis (données personnelles, financières, RH…).
        Les dossiers comptés sont les partages métier et les dossiers personnels (niveau {ZONE_DEPTH} : D:\Shares\…, D:\Users\…), pas chacun de leurs sous-dossiers.
        « Ne servent plus » et « droits inutilisés » suivent la durée d&apos;inactivité configurée dans Varonis. Comptes inactifs : comptes activés sans connexion depuis plus de {INACTIVE_DAYS} jours.
        {state?.scheduled ? " La posture est recalculée automatiquement chaque nuit." : ""} Chaque photo est conservée pour suivre l&apos;évolution dans le temps.
      </p>
    </div>
  );
}
