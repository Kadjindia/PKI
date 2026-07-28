import React, { useEffect, useState } from "react";
import {
  Activity, Cpu, AlertOctagon, XCircle, Loader2, Calendar, Target, Users,
  ShieldCheck, Monitor, AlertTriangle, Layers, ServerCrash
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend
} from "recharts";

// ----------------------------------------------------------------------------
// Comparaison de versions type "8.2.0.32000" -> compare partie par partie.
// ----------------------------------------------------------------------------
const compareVersions = (a: string, b: string): number => {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// Dictionnaire de traduction et couleurs pour les sévérités Cortex
const SEVERITY_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  "Critical": { label: "Critique", color: "#9f1239", order: 1 },
  "High": { label: "Élevé", color: "#ef4444", order: 2 },
  "Medium": { label: "Moyen", color: "#f59e0b", order: 3 },
  "Low": { label: "Faible", color: "#3b82f6", order: 4 },
  "Informational": { label: "Info", color: "#64748b", order: 5 },
};

const getSeverityStyle = (sev: string) => SEVERITY_CONFIG[sev] || { label: sev, color: "#94a3b8", order: 99 };

// Palette pour les catégories
const CATEGORY_PALETTE = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#f43f5e", "#64748b", "#a855f7", "#3b82f6"];

