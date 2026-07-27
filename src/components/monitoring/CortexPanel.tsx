import React, { useEffect, useState } from "react";
import { Activity, Cpu, AlertOctagon, XCircle, Loader2, Calendar, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CortexPanel() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Synchronisation des KPIs via l'API REST...");

  const [kpis, setKpis] = useState<{ coverageTotal: number; coverageConnected: number; totalAlerts: number; impactedEndpoints: number | null }>({
    coverageTotal: 0,
    coverageConnected: 0,
    totalAlerts: 0,
    impactedEndpoints: null
  });

  const [timePrefix, setTimePrefix] = useState<"last" | "this" | "next">("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<"days" | "months" | "years">("days");

  useEffect(() => {
    let isCancelled = false;

    const fetchGlobalKPIs = async () => {
      console.log("=== 🔌 [CORTEX DUAL API] Démarrage de la synchronisation (REST + XQL) ===");

      setKpis(prev => ({ ...prev, impactedEndpoints: null }));
      setStatus("loading");

      // 1. CALCUL DYNAMIQUE DES TIMESTAMPS (Epoch en millisecondes)
      const now = new Date();
      let fromTimestamp = 0;
      let toTimestamp = 0;

      if (timePrefix === "this") {
        if (timeUnit === "days") {
          fromTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          toTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
        } else if (timeUnit === "months") {
          fromTimestamp = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          toTimestamp = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - 1;
        } else if (timeUnit === "years") {
          fromTimestamp = new Date(now.getFullYear(), 0, 1).getTime();
          toTimestamp = new Date(now.getFullYear() + 1, 0, 1).getTime() - 1;
        }
      } else if (timePrefix === "last") {
        toTimestamp = now.getTime();
        const fromDate = new Date(now);
        if (timeUnit === "days") fromDate.setDate(fromDate.getDate() - timeValue);
        else if (timeUnit === "months") fromDate.setMonth(fromDate.getMonth() - timeValue);
        else if (timeUnit === "years") fromDate.setFullYear(fromDate.getFullYear() - timeValue);
        fromTimestamp = fromDate.getTime();
      } else if (timePrefix === "next") {
        fromTimestamp = now.getTime();
        const toDate = new Date(now);
        if (timeUnit === "days") toDate.setDate(toDate.getDate() + timeValue);
        else if (timeUnit === "months") toDate.setMonth(toDate.getMonth() + timeValue);
        else if (timeUnit === "years") toDate.setFullYear(toDate.getFullYear() + timeValue);
        toTimestamp = toDate.getTime();
      }

      const fqdn = import.meta.env.VITE_CORTEX_FQDN;
      const apiKeyId = import.meta.env.VITE_CORTEX_API_KEY_ID;
      const apiKey = import.meta.env.VITE_CORTEX_API_KEY;

      if (!fqdn || !apiKeyId || !apiKey) {
        setStatus("error");
        setMessage("Paramètres d'API manquants.");
        return;
      }

      const generateNonce = (length = 64) => Array.from({length}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
      const computeSHA256 = async (text: string) => {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      };

      try {
        const nonce = generateNonce(64);
        const timestamp = Date.now().toString();
        const hashedAuthKey = await computeSHA256(String(apiKey) + nonce + timestamp);

        const headers = {
          "x-xdr-timestamp": timestamp,
          "x-xdr-nonce": nonce,
          "x-xdr-auth-id": String(apiKeyId),
          "Authorization": hashedAuthKey,
          "Content-Type": "application/json"
        };

        let currentKpis = { coverageTotal: 0, coverageConnected: 0, totalAlerts: 0 };

        // =========================================================================
        // PARTIE 1 : APPELS REST (Instantanés)
        // =========================================================================

        const totalEndpointsRes = await fetch(`/api/cortex/public_api/v1/endpoints/get_endpoint/`, {
          method: 'POST', headers, body: JSON.stringify({ request_data: { search_from: 0, search_to: 1 } })
        });
        if (totalEndpointsRes.ok) currentKpis.coverageTotal = (await totalEndpointsRes.json()).reply?.total_count || 0;

        const connectedEndpointsRes = await fetch(`/api/cortex/public_api/v1/endpoints/get_endpoint/`, {
          method: 'POST', headers, body: JSON.stringify({
            request_data: { search_from: 0, search_to: 1, filters: [{ field: "endpoint_status", operator: "in", value: ["connected", "CONNECTED"] }] }
          })
        });
        if (connectedEndpointsRes.ok) currentKpis.coverageConnected = (await connectedEndpointsRes.json()).reply?.total_count || 0;

        const alertsRes = await fetch(`/api/cortex/public_api/v1/alerts/get_alerts_multi_events/`, {
          method: 'POST', headers, body: JSON.stringify({
            request_data: { search_from: 0, search_to: 1, filters: [{ field: "creation_time", operator: "gte", value: fromTimestamp }, { field: "creation_time", operator: "lte", value: toTimestamp }] }
          })
        });
        if (alertsRes.ok) currentKpis.totalAlerts = (await alertsRes.json()).reply?.total_count || 0;

        if (isCancelled) return;
        setKpis(prev => ({ ...prev, ...currentKpis }));
        setStatus("success");

        // =========================================================================
        // PARTIE 2 : APPEL XQL CONFORME (Utilisation de l'objet timeframe natif)
        // =========================================================================
        const xqlQuery = `dataset = alerts | filter host_name != null and host_name != "" | comp count_distinct(host_name) as unique_hosts`;

        const xqlPayload = {
          request_data: {
            query: xqlQuery,
            timeframe: {
              from: fromTimestamp,
              to: toTimestamp
            }
          }
        };

        console.log("▶️ [API XQL] Payload officiel avec timeframe :", JSON.stringify(xqlPayload));

        const startXqlRes = await fetch(`/api/cortex/public_api/v1/xql/start_xql_query/`, {
          method: 'POST', headers, body: JSON.stringify(xqlPayload)
        });

        if (startXqlRes.ok) {
          const queryId = (await startXqlRes.json()).reply;

          for (let i = 0; i < 15; i++) {
            if (isCancelled) break;

            await new Promise(res => setTimeout(res, 2000));
            const pollRes = await fetch(`/api/cortex/public_api/v1/xql/get_query_results/`, {
              method: 'POST', headers, body: JSON.stringify({ request_data: { query_id: queryId } })
            });

            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();

            if (pollData.reply?.status === "SUCCESS") {
              const results = pollData.reply.results?.data || [];
              const distinctHosts = results.length > 0 ? (Number(results[0].unique_hosts) || 0) : 0;

              console.log(`✅ [API XQL] Succès ! Endpoints distincts impactés : ${distinctHosts}`);
              if (!isCancelled) {
                setKpis(prev => ({ ...prev, impactedEndpoints: distinctHosts }));
              }
              break;
            } else if (pollData.reply?.status === "FAIL" || pollData.reply?.status === "FAILED") {
              console.error("❌ [API XQL] Échec de la requête. Réponse Cortex :", pollData);
              if (!isCancelled) setKpis(prev => ({ ...prev, impactedEndpoints: 0 }));
              break;
            }
          }
        }

      } catch (err: any) {
        console.error("❌ Exception critique :", err);
        setStatus("error");
        setMessage(`Erreur technique : ${err.message}`);
      }
    };

    fetchGlobalKPIs();
    return () => { isCancelled = true; };
  }, [timePrefix, timeValue, timeUnit]);

  return (
    <div className="space-y-6">

      {/* HEADER & FILTRES TEMPORELS */}
      <div className="border-b border-border pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
            <Activity className="w-7 h-7 text-purple-500" /> Évaluation des Risques
          </h2>
          <p className="text-muted-foreground font-medium mt-1">Architecture Duale : REST (Instantané) & XQL (Asynchrone)</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-secondary/20 p-2 rounded-xl border border-border">
          <Calendar className="w-4 h-4 text-muted-foreground ml-2" />

          <select
            value={timePrefix}
            onChange={(e) => setTimePrefix(e.target.value as "last"|"this"|"next")}
            className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 outline-none cursor-pointer"
          >
            <option value="last">Dernier(s)</option>
            <option value="this">Ce/Cette</option>
            <option value="next">Suivant(s)</option>
          </select>

          {timePrefix !== "this" && (
            <input
              type="number"
              min="1"
              value={timeValue}
              onChange={(e) => setTimeValue(Number(e.target.value))}
              className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 w-20 focus:ring-2 focus:ring-purple-500 outline-none"
            />
          )}

          <select
            value={timeUnit}
            onChange={(e) => setTimeUnit(e.target.value as "days"|"months"|"years")}
            className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 outline-none cursor-pointer"
          >
            <option value="days">Jour(s)</option>
            <option value="months">Mois</option>
            <option value="years">Année(s)</option>
          </select>
        </div>
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
          <p className="text-muted-foreground font-medium">{message}</p>
        </div>
      )}

      {status === "error" && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
          <XCircle className="w-6 h-6 shrink-0" />
          <div>
            <h4 className="font-bold text-sm uppercase">Échec de synchronisation</h4>
            <p className="text-xs opacity-90 mt-0.5">{message}</p>
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* CARTE 1 : COUVERTURE (REST) */}
          <Card className="bg-card shadow-sm border-l-4 border-l-blue-500">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Couverture Endpoints</CardTitle>
              <div className="p-1.5 bg-blue-500/10 rounded-md"><Cpu className="w-4 h-4 text-blue-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-foreground">{kpis.coverageConnected.toLocaleString()}</span>
                <span className="text-sm font-bold text-muted-foreground">/ {kpis.coverageTotal.toLocaleString()}</span>
              </div>
              <p className="text-[11px] font-medium text-muted-foreground mt-1">
                Agents actuellement connectés
              </p>
            </CardContent>
          </Card>

          {/* CARTE 2 : VOLUME ALERTES (REST) */}
          <Card className="bg-card shadow-sm border-l-4 border-l-purple-500">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Volume d&apos;Alertes
              </CardTitle>
              <div className="p-1.5 bg-purple-500/10 rounded-md"><AlertOctagon className="w-4 h-4 text-purple-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-foreground">{kpis.totalAlerts.toLocaleString()}</div>
              <p className="text-[11px] font-medium text-muted-foreground mt-1">Total généré sur la période</p>
            </CardContent>
          </Card>

          {/* CARTE 3 : ENDPOINTS IMPACTÉS (XQL Asynchrone) */}
          <Card className="bg-card shadow-sm border-l-4 border-l-orange-500">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Endpoints Impactés
              </CardTitle>
              <div className="p-1.5 bg-orange-500/10 rounded-md"><Target className="w-4 h-4 text-orange-600" /></div>
            </CardHeader>
            <CardContent>
              {kpis.impactedEndpoints === null ? (
                <div className="flex items-center gap-2 text-muted-foreground mt-1">
                  <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                  <span className="text-xs font-medium">Calcul XQL...</span>
                </div>
              ) : (
                <>
                  <div className="text-3xl font-black text-foreground">{kpis.impactedEndpoints.toLocaleString()}</div>
                  <p className="text-[11px] font-medium text-muted-foreground mt-1">Hôtes distincts générant des alertes</p>
                </>
              )}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}