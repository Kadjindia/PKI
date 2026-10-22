import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Globe2, UserX, Crown, UserMinus, CalendarX, Users, KeyRound, Archive, FolderOpen,
  RefreshCw, Loader2, AlertTriangle, ExternalLink, Info,
} from "lucide-react";
import {
  formatCount, formatBytes, privilegedLabel, share, safeUrl, mergePosture, pendingJobs,
  POSTURE_KEYS, type PostureResults, type PostureKey,
} from "@/lib/varonisPosture";

// Les requêtes de posture peuvent prendre plusieurs minutes : on les lance,
// puis on revérifie les jobs encore en cours toutes les 5 s (10 min au maximum).
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

async function callPosture(body: Record<string, unknown>): Promise<PostureResults> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body: { action: "posture", ...body } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return (data?.results ?? {}) as PostureResults;
}

async function fetchPosture(onProgress: (r: PostureResults) => void): Promise<PostureResults> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let results = await callPosture({});
  onProgress(results);
  while (Object.keys(pendingJobs(results)).length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    results = mergePosture(results, await callPosture({ jobs: pendingJobs(results) }));
    onProgress(results);
  }
  return results;
}

const formatDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "jamais");

/** État d'une requête : chargement, erreur ou contenu. */
function Status({ r, children }: { readonly r?: { status: string; error?: string; progress?: number | null }; readonly children: React.ReactNode }) {
  if (!r || r.status === "pending") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> En cours{r?.progress ? ` (${Math.round(r.progress)} %)` : "…"}
      </span>
    );
  }
  if (r.status === "error") {
    return <span className="text-xs text-destructive break-all" title={r.error}>Indisponible : {r.error}</span>;
  }
  return <>{children}</>;
}

function Kpi({ title, icon: Icon, color, r, sub }: {
  readonly title: string; readonly icon: typeof Info; readonly color: string;
  readonly r?: { status: string; count?: number; capped?: boolean; error?: string; progress?: number | null };
  readonly sub?: React.ReactNode;
}) {
  const alarming = r?.status === "done" && (r.count ?? 0) > 0;
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
  { key: "staleUsers", label: "Comptes inactifs encore activés", help: "Comptes sans activité récente mais non désactivés", icon: UserMinus },
  { key: "expiredEnabled", label: "Comptes expirés encore actifs", help: "Date d'expiration passée, compte toujours activé", icon: CalendarX },
  { key: "staleMemberships", label: "Appartenances obsolètes", help: "Membres de groupes qui n'utilisent plus cet accès", icon: Users },
  { key: "stalePermissions", label: "Permissions inutilisées", help: "Droits jamais utilisés : candidats au retrait", icon: KeyRound },
];

export default function VaronisPosturePanel() {
  const [live, setLive] = useState<PostureResults>({});
  const { data, error, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["varonis-posture"],
    queryFn: () => fetchPosture(setLive),
    staleTime: 1000 * 60 * 60, // la posture évolue lentement : 1 h de cache
    retry: false,
  });
  const r: PostureResults = data ?? live;
  const done = POSTURE_KEYS.filter((k) => r[k] && r[k]!.status !== "pending").length;

  const exposed = r.sensitiveExposed;
  const sensitive = r.sensitive;
  const priv = r.privileged;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-foreground flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" /> Posture des données
          </h3>
          <p className="text-sm text-muted-foreground">
            Où sont les données sensibles, qui peut y accéder, et l&apos;hygiène des comptes et des droits — photo à l&apos;instant T
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isFetching
              ? `Interrogation de Varonis : ${done} / ${POSTURE_KEYS.length} indicateurs prêts (peut prendre plusieurs minutes)`
              : dataUpdatedAt ? `Données du ${new Date(dataUpdatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setLive({}); refetch(); }}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
        </button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {(error as Error).message}
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
          r={sensitive && { ...sensitive, count: sensitive.withoutValidOwner }}
          sub={sensitive?.status === "done" && <>sur {formatCount(sensitive.count, sensitive.capped)} ressources sensibles ({share(sensitive.withoutValidOwner, sensitive.count) ?? 0} %)</>}
        />
        <Kpi
          title="Données sensibles obsolètes"
          icon={Archive}
          color="border-l-amber-500"
          r={sensitive && { ...sensitive, count: sensitive.stale }}
          sub={sensitive?.status === "done" && <>non consultées depuis longtemps : à archiver ou supprimer ({share(sensitive.stale, sensitive.count) ?? 0} %)</>}
        />
        <Kpi
          title="Comptes privilégiés actifs"
          icon={Crown}
          color="border-l-violet-500"
          r={priv}
          sub={priv?.status === "done" && <>dont <b className={priv.stale ? "text-red-500" : "text-foreground"}>{formatCount(priv.stale)}</b> inactifs</>}
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
                        <TableRow key={`${f.path}-${i}`}>
                          <TableCell className="max-w-[320px]">
                            <div className="font-medium truncate" title={f.name ?? ""}>{f.name ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate" title={f.path ?? ""}>{f.path}</div>
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
                  Inactifs mais toujours actifs ({formatCount(priv?.stale)}) — à désactiver ou justifier
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
        Indicateurs calculés par Varonis (classification, exposition, activité). L&apos;API renvoie au plus 10 000 résultats par requête :
        au-delà, le total est affiché « ou plus ». L&apos;évolution dans le temps nécessitera d&apos;enregistrer ces chiffres régulièrement.
      </p>
    </div>
  );
}