export default function CortexPanel() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Synchronisation des KPIs via l'API REST...");

  const [kpis, setKpis] = useState<{
    coverageTotal: number;
    coverageConnected: number;
    totalAlerts: number;
    impactedEndpoints: number | null;
    impactedUsers: number | null;
  }>({
    coverageTotal: 0,
    coverageConnected: 0,
    totalAlerts: 0,
    impactedEndpoints: null,
    impactedUsers: null
  });

  // KPI Sévérité
  const [severityDistribution, setSeverityDistribution] = useState<{ severity: string; count: number }[] | null>(null);
  const totalSeveritiesCount = severityDistribution ? severityDistribution.reduce((sum, s) => sum + s.count, 0) : 0;

  // KPI Catégories
  const [categoryDistribution, setCategoryDistribution] = useState<{ category: string; count: number }[] | null>(null);
  const totalCategories = categoryDistribution ? categoryDistribution.reduce((sum, c) => sum + c.count, 0) : 0;

  // KPI Top endpoints à risque
  const [topEndpoints, setTopEndpoints] = useState<{ host: string; score: number; count: number }[] | null>(null);

  // KPI Versions d'agent
  const [agentVersions, setAgentVersions] = useState<{ version: string; count: number }[] | null>(null);
  const versionKey = (v: string) => v.split(".").slice(0, 3).join(".");
  const referenceVersion = agentVersions?.length
    ? agentVersions.reduce((max, v) => (compareVersions(v.version, max) > 0 ? v.version : max), agentVersions[0].version)
    : null;
  const referenceKey = referenceVersion ? versionKey(referenceVersion) : null;

  const totalAgents = agentVersions ? agentVersions.reduce((sum, v) => sum + v.count, 0) : 0;
  const upToDateCount = agentVersions
    ? agentVersions.filter((v) => versionKey(v.version) === referenceKey).reduce((sum, v) => sum + v.count, 0)
    : 0;
  const outdatedCount = totalAgents - upToDateCount;

  // KPI OS
  const [osDistribution, setOsDistribution] = useState<{ os: string; count: number }[] | null>(null);
  const totalOs = osDistribution ? osDistribution.reduce((sum, o) => sum + o.count, 0) : 0;
  const OS_PALETTE = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#f43f5e", "#64748b"];

  const [timePrefix, setTimePrefix] = useState<"last" | "this" | "next">("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<"days" | "months" | "years">("days");

  useEffect(() => {
    let isCancelled = false;

    const fetchGlobalKPIs = async () => {
      console.log("=== 🔌 [CORTEX DUAL API] Démarrage de la synchronisation ===");

      setKpis(prev => ({ ...prev, impactedEndpoints: null, impactedUsers: null }));
      setAgentVersions(null);
      setOsDistribution(null);
      setSeverityDistribution(null);
      setCategoryDistribution(null);
      setTopEndpoints(null);
      setStatus("loading");

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

      const fqdn = import.meta.env.VITE_CORTEX_FQDN;
      const apiKeyId = import.meta.env.VITE_CORTEX_API_KEY_ID;
      const apiKey = import.meta.env.VITE_CORTEX_API_KEY;

      if (!fqdn || !apiKeyId || !apiKey) {
        setStatus("error");
        setMessage("Paramètres d'API manquants.");
        return;
      }

      // 🛡️ API CALL SECURE : Génère un nonce unique par appel
      const apiCall = async (endpoint: string, payload: any) => {
        const nonce = Array.from({length: 64}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        const timestamp = Date.now().toString();
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(apiKey) + nonce + timestamp));
        const hashedAuthKey = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        return fetch(`/api/cortex${endpoint}`, {
          method: 'POST',
          headers: {
            "x-xdr-timestamp": timestamp,
            "x-xdr-nonce": nonce,
            "x-xdr-auth-id": String(apiKeyId),
            "Authorization": hashedAuthKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      };

      try {
        let currentKpis = { coverageTotal: 0, coverageConnected: 0, totalAlerts: 0 };

        // =========================================================================
        // PARTIE 1 : APPELS REST (Instantanés)
        // =========================================================================
        const totalEndpointsRes = await apiCall(`/public_api/v1/endpoints/get_endpoint/`, { request_data: { search_from: 0, search_to: 1 } });
        if (totalEndpointsRes.ok) currentKpis.coverageTotal = (await totalEndpointsRes.json()).reply?.total_count || 0;

        const connectedEndpointsRes = await apiCall(`/public_api/v1/endpoints/get_endpoint/`, {
          request_data: { search_from: 0, search_to: 1, filters: [{ field: "endpoint_status", operator: "in", value: ["connected", "CONNECTED"] }] }
        });
        if (connectedEndpointsRes.ok) currentKpis.coverageConnected = (await connectedEndpointsRes.json()).reply?.total_count || 0;

        const alertsRes = await apiCall(`/public_api/v1/alerts/get_alerts_multi_events/`, {
          request_data: { search_from: 0, search_to: 1, filters: [{ field: "creation_time", operator: "gte", value: fromTimestamp }, { field: "creation_time", operator: "lte", value: toTimestamp }] }
        });
        if (alertsRes.ok) currentKpis.totalAlerts = (await alertsRes.json()).reply?.total_count || 0;

        const severitiesToFetch = ["Critical", "High", "Medium", "Low", "Informational"];
        const severityPromises = severitiesToFetch.map(sev =>
          apiCall(`/public_api/v1/alerts/get_alerts_multi_events/`, {
            request_data: {
              search_from: 0, search_to: 1,
              filters: [
                { field: "creation_time", operator: "gte", value: fromTimestamp },
                { field: "creation_time", operator: "lte", value: toTimestamp },
                { field: "severity", operator: "in", value: [sev] }
              ]
            }
          })
          .then(res => res.json())
          .then(data => ({ severity: sev, count: data?.reply?.total_count || 0 }))
          .catch(() => ({ severity: sev, count: 0 }))
        );

        const severityResults = await Promise.all(severityPromises);

        if (isCancelled) return;
        setKpis(prev => ({ ...prev, ...currentKpis }));

        const validSeverities = severityResults
          .filter(s => s.count > 0)
          .sort((a, b) => getSeverityStyle(a.severity).order - getSeverityStyle(b.severity).order);
        setSeverityDistribution(validSeverities);

        setStatus("success");

        // =========================================================================
        // PARTIE 2 : APPELS XQL
        // =========================================================================
        const executeXql = async (query: string, label: string, withTimeframe = true) => {
          const payload: any = { request_data: { query } };

          // La condition withTimeframe est cruciale : on ne l'injecte QUE si c'est true
          // Car le dataset "endpoints" plantera en erreur 500 s'il reçoit ce bloc JSON.
          if (withTimeframe) {
            payload.request_data.timeframe = { from: fromTimestamp, to: toTimestamp };
          }

          const startRes = await apiCall(`/public_api/v1/xql/start_xql_query/`, payload);

          if (!startRes.ok) {
            console.error(`❌ [API XQL - ${label}] Erreur HTTP au démarrage :`, startRes.status);
            return null;
          }

          const startData = await startRes.json();
          const queryId = startData?.reply;
          if (!queryId) return null;

          for (let i = 0; i < 15; i++) {
            if (isCancelled) break;
            await new Promise(res => setTimeout(res, 2000));
            const pollRes = await apiCall(`/public_api/v1/xql/get_query_results/`, { request_data: { query_id: queryId } });

            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();

            if (pollData.reply?.status === "SUCCESS") {
              return pollData.reply.results?.data || [];
            } else if (pollData.reply?.status === "FAIL" || pollData.reply?.status === "FAILED") {
              console.warn(`[XQL] Échec de la requête "${label}"`);
              break;
            }
          }
          return null;
        };

        const hostsQuery = `dataset = alerts | filter host_name != null and host_name != "" | comp count_distinct(host_name) as unique_hosts`;
        const usersQuery = `dataset = alerts | filter user_name != null and to_string(user_name) != "" | comp count_distinct(to_string(user_name)) as unique_users`;
        const categoryQuery = `dataset = alerts | filter category != null and category != "" | comp count() as cnt by category | sort desc cnt | limit 15`;
        const topEndpointsQuery = `dataset = alerts | filter host_name != null and host_name != "" | comp count() as cnt by host_name, severity | limit 500`;

        // CORRECTION MAJEURE : On remet 'config timeframe' pour l'inventaire
        // Ces deux requêtes sont exécutées avec withTimeframe = false !
        const osQuery = `config timeframe = 3650d | dataset = endpoints | filter operating_system != null and operating_system != "" | comp count_distinct(endpoint_id) as cnt by operating_system`;
        const versionsQuery = `config timeframe = 3650d | dataset = endpoints | filter agent_version != null and agent_version != "" | comp count_distinct(endpoint_id) as cnt by agent_version`;

        executeXql(hostsQuery, "Endpoints", true).then(rows => {
          if (isCancelled || !rows) return;
          const distinctHosts = rows?.length ? Number(Object.values(rows[0])[0]) || 0 : 0;
          setKpis(prev => ({ ...prev, impactedEndpoints: distinctHosts }));
        });

        executeXql(usersQuery, "Utilisateurs", true).then(rows => {
          if (isCancelled || !rows) return;
          const distinctUsers = rows?.length ? Number(Object.values(rows[0])[0]) || 0 : 0;
          setKpis(prev => ({ ...prev, impactedUsers: distinctUsers }));
        });

        executeXql(categoryQuery, "Catégories", true).then(rows => {
          if (isCancelled) return;
          if (!rows) { setCategoryDistribution([]); return; }
          const parsed = rows
            .map((r: any) => {
              const catKey = Object.keys(r).find(k => k !== 'cnt');
              const catName = catKey ? r[catKey] : "Inconnue";
              return { category: String(catName), count: Number(r.cnt) || 0 };
            })
            .sort((a, b) => b.count - a.count);
          setCategoryDistribution(parsed);
        });

        executeXql(topEndpointsQuery, "Top endpoints", true).then(rows => {
          if (isCancelled) return;
          if (!rows) { setTopEndpoints([]); return; }

          const scores: Record<string, { host: string; score: number; count: number }> = {};

          rows.forEach((r: any) => {
            const host = String(r.host_name);
            const sev = String(r.severity);
            const count = Number(r.cnt) || 0;

            let weight = 1;
            if (sev === "Critical") weight = 4;
            else if (sev === "High") weight = 3;
            else if (sev === "Medium") weight = 2;

            if (!scores[host]) scores[host] = { host, score: 0, count: 0 };
            scores[host].score += (count * weight);
            scores[host].count += count;
          });

          const parsed = Object.values(scores).sort((a, b) => b.score - a.score).slice(0, 10);
          setTopEndpoints(parsed);
        });

        // ⚠️ Exécution avec FALSE pour ne pas envoyer le bloc timeframe
        executeXql(osQuery, "Répartition OS", false).then(rows => {
          if (isCancelled) return;
          if (!rows) { setOsDistribution([]); return; }
          const parsed = rows
            .map((r: any) => {
              const osKey = Object.keys(r).find(k => k !== 'cnt');
              const osName = osKey ? r[osKey] : "Inconnu";
              return { os: String(osName), count: Number(r.cnt) || 0 };
            })
            .sort((a, b) => b.count - a.count);
          setOsDistribution(parsed);
        });

        executeXql(versionsQuery, "Versions Agent", false).then(rows => {
          if (isCancelled) return;
          if (!rows) { setAgentVersions([]); return; }
          const parsed = rows
            .map((r: any) => {
              const verKey = Object.keys(r).find(k => k !== 'cnt');
              const verName = verKey ? r[verKey] : "Inconnue";
              return { version: String(verName), count: Number(r.cnt) || 0 };
            })
            .sort((a, b) => compareVersions(b.version, a.version));
          setAgentVersions(parsed);
        });

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
        <>
          {/* LIGNE 1 : KPIs GLOBAUX */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <p className="text-[11px] font-medium text-muted-foreground mt-1">Agents actuellement connectés</p>
              </CardContent>
            </Card>

            <Card className="bg-card shadow-sm border-l-4 border-l-purple-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Volume d&apos;Alertes</CardTitle>
                <div className="p-1.5 bg-purple-500/10 rounded-md"><AlertOctagon className="w-4 h-4 text-purple-600" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{kpis.totalAlerts.toLocaleString()}</div>
                <p className="text-[11px] font-medium text-muted-foreground mt-1">Total généré sur la période</p>
              </CardContent>
            </Card>

            <Card className="bg-card shadow-sm border-l-4 border-l-orange-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Endpoints Impactés</CardTitle>
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
                    <p className="text-[11px] font-medium text-muted-foreground mt-1">Hôtes distincts impactés</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card shadow-sm border-l-4 border-l-emerald-500">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Utilisateurs Impactés</CardTitle>
                <div className="p-1.5 bg-emerald-500/10 rounded-md"><Users className="w-4 h-4 text-emerald-600" /></div>
              </CardHeader>
              <CardContent>
                {kpis.impactedUsers === null ? (
                  <div className="flex items-center gap-2 text-muted-foreground mt-1">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : (
                  <>
                    <div className="text-3xl font-black text-foreground">{kpis.impactedUsers.toLocaleString()}</div>
                    <p className="text-[11px] font-medium text-muted-foreground mt-1">Comptes distincts impactés</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 2 : FOCUS SÉVÉRITÉ DES ALERTES */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" /> Sévérité des alertes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col items-center justify-center min-h-[280px]">
                {!severityDistribution ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    <span className="text-xs font-medium">Chargement REST...</span>
                  </div>
                ) : severityDistribution.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Aucune alerte sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={severityDistribution.map(s => ({
                          name: getSeverityStyle(s.severity).label,
                          value: s.count,
                          color: getSeverityStyle(s.severity).color
                        }))}
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {severityDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getSeverityStyle(entry.severity).color} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase">
                  Détail par niveau de risque
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col justify-center">
                {!severityDistribution ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    <span className="text-xs font-medium">Chargement REST...</span>
                  </div>
                ) : severityDistribution.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-8">Aucune alerte à afficher.</p>
                ) : (
                  <div className="space-y-3.5 overflow-y-auto pr-2 max-h-[240px] custom-scrollbar">
                    {severityDistribution.map((s) => {
                      const style = getSeverityStyle(s.severity);
                      const percentage = totalSeveritiesCount > 0 ? ((s.count / totalSeveritiesCount) * 100).toFixed(1) : "0";

                      return (
                        <div key={s.severity} className="relative flex items-center justify-between p-3 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden group hover:bg-secondary/20 transition-colors">
                          <div
                            className="absolute top-0 left-0 h-full opacity-15 transition-all duration-500"
                            style={{ width: `${percentage}%`, backgroundColor: style.color }}
                          />
                          <div className="relative z-10 flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: style.color }} />
                            <span className="font-bold text-foreground text-sm uppercase tracking-wide" style={{ color: style.color }}>
                              {style.label}
                            </span>
                          </div>
                          <div className="relative z-10 flex items-center gap-6">
                            <span className="font-bold text-muted-foreground text-xs w-12 text-right">{percentage}%</span>
                            <span className="font-black text-foreground text-base w-16 text-right">{s.count.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 3 : CATÉGORIES + TOP ENDPOINTS À RISQUE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Layers className="w-4 h-4 text-violet-500" /> Répartition par catégorie
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {!categoryDistribution ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : categoryDistribution.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-8">Aucune catégorie sur la période.</p>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {categoryDistribution.map((c, index) => {
                      const color = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
                      const percentage = totalCategories > 0 ? ((c.count / totalCategories) * 100).toFixed(1) : "0";

                      return (
                        <div key={c.category} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden group hover:bg-secondary/20 transition-colors">
                          <div
                            className="absolute top-0 left-0 h-full opacity-15"
                            style={{ width: `${percentage}%`, backgroundColor: color }}
                          />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="font-bold text-foreground text-xs truncate" title={c.category}>{c.category}</span>
                          </div>
                          <div className="relative z-10 flex items-center gap-4 shrink-0">
                            <span className="font-bold text-muted-foreground text-[10px] w-10 text-right">{percentage}%</span>
                            <span className="font-black text-foreground text-sm w-12 text-right">{c.count.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-border/50">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <ServerCrash className="w-4 h-4 text-rose-500" /> Top endpoints à risque
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {!topEndpoints ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : topEndpoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-8">Aucun endpoint impacté.</p>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {topEndpoints.map((e, index) => {
                      const maxScore = topEndpoints[0]?.score || 1;
                      const percentage = ((e.score / maxScore) * 100).toFixed(0);

                      return (
                        <div key={e.host} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden group hover:bg-secondary/20 transition-colors">
                          <div
                            className="absolute top-0 left-0 h-full opacity-15 bg-rose-500"
                            style={{ width: `${percentage}%` }}
                          />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden">
                            <span className="font-black text-rose-500 text-[10px] w-4 shrink-0">#{index + 1}</span>
                            <span className="font-bold text-foreground text-xs truncate" title={e.host}>{e.host}</span>
                          </div>
                          <div className="relative z-10 flex items-center gap-4 shrink-0">
                            <span className="font-bold text-muted-foreground text-[10px]">{e.count} alerte{e.count > 1 ? "s" : ""}</span>
                            <span className="font-black text-rose-500 text-sm w-10 text-right">{e.score.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LIGNE 4 : INVENTAIRE DU PARC (3 Colonnes équilibrées) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">

            {/* Colonne 1 : Camembert Statut Agents */}
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-500" /> Statut global des agents
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col items-center justify-center min-h-[260px]">
                {agentVersions === null ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : agentVersions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Aucune donnée.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: "À jour", value: upToDateCount, color: "#14b8a6" },
                          { name: "Obsolète", value: outdatedCount, color: "#64748b" }
                        ].filter(s => s.value > 0)}
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                      >
                        {[
                          { name: "À jour", color: "#14b8a6" },
                          { name: "Obsolète", color: "#64748b" }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Colonne 2 : Liste Versions Agent */}
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-col justify-center border-b border-border/50 h-[56px]">
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-teal-500" /> Versions
                  </CardTitle>
                  {referenceVersion && (
                    <span className="text-[10px] font-bold text-teal-600 bg-teal-500/10 px-2 py-1 rounded-md border border-teal-500/20">
                      Ref: {referenceVersion}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {agentVersions === null ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[220px] custom-scrollbar">
                    {agentVersions.map((v) => {
                      const isRef = versionKey(v.version) === referenceKey;
                      const percentage = totalAgents > 0 ? ((v.count / totalAgents) * 100).toFixed(1) : "0";

                      return (
                        <div key={v.version} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/10 overflow-hidden group hover:bg-secondary/20 transition-colors">
                          <div
                            className={`absolute top-0 left-0 h-full opacity-10 ${isRef ? 'bg-teal-500' : 'bg-slate-500'}`}
                            style={{ width: `${percentage}%` }}
                          />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden">
                            <span className={`font-mono text-[11px] md:text-xs font-bold truncate ${isRef ? "text-teal-500" : "text-foreground"}`}>
                              {v.version}
                            </span>
                          </div>
                          <div className="relative z-10 flex items-center gap-2 shrink-0">
                            <span className="font-bold text-muted-foreground text-[10px] w-8 text-right">{percentage}%</span>
                            <span className="font-black text-foreground text-xs w-8 text-right">{v.count.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Colonne 3 : Liste OS */}
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 flex flex-col justify-center border-b border-border/50 h-[56px]">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-sky-500" /> Parc OS
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {osDistribution === null ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
                    <span className="text-xs font-medium">Calcul XQL...</span>
                  </div>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[220px] custom-scrollbar">
                    {osDistribution.map((o, index) => {
                      const color = OS_PALETTE[index % OS_PALETTE.length];
                      const percentage = totalOs > 0 ? ((o.count / totalOs) * 100).toFixed(1) : "0";

                      return (
                        <div key={o.os} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden group hover:bg-secondary/20 transition-colors">
                          <div
                            className="absolute top-0 left-0 h-full opacity-20"
                            style={{ width: `${percentage}%`, backgroundColor: color }}
                          />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="font-bold text-foreground text-[11px] md:text-xs truncate" title={o.os}>
                              {o.os}
                            </span>
                          </div>
                          <div className="relative z-10 flex items-center gap-2 shrink-0">
                            <span className="font-bold text-muted-foreground text-[10px] w-8 text-right">{percentage}%</span>
                            <span className="font-black text-foreground text-xs w-8 text-right">{o.count.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </>
      )}
    </div>
  );
}