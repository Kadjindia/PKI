import React, { useEffect, useState } from "react";
import { Activity, Cpu, AlertOctagon, CheckCircle2, XCircle, Loader2, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CortexPanel() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Synchronisation des KPIs via l&apos;API REST...");
  const [kpis, setKpis] = useState({ coverageTotal: 0, coverageConnected: 0, totalAlerts: 0 });

  // États pour le filtre temporel dynamique
  const [timePrefix, setTimePrefix] = useState<"last" | "this" | "next">("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<"days" | "months" | "years">("days");

  useEffect(() => {
    const fetchGlobalKPIs = async () => {
      console.log("=== 🔌 [CORTEX REST API] Démarrage de la synchronisation temporelle ===");

      // 1. CALCUL DYNAMIQUE DES TIMESTAMPS
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

      console.log(`⏱️ Filtre temporel appliqué : ${timePrefix} ${timePrefix !== 'this' ? timeValue : ''} ${timeUnit}`);
      console.log(`🕒 Bornes calculées : DE [${new Date(fromTimestamp).toLocaleString()}] À [${new Date(toTimestamp).toLocaleString()}]`);

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
        setStatus("loading");
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
        // 1. TOTAL ENDPOINTS (Snapshot actuel)
        // =========================================================================
        const totalEndpointsRes = await fetch(`/api/cortex/public_api/v1/endpoints/get_endpoint/`, {
          method: 'POST', headers, body: JSON.stringify({ request_data: { search_from: 0, search_to: 1 } })
        });
        if (totalEndpointsRes.ok) {
          currentKpis.coverageTotal = (await totalEndpointsRes.json()).reply?.total_count || 0;
        }

        // =========================================================================
        // 2. ENDPOINTS CONNECTÉS (Snapshot actuel)
        // =========================================================================
        const connectedEndpointsRes = await fetch(`/api/cortex/public_api/v1/endpoints/get_endpoint/`, {
          method: 'POST', headers, body: JSON.stringify({
            request_data: { search_from: 0, search_to: 1, filters: [{ field: "endpoint_status", operator: "in", value: ["connected", "CONNECTED"] }] }
          })
        });
        if (connectedEndpointsRes.ok) {
          currentKpis.coverageConnected = (await connectedEndpointsRes.json()).reply?.total_count || 0;
        }

        // =========================================================================
        // 3. VOLUME TOTAL DES ALERTES (Avec filtrage temporel strict DE/À)
        // =========================================================================
        const req3Payload = {
          request_data: {
            search_from: 0,
            search_to: 1,
            filters: [
              {
                field: "creation_time",
                operator: "gte",
                value: fromTimestamp
              },
              {
                field: "creation_time",
                operator: "lte",
                value: toTimestamp
              }
            ]
          }
        };

        console.log("▶️ [API 3/3] Requête Volume Alertes (Dynamique) :", JSON.stringify(req3Payload));

        const alertsRes = await fetch(`/api/cortex/public_api/v1/alerts/get_alerts_multi_events/`, {
          method: 'POST',
          headers,
          body: JSON.stringify(req3Payload)
        });

        if (alertsRes.ok) {
          const alData = await alertsRes.json();
          currentKpis.totalAlerts = alData.reply?.total_count || 0;
          console.log(`✅ [API 3/3] Total Alertes trouvé pour la période : ${currentKpis.totalAlerts}`);
        } else {
           console.error(`❌ [API 3/3] Erreur HTTP ${alertsRes.status}`);
        }

        setKpis(currentKpis);
        setStatus("success");
        setMessage("Métriques globales synchronisées avec succès.");

      } catch (err: any) {
        console.error("❌ Exception critique capturée :", err);
        setStatus("error");
        setMessage(`Erreur technique : ${err.message}`);
      }
    };

    fetchGlobalKPIs();
  // Le useEffect se redéclenche automatiquement si timePrefix, timeValue ou timeUnit changent !
  }, [timePrefix, timeValue, timeUnit]);

  return (
    <div className="space-y-6">

      {/* HEADER & FILTRES TEMPORELS */}
      <div className="border-b border-border pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
            <Activity className="w-7 h-7 text-purple-500" /> Évaluation des Risques
          </h2>
          <p className="text-muted-foreground font-medium mt-1">Architecture REST - Filtres dynamiques en temps réel</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

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

          <Card className="bg-card shadow-sm border-l-4 border-l-purple-500">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Volume d&apos;Alertes ({timePrefix === 'this' ? 'Ce(tte)' : timePrefix === 'last' ? 'Dernier(s)' : 'Suivant(s)'} {timePrefix !== 'this' ? timeValue : ''} {timeUnit === 'days' ? 'Jour(s)' : timeUnit === 'months' ? 'Mois' : 'Année(s)'})
              </CardTitle>
              <div className="p-1.5 bg-purple-500/10 rounded-md"><AlertOctagon className="w-4 h-4 text-purple-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-foreground">{kpis.totalAlerts.toLocaleString()}</div>
              <p className="text-[11px] font-medium text-muted-foreground mt-1">Total généré sur la période sélectionnée</p>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}