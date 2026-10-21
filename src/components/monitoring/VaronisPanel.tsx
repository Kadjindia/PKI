import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, AlertOctagon, Database, Bell, RefreshCw, Loader2, AlertTriangle, Inbox,
} from "lucide-react";
import {
  summarizeAlerts, normalizeSeverity, formatStatus, alertDate, isOpen,
  SEVERITY_LABELS, type SeverityLevel, type VaronisProxyResponse,
} from "@/lib/varonis";

const SEVERITY_STYLES: Record<SeverityLevel, { bar: string; badge: string }> = {
  high: { bar: "bg-red-500", badge: "bg-red-500/15 text-red-600 border-red-500/30" },
  medium: { bar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  low: { bar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  unknown: { bar: "bg-muted-foreground/40", badge: "bg-muted text-muted-foreground border-border" },
};

// Le job Varonis peut durer plusieurs minutes : la fonction le lance et répond
// tout de suite avec son identifiant, puis on l'interroge toutes les 3 s.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function callVaronisProxy(body: { jobId?: string }): Promise<VaronisProxyResponse> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body });
  if (error) {
    // On remonte le message renvoyé par la fonction plutôt que l'erreur générique
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data as VaronisProxyResponse;
}

async function fetchVaronisAlerts(onProgress: (progress: number | null) => void): Promise<VaronisProxyResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let res = await callVaronisProxy({});
  while (res.status === "pending" && res.jobId) {
    onProgress(typeof res.jobProgress === "number" ? res.jobProgress : null);
    if (Date.now() > deadline) {
      throw new Error("Varonis n'a pas terminé la préparation des alertes en 5 minutes. Réessayez plus tard.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    res = await callVaronisProxy({ jobId: res.jobId });
  }
  onProgress(null);
  return res;
}

const formatDate = (d: Date | null) =>
  d ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function VaronisPanel() {
  const [progress, setProgress] = useState<number | null>(null);
  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["varonis-alerts"],
    queryFn: () => fetchVaronisAlerts(setProgress),
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 15,
    retry: false,
  });

  const summary = useMemo(() => summarizeAlerts(data?.alerts ?? []), [data]);

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" /> Varonis — Alertes de sécurité des données
        </h2>
        <p className="text-sm text-muted-foreground">
          {dataUpdatedAt ? `Dernière synchronisation : ${formatDate(new Date(dataUpdatedAt))}` : "Données en direct depuis Varonis"}
          {data?.jobStatus === "PARTIAL_RESULTS" && " · résultats partiels"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => refetch()}
        disabled={isFetching}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex flex-col items-center justify-center py-24 space-y-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">
            Varonis prépare les alertes{progress !== null ? ` : ${Math.round(progress <= 1 ? progress * 100 : progress)} %` : "…"}
          </p>
          <p className="text-xs">Cela peut prendre une à plusieurs minutes selon le volume.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 font-bold text-destructive">
              <AlertTriangle className="w-5 h-5" /> Impossible de récupérer les alertes Varonis
            </div>
            <p className="font-mono text-xs bg-background/60 border border-border rounded-md p-3 break-all">
              {(error as Error).message}
            </p>
            <p className="text-sm text-muted-foreground">
              Vérifiez que la fonction <code>varonis-proxy</code> est déployée et que les secrets{" "}
              <code>VARONIS_BASE_URL</code> et <code>VARONIS_API_KEY</code> sont configurés dans Supabase.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const kpis = [
    { label: "Alertes ouvertes", value: summary.open, sub: `${summary.total} au total`, icon: Bell, color: "text-primary" },
    { label: "Sévérité élevée", value: summary.openHigh, sub: "parmi les alertes ouvertes", icon: AlertOctagon, color: "text-red-500" },
    { label: "Sur données sensibles", value: summary.sensitive, sub: "alertes ouvertes", icon: Database, color: "text-orange-500" },
    { label: "Politiques déclenchées", value: summary.distinctPolicies, sub: "distinctes, alertes ouvertes", icon: ShieldAlert, color: "text-violet-500" },
  ];

  const severityOrder: SeverityLevel[] = ["high", "medium", "low", "unknown"];
  const maxSeverity = Math.max(1, ...severityOrder.map((s) => summary.bySeverity[s]));

  return (
    <div className="space-y-6">
      {header}

      {summary.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-2 text-muted-foreground">
            <Inbox className="w-8 h-8" />
            <p className="text-sm">Aucune alerte renvoyée par Varonis.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Indicateurs clés */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map(({ label, value, sub, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">{label}</span>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <div className={`text-3xl font-black mt-2 ${color}`}>{value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Répartition par sévérité */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Alertes ouvertes par sévérité</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {severityOrder.filter((s) => s !== "unknown" || summary.bySeverity.unknown > 0).map((s) => (
                  <div key={s} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{SEVERITY_LABELS[s]}</span>
                      <span className="font-bold text-foreground">{summary.bySeverity[s]}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${SEVERITY_STYLES[s].bar}`} style={{ width: `${(summary.bySeverity[s] / maxSeverity) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Politiques les plus déclenchées */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Politiques les plus déclenchées</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.topPolicies.map((p) => (
                    <li key={p.name} className="flex justify-between gap-3 text-sm">
                      <span className="truncate text-foreground" title={p.name}>{p.name}</span>
                      <span className="font-bold shrink-0">{p.count}</span>
                    </li>
                  ))}
                  {summary.topPolicies.length === 0 && <li className="text-sm text-muted-foreground">Aucune alerte ouverte.</li>}
                </ul>
              </CardContent>
            </Card>

            {/* Statuts et catégories */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Statuts (toutes alertes)</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.byStatus.map((st) => (
                    <li key={st.name} className="flex justify-between gap-3 text-sm">
                      <span className="text-foreground">{st.name}</span>
                      <span className="font-bold">{st.count}</span>
                    </li>
                  ))}
                </ul>
                {summary.byCategory.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1.5">
                    {summary.byCategory.map((c) => (
                      <Badge key={c.name} variant="secondary" className="font-normal">{c.name} · {c.count}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Dernières alertes */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Dernières alertes</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Politique</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Sévérité</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Événements</TableHead>
                      <TableHead>Données sensibles</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.latest.map((a) => {
                      const sev = normalizeSeverity(a.policy?.severity);
                      return (
                        <TableRow key={a.id} className={isOpen(a) ? "" : "opacity-60"}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(alertDate(a))}</TableCell>
                          <TableCell className="font-medium">{a.policy?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{a.policy?.category ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={SEVERITY_STYLES[sev].badge}>
                              {a.policy?.severity ?? SEVERITY_LABELS.unknown}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{formatStatus(a.status)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{a.eventsCount ?? "—"}</TableCell>
                          <TableCell>
                            {a.hasSensitiveResource
                              ? <Badge variant="outline" className="bg-orange-500/15 text-orange-600 border-orange-500/30">Oui</Badge>
                              : <span className="text-sm text-muted-foreground">Non</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
