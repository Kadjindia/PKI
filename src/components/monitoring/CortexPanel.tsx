import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, Cpu, AlertOctagon, XCircle, Loader2, Calendar, Target, Users,
  ShieldCheck, Monitor, AlertTriangle, Clock, TrendingUp, Layers, ServerCrash, Search,
  ChevronLeft, ChevronRight, UserX, Eye, EyeOff, Briefcase, Upload, FileSpreadsheet
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line
} from "recharts";
import * as XLSX from "xlsx";

// ============================================================================
// CONSTANTES ET UTILITAIRES
// ============================================================================

const HR_MAPPING_STORAGE_KEY = "cortex_hr_mapping_v1";
const HR_MAPPING_META_STORAGE_KEY = "cortex_hr_mapping_meta_v1";

const SEVERITY_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  "Critical": { label: "Critique", color: "#9f1239", order: 1 },
  "High": { label: "Élevé", color: "#ef4444", order: 2 },
  "Medium": { label: "Moyen", color: "#f59e0b", order: 3 },
  "Low": { label: "Faible", color: "#3b82f6", order: 4 },
  "Informational": { label: "Info", color: "#64748b", order: 5 },
};

const CATEGORY_PALETTE = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#f43f5e", "#64748b", "#a855f7", "#3b82f6"];
const OS_PALETTE = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#f43f5e", "#64748b"];
const DOMAIN_PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#f43f5e", "#0ea5e9", "#64748b", "#a855f7", "#22c55e", "#ec4899", "#14b8a6"];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "reconnaissance": "Collecte d'informations sur la cible avant l'attaque.",
  "resource development": "Mise en place par l'attaquant de ressources en vue de l'attaque.",
  "initial access": "Techniques pour obtenir un premier accès au réseau.",
  "execution": "Exécution de code malveillant sur un système compromis.",
  "persistence": "Techniques permettant de conserver son accès.",
  "privilege escalation": "Obtention de privilèges plus élevés.",
  "defense evasion": "Échapper à la détection par les outils de sécurité.",
  "credential access": "Vol d'identifiants : mots de passe, jetons.",
  "discovery": "Exploration de l'environnement compromis.",
  "lateral movement": "Déplacement d'un système à un autre.",
  "collection": "Collecte de données en vue d'une exfiltration.",
  "command and control": "Canal de communication (C2).",
  "exfiltration": "Extraction de données vers l'extérieur.",
  "impact": "Perturbation ou destruction de systèmes (ex: ransomware).",
  "malware": "Détection d'un logiciel malveillant.",
  "restrictions": "Application d'une politique de restriction.",
  "other": "Alertes ne correspondant à aucune tactique standard.",
  "unclassified": "Alertes non encore classifiées.",
};

const getSeverityStyle = (sev: string) => SEVERITY_CONFIG[sev] || { label: sev, color: "#94a3b8", order: 99 };
const getCategoryDescription = (category: string) => CATEGORY_DESCRIPTIONS[category.trim().toLowerCase()] || "Catégorie définie par Cortex.";

// Correction SonarQube : Utilisation de Number.parseInt
const compareVersions = (a: string, b: string): number => {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const getDomainForUser = (xdrUser: string, hrMapping: Record<string, string>): string => {
  if (!xdrUser) return "Non attribué";
  const xdrLower = String(xdrUser).toLowerCase();
  for (const [hrId, domain] of Object.entries(hrMapping)) {
    if (xdrLower.includes(hrId)) return domain;
  }
  return "Non attribué";
};

// ============================================================================
// API PROXY & XQL EXECUTION
// ============================================================================

const apiCall = async (endpoint: string, payload: any) => {
  const { data, error } = await supabase.functions.invoke('cortex-proxy', {
    method: 'POST',
    body: { path: endpoint, payload: payload }
  });
  if (error) {
    console.error(`[Cortex] Erreur sur ${endpoint}:`, error.message);
    return { ok: false, status: 500, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => data };
};

const executeXql = async (query: string, fromTimestamp: number, toTimestamp: number, withTimeframe: boolean, checkCancelled: () => boolean) => {
  const payload: any = { request_data: { query } };
  if (withTimeframe) payload.request_data.timeframe = { from: fromTimestamp, to: toTimestamp };

  let queryId = null;
  for (let retry = 0; retry < 3; retry++) {
    if (checkCancelled()) return null;
    const startRes = await apiCall(`/public_api/v1/xql/start_xql_query/`, payload);
    if ([450, 429, 500].includes(startRes.status)) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!startRes.ok) return null;
    queryId = (await startRes.json())?.reply;
    break;
  }

  if (!queryId) return null;

  for (let i = 0; i < 20; i++) {
    if (checkCancelled()) break;
    await new Promise(res => setTimeout(res, 3000));
    const pollRes = await apiCall(`/public_api/v1/xql/get_query_results/`, { request_data: { query_id: queryId } });
    if ([450, 429, 500].includes(pollRes.status)) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    if (pollData.reply?.status === "SUCCESS") return pollData.reply.results?.data || [];
    if (["FAIL", "FAILED"].includes(pollData.reply?.status)) break;
  }
  return null;
};

const runJobsWithConcurrency = async (jobs: any[], fromTs: number, toTs: number, isCancelled: () => boolean) => {
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (isCancelled()) return;
      const rows = await executeXql(job.query, fromTs, toTs, job.withTimeframe ?? true, isCancelled);
      if (isCancelled()) return;
      job.onResult(rows || []);
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
};

// ============================================================================
// DATA FETCHING HELPERS
// ============================================================================

const calculateTimeRange = (timePrefix: string, timeValue: number, timeUnit: string) => {
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
  return { fromTimestamp, toTimestamp };
};

const fetchBaseKpis = async (fromTs: number, toTs: number) => {
  const kpis = { coverageTotal: 0, coverageConnected: 0, totalAlerts: 0 };

  const totalRes = await apiCall(`/public_api/v1/endpoints/get_endpoint/`, { request_data: { search_from: 0, search_to: 1 } });
  if (totalRes.ok) kpis.coverageTotal = (await totalRes.json()).reply?.total_count || 0;

  const connRes = await apiCall(`/public_api/v1/endpoints/get_endpoint/`, {
    request_data: { search_from: 0, search_to: 1, filters: [{ field: "endpoint_status", operator: "in", value: ["connected", "CONNECTED"] }] }
  });
  if (connRes.ok) kpis.coverageConnected = (await connRes.json()).reply?.total_count || 0;

  const alertsRes = await apiCall(`/public_api/v1/alerts/get_alerts_multi_events/`, {
    request_data: { search_from: 0, search_to: 1, filters: [{ field: "creation_time", operator: "gte", value: fromTs }, { field: "creation_time", operator: "lte", value: toTs }] }
  });
  if (alertsRes.ok) kpis.totalAlerts = (await alertsRes.json()).reply?.total_count || 0;

  return kpis;
};

const fetchSeverities = async (fromTs: number, toTs: number) => {
  const severitiesToFetch = ["Critical", "High", "Medium", "Low", "Informational"];
  const promises = severitiesToFetch.map(async sev => {
    try {
      const res = await apiCall(`/public_api/v1/alerts/get_alerts_multi_events/`, {
        request_data: { search_from: 0, search_to: 1, filters: [{ field: "creation_time", operator: "gte", value: fromTs }, { field: "creation_time", operator: "lte", value: toTs }, { field: "severity", operator: "in", value: [sev] }] }
      });
      if (!res.ok) return { severity: sev, count: 0 };
      const data = await res.json();
      return { severity: sev, count: data?.reply?.total_count || 0 };
    } catch {
      return { severity: sev, count: 0 };
    }
  });
  const results = await Promise.all(promises);
  return results.filter(s => s.count > 0).sort((a, b) => getSeverityStyle(a.severity).order - getSeverityStyle(b.severity).order);
};

const getBinParams = (rangeMs: number) => {
  const DAY_MS = 24 * 3600 * 1000;
  if (rangeMs <= 2 * DAY_MS) return { spanForBin: "1h", binGranularity: "hour" };
  if (rangeMs <= 31 * DAY_MS) return { spanForBin: "1d", binGranularity: "day" };
  if (rangeMs <= 100 * DAY_MS) return { spanForBin: "1w", binGranularity: "week" };
  if (rangeMs <= 450 * DAY_MS) return { spanForBin: "1mo", binGranularity: "month" };
  return { spanForBin: "3mo", binGranularity: "quarter" };
};

const formatBinLabel = (t: number, binGranularity: string): string => {
  const d = new Date(t);
  switch (binGranularity) {
    case "hour": return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    case "day": return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    case "week": return `Sem. du ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}`;
    case "month": return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    case "quarter": return `T${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    default: return "";
  }
};

// ============================================================================
// CUSTOM HOOK: GESTION DE TOUTES LES DONNÉES CORTEX
// ============================================================================

function useCortexData(timePrefix: string, timeValue: number, timeUnit: string) {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Synchronisation des KPIs via l'API REST...");
  const [kpis, setKpis] = useState({ coverageTotal: 0, coverageConnected: 0, totalAlerts: 0, impactedEndpoints: null as number | null, impactedUsers: null as number | null });
  const [severityDistribution, setSeverityDistribution] = useState<any[] | null>(null);
  const [agentVersions, setAgentVersions] = useState<any[] | null>(null);
  const [osDistribution, setOsDistribution] = useState<any[] | null>(null);
  const [categoryDistribution, setCategoryDistribution] = useState<any[] | null>(null);
  const [alertsTimeline, setAlertsTimeline] = useState<any[] | null>(null);
  const [timelineGranularity, setTimelineGranularity] = useState<string | null>(null);
  const [hourlyDistribution, setHourlyDistribution] = useState<any[] | null>(null);
  const [topEndpoints, setTopEndpoints] = useState<any[] | null>(null);
  const [allUsersAtRisk, setAllUsersAtRisk] = useState<any[] | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const run = async () => {
      setStatus("loading");
      setKpis(p => ({ ...p, impactedEndpoints: null, impactedUsers: null }));
      setAgentVersions(null); setOsDistribution(null); setSeverityDistribution(null);
      setCategoryDistribution(null); setAlertsTimeline(null); setTimelineGranularity(null);
      setHourlyDistribution(null); setTopEndpoints(null); setAllUsersAtRisk(null);

      const { fromTimestamp, toTimestamp } = calculateTimeRange(timePrefix, timeValue, timeUnit);

      try {
        const baseKpis = await fetchBaseKpis(fromTimestamp, toTimestamp);
        if (isCancelled) return;
        setKpis(p => ({ ...p, ...baseKpis }));

        const severities = await fetchSeverities(fromTimestamp, toTimestamp);
        if (isCancelled) return;
        setSeverityDistribution(severities);
        setStatus("success");

        const rangeMs = Math.max(toTimestamp - fromTimestamp, 0);
        const { spanForBin, binGranularity } = getBinParams(rangeMs);

        const xqlJobs = [
          { query: `dataset = alerts | filter host_name != null and host_name != "" | comp count_distinct(host_name) as unique_hosts`, withTimeframe: true, onResult: (rows: any[]) => setKpis(p => ({ ...p, impactedEndpoints: rows?.length ? Number(Object.values(rows[0])[0]) || 0 : 0 })) },
          { query: `dataset = alerts | filter user_name != null and to_string(user_name) != "" | comp count_distinct(to_string(user_name)) as unique_users`, withTimeframe: true, onResult: (rows: any[]) => setKpis(p => ({ ...p, impactedUsers: rows?.length ? Number(Object.values(rows[0])[0]) || 0 : 0 })) },
          { query: `config timeframe = 3650d | dataset = endpoints | filter operating_system != null and operating_system != "" | comp count_distinct(endpoint_id) as cnt by operating_system`, withTimeframe: false, onResult: (rows: any[]) => { if (rows) setOsDistribution(rows.map((r: any) => ({ os: String(r.operating_system), count: Number(r.cnt) || 0 })).sort((a: any, b: any) => b.count - a.count)); } },
          { query: `config timeframe = 3650d | dataset = endpoints | filter agent_version != null and agent_version != "" | comp count_distinct(endpoint_id) as cnt by agent_version`, withTimeframe: false, onResult: (rows: any[]) => { if (rows) setAgentVersions(rows.map((r: any) => ({ version: String(r.agent_version), count: Number(r.cnt) || 0 })).sort((a: any, b: any) => compareVersions(b.version, a.version))); } },
          { query: `dataset = alerts | filter category != null and category != "" | comp count() as cnt by category | sort desc cnt | limit 10`, withTimeframe: true, onResult: (rows: any[]) => { if (rows) setCategoryDistribution(rows.map((r: any) => ({ category: String(r.category), count: Number(r.cnt) || 0 })).sort((a: any, b: any) => b.count - a.count)); } },
          { query: `dataset = alerts | bin _time span = ${spanForBin} | comp count() as cnt by _time | sort asc _time`, withTimeframe: true, onResult: (rows: any[]) => { if (rows) { setAlertsTimeline(rows.map((r: any) => ({ time: Number(r._time), label: formatBinLabel(Number(r._time), binGranularity), count: Number(r.cnt) || 0 })).sort((a: any, b: any) => a.time - b.time)); setTimelineGranularity(binGranularity); } } },
          { query: `dataset = alerts | alter hour_of_day = extract_time(_time, "HOUR") | comp count() as cnt by hour_of_day | sort asc hour_of_day`, withTimeframe: true, onResult: (rows: any[]) => { if (rows) { const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2, "0")}h`, count: 0 })); rows.forEach((r: any) => { const h = Number(r.hour_of_day); if (h >= 0 && h < 24) hourly[h].count = Number(r.cnt) || 0; }); setHourlyDistribution(hourly); } } },
          { query: `dataset = alerts | filter host_name != null and host_name != "" | alter risk_weight = if(severity = "Critical", 4, if(severity = "High", 3, if(severity = "Medium", 2, 1))) | comp sum(risk_weight) as risk_score, count() as alert_count by host_name | sort desc risk_score | limit 10`, withTimeframe: true, onResult: (rows: any[]) => { if (rows) setTopEndpoints(rows.map((r: any) => ({ host: String(r.host_name), score: Number(r.risk_score) || 0, count: Number(r.alert_count) || 0 })).sort((a: any, b: any) => b.score - a.score)); } },
          { query: `dataset = alerts | filter user_name != null and to_string(user_name) != "" | alter user_name_str = to_string(user_name), risk_weight = if(severity = "Critical", 4, if(severity = "High", 3, if(severity = "Medium", 2, 1))) | comp sum(risk_weight) as risk_score, count() as alert_count by user_name_str | sort desc risk_score | limit 500`, withTimeframe: true, onResult: (rows: any[]) => { if (rows) setAllUsersAtRisk(rows.map((r: any) => ({ user: String(r.user_name_str), score: Number(r.risk_score) || 0, count: Number(r.alert_count) || 0 })).sort((a: any, b: any) => b.score - a.score)); } }
        ];

        await runJobsWithConcurrency(xqlJobs, fromTimestamp, toTimestamp, () => isCancelled);

      } catch (err: any) {
        if (!isCancelled) {
          console.error("❌ Exception critique :", err);
          setStatus("error");
          setMessage(`Erreur technique : ${err.message}`);
        }
      }
    };

    run();
    return () => { isCancelled = true; };
  }, [timePrefix, timeValue, timeUnit]);

  return { status, message, kpis, severityDistribution, agentVersions, osDistribution, categoryDistribution, alertsTimeline, timelineGranularity, hourlyDistribution, topEndpoints, allUsersAtRisk };
}

// ============================================================================
// SOUS-COMPOSANTS REACT DÉDIÉS
// ============================================================================

const InventoryModal = ({ isOpen, onClose, coverageTotal }: any) => {
  const [inventoryData, setInventoryData] = useState<any[] | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [osFilter, setOsFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    const fetchInventory = async () => {
      setInventoryLoading(true); setInventoryData([]); setInventoryError(null); setCurrentPage(1);
      try {
        const BATCH_SIZE = 100;
        const totalExpected = Math.max(0, coverageTotal); // Correction SonarQube : Remplacement du ternaire

        if (totalExpected === 0) { setInventoryData([]); setInventoryLoading(false); return; }

        const offsets: number[] = [];
        for (let i = 0; i < totalExpected; i += BATCH_SIZE) offsets.push(i);

        let allEndpoints: any[] = [];
        let cursor = 0;
        const runNext = async (): Promise<void> => {
          while (cursor < offsets.length) {
            const currentFrom = offsets[cursor];
            cursor += 1;
            if (isCancelled) return;
            try {
              const res = await apiCall(`/public_api/v1/endpoints/get_endpoint/`, { request_data: { search_from: currentFrom, search_to: currentFrom + BATCH_SIZE } });
              if (res.ok) allEndpoints = [...allEndpoints, ...((await res.json()).reply?.endpoints || [])];
            } catch (err) { console.error(`Erreur batch ${currentFrom}:`, err); }
          }
        };

        const workers = Array.from({ length: 3 }, () => runNext());
        await Promise.all(workers);
        if (isCancelled) return;
        allEndpoints.sort((a, b) => String(a.endpoint_name || "").localeCompare(String(b.endpoint_name || "")));
        setInventoryData(allEndpoints);
      } catch (err: any) {
        if (!isCancelled) setInventoryError(err.message || "Erreur de récupération.");
      } finally {
        if (!isCancelled) setInventoryLoading(false);
      }
    };
    fetchInventory();
    return () => { isCancelled = true; };
  }, [isOpen, coverageTotal]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, osFilter]);

  const uniqueOSList = useMemo(() => {
    if (!inventoryData) return [];
    // Correction SonarQube : Fonction de comparaison pour le tri
    return Array.from(new Set(inventoryData.map(ep => ep.operating_system).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  }, [inventoryData]);

  const filteredInventory = useMemo(() => {
    if (!inventoryData) return [];
    return inventoryData.filter(ep => {
      const searchLower = searchTerm.toLowerCase();
      const usersStr = Array.isArray(ep.users) ? ep.users.join(" ") : (ep.users || "");
      // Correction SonarQube : Chaînage optionnel au lieu de vérification "&&"
      const matchesSearch = searchTerm === "" || ep.endpoint_name?.toLowerCase().includes(searchLower) || usersStr.toLowerCase().includes(searchLower);
      const matchesStatus = statusFilter === "ALL" || ep.endpoint_status?.toLowerCase() === statusFilter.toLowerCase();
      const matchesOS = osFilter === "ALL" || ep.operating_system === osFilter;
      return matchesSearch && matchesStatus && matchesOS;
    });
  }, [inventoryData, searchTerm, statusFilter, osFilter]);

  if (!isOpen) return null;
  const totalPages = Math.ceil(filteredInventory.length / ITEMS_PER_PAGE);
  const paginatedInventory = filteredInventory.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border shadow-2xl rounded-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-border flex items-center justify-between bg-secondary/30 shrink-0">
          <h3 className="text-lg font-black text-foreground flex items-center gap-2"><Monitor className="w-5 h-5 text-indigo-500" /> Inventaire complet des Endpoints</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-3 bg-secondary/10 border-b border-border flex flex-col sm:flex-row gap-3 items-center shrink-0">
          <div className="relative flex-grow w-full sm:max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Rechercher (Endpoint ou Utilisateur)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-background border border-border text-foreground font-medium text-sm rounded-lg pl-9 pr-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none" disabled={inventoryLoading || !!inventoryError} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-auto bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer disabled:opacity-50" disabled={inventoryLoading || !!inventoryError}>
            <option value="ALL">Tous les statuts</option><option value="connected">Connecté</option><option value="disconnected">Déconnecté</option>
          </select>
          <select value={osFilter} onChange={(e) => setOsFilter(e.target.value)} className="w-full sm:w-auto bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer disabled:opacity-50 max-w-[220px] truncate" disabled={inventoryLoading || !!inventoryError}>
            <option value="ALL">Tous les OS</option>{uniqueOSList.map((os: any) => <option key={os} value={os}>{os}</option>)}
          </select>
          {!inventoryLoading && !inventoryError && inventoryData && (
            <div className="ml-auto text-xs font-bold text-muted-foreground bg-secondary/30 px-3 py-1.5 rounded-md border border-border whitespace-nowrap">
              {filteredInventory.length} {filteredInventory.length > 1 ? 'résultats' : 'résultat'} sur {inventoryData.length}
            </div>
          )}
        </div>
        <div className="flex-grow overflow-auto p-0 custom-scrollbar relative bg-background">
          {inventoryError ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-destructive p-8"><XCircle className="w-8 h-8" /><p className="text-sm font-medium text-center">{inventoryError}</p></div>
          ) : inventoryLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4 p-8"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /><p className="text-sm font-medium text-muted-foreground text-center">Récupération de l'inventaire en cours...</p></div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-secondary/95 sticky top-0 z-10 backdrop-blur-md shadow-sm">
                <tr><th className="p-3 font-bold text-muted-foreground border-b border-border">Endpoint</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Statut</th><th className="p-3 font-bold text-muted-foreground border-b border-border">OS</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Version Agent</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Utilisateur(s)</th></tr>
              </thead>
              <tbody>
                {paginatedInventory.map((ep: any, index: number) => {
                  const isConnected = ep.endpoint_status?.toLowerCase() === 'connected';
                  const users = Array.isArray(ep.users) ? ep.users.join(", ") : (ep.users || "N/A");
                  return (
                    <tr key={ep.endpoint_id || index} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                      <td className="p-3 font-bold text-foreground">{ep.endpoint_name || "N/A"}</td>
                      <td className="p-3"><span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${isConnected ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>{ep.endpoint_status || "N/A"}</span></td>
                      <td className="p-3 text-muted-foreground font-medium">{ep.operating_system || "N/A"}</td>
                      <td className="p-3 font-mono text-xs">{ep.agent_version || "N/A"}</td>
                      <td className="p-3 text-muted-foreground truncate max-w-[200px]" title={users}>{users}</td>
                    </tr>
                  );
                })}
                {filteredInventory.length === 0 && <tr><td colSpan={5} className="p-12 text-center text-muted-foreground italic">{inventoryData?.length === 0 ? "Aucun endpoint trouvé." : "Aucun endpoint ne correspond aux filtres."}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {!inventoryLoading && !inventoryError && totalPages > 1 && (
          <div className="p-3 border-t border-border bg-secondary/30 flex items-center justify-between shrink-0">
            <p className="text-xs font-medium text-muted-foreground">Page <span className="font-bold text-foreground">{currentPage}</span> sur <span className="font-bold text-foreground">{totalPages}</span></p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="flex items-center gap-1 text-xs font-bold bg-background border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"><ChevronLeft className="w-4 h-4" /> Précédent</button>
              <button type="button" onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="flex items-center gap-1 text-xs font-bold bg-background border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors">Suivant <ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const UsersRiskModal = ({ isOpen, onClose, allUsersAtRisk, hrMapping, hiddenUsers, toggleHideUser }: any) => {
  const [showHiddenUsers, setShowHiddenUsers] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => { setUsersPage(1); }, [userSearchTerm, showHiddenUsers]);

  const filteredAllUsers = useMemo(() => {
    if (!allUsersAtRisk) return [];
    const searchLower = userSearchTerm.toLowerCase();
    return allUsersAtRisk.filter((u: any) => {
      const domain = getDomainForUser(u.user, hrMapping);
      const matchesSearch = userSearchTerm === "" || u.user.toLowerCase().includes(searchLower) || domain.toLowerCase().includes(searchLower);
      const isHidden = hiddenUsers.has(u.user);
      return matchesSearch && (showHiddenUsers || !isHidden);
    });
  }, [allUsersAtRisk, userSearchTerm, hiddenUsers, showHiddenUsers, hrMapping]);

  if (!isOpen) return null;
  const usersTotalPages = Math.ceil(filteredAllUsers.length / ITEMS_PER_PAGE);
  const paginatedUsers = filteredAllUsers.slice((usersPage - 1) * ITEMS_PER_PAGE, usersPage * ITEMS_PER_PAGE);

  return (
    <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border shadow-2xl rounded-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-border flex items-center justify-between bg-secondary/30 shrink-0">
          <h3 className="text-lg font-black text-foreground flex items-center gap-2"><UserX className="w-5 h-5 text-amber-500" /> Tous les utilisateurs à risque</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-3 bg-secondary/10 border-b border-border flex flex-col sm:flex-row gap-3 items-center shrink-0">
          <div className="relative flex-grow w-full sm:max-w-sm"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="text" placeholder="Rechercher un utilisateur ou un domaine..." value={userSearchTerm} onChange={(e) => setUserSearchTerm(e.target.value)} className="w-full bg-background border border-border text-foreground font-medium text-sm rounded-lg pl-9 pr-3 py-1.5 focus:ring-2 focus:ring-amber-500 outline-none" disabled={!allUsersAtRisk} /></div>
          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground cursor-pointer whitespace-nowrap select-none"><input type="checkbox" checked={showHiddenUsers} onChange={(e) => setShowHiddenUsers(e.target.checked)} className="w-4 h-4 rounded border-border accent-amber-500 cursor-pointer" disabled={!allUsersAtRisk} />Afficher les masqués {hiddenUsers.size > 0 && `(${hiddenUsers.size})`}</label>
          {allUsersAtRisk && <div className="ml-auto text-xs font-bold text-muted-foreground bg-secondary/30 px-3 py-1.5 rounded-md border border-border whitespace-nowrap">{filteredAllUsers.length} {filteredAllUsers.length > 1 ? 'résultats' : 'résultat'} sur {allUsersAtRisk.length}</div>}
        </div>
        <div className="flex-grow overflow-auto p-0 custom-scrollbar relative bg-background">
          {!allUsersAtRisk ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4 p-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /><p className="text-sm font-medium text-muted-foreground text-center">Calcul XQL en cours...</p></div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-secondary/95 sticky top-0 z-10 backdrop-blur-md shadow-sm"><tr><th className="p-3 font-bold text-muted-foreground border-b border-border">Utilisateur</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Domaine RH</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Alertes déclenchées</th><th className="p-3 font-bold text-muted-foreground border-b border-border">Score de risque</th><th className="p-3 font-bold text-muted-foreground border-b border-border text-right">Action</th></tr></thead>
              <tbody>
                {paginatedUsers.map((u: any) => {
                  const isHidden = hiddenUsers.has(u.user);
                  const domain = getDomainForUser(u.user, hrMapping);
                  return (
                    <tr key={u.user} className={`border-b border-border/50 hover:bg-secondary/20 transition-colors ${isHidden ? "opacity-50" : ""}`}>
                      <td className="p-3 font-bold text-foreground">{u.user}</td>
                      <td className="p-3"><span className={`px-2 py-1 rounded-md text-[10px] font-bold border ${domain === "Non attribué" ? "bg-secondary/50 text-muted-foreground border-border" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}>{domain}</span></td>
                      <td className="p-3 text-muted-foreground font-medium">{u.count.toLocaleString()}</td>
                      <td className="p-3 font-black text-amber-500">{u.score.toLocaleString()}</td>
                      <td className="p-3 text-right"><button type="button" onClick={() => toggleHideUser(u.user)} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${isHidden ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20" : "text-muted-foreground bg-secondary/30 border-border hover:bg-secondary/50"}`}>{isHidden ? <><Eye className="w-3 h-3" /> Afficher</> : <><EyeOff className="w-3 h-3" /> Masquer</>}</button></td>
                    </tr>
                  );
                })}
                {filteredAllUsers.length === 0 && <tr><td colSpan={5} className="p-12 text-center text-muted-foreground italic">{allUsersAtRisk.length === 0 ? "Aucun utilisateur à risque." : "Aucun résultat."}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {allUsersAtRisk && usersTotalPages > 1 && (
          <div className="p-3 border-t border-border bg-secondary/30 flex items-center justify-between shrink-0">
            <p className="text-xs font-medium text-muted-foreground">Page <span className="font-bold text-foreground">{usersPage}</span> sur <span className="font-bold text-foreground">{usersTotalPages}</span></p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setUsersPage(p => Math.max(p - 1, 1))} disabled={usersPage === 1} className="flex items-center gap-1 text-xs font-bold bg-background border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"><ChevronLeft className="w-4 h-4" /> Précédent</button>
              <button type="button" onClick={() => setUsersPage(p => Math.min(p + 1, usersTotalPages))} disabled={usersPage === usersTotalPages} className="flex items-center gap-1 text-xs font-bold bg-background border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors">Suivant <ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const HrDomainSection = ({ hrFileMeta, hrMapping, allUsersAtRisk, hiddenUsers, handleFileUpload }: any) => {
  const [hrSearchTerm, setHrSearchTerm] = useState("");

  const departmentRiskDistribution = useMemo(() => {
    if (!allUsersAtRisk || Object.keys(hrMapping).length === 0) return null;
    const deptMap: Record<string, { score: number; count: number; users: Set<string> }> = {};
    allUsersAtRisk.forEach((u: any) => {
      if (hiddenUsers.has(u.user)) return;
      const dept = getDomainForUser(u.user, hrMapping);
      if (!deptMap[dept]) deptMap[dept] = { score: 0, count: 0, users: new Set() };
      deptMap[dept].score += u.score;
      deptMap[dept].count += u.count;
      deptMap[dept].users.add(u.user);
    });
    const totalScoreAllDepts = Object.values(deptMap).reduce((sum, d) => sum + d.score, 0);
    return Object.entries(deptMap).map(([department, data]) => ({
      department, score: data.score, count: data.count, userCount: data.users.size,
      avgScorePerUser: data.users.size > 0 ? data.score / data.users.size : 0,
      sharePct: totalScoreAllDepts > 0 ? (data.score / totalScoreAllDepts) * 100 : 0
    })).sort((a, b) => b.score - a.score);
  }, [allUsersAtRisk, hrMapping, hiddenUsers]);

  const filteredDist = useMemo(() => {
    if (!departmentRiskDistribution) return [];
    return departmentRiskDistribution.filter(d => hrSearchTerm === "" || d.department.toLowerCase().includes(hrSearchTerm.toLowerCase()));
  }, [departmentRiskDistribution, hrSearchTerm]);

  const renderContent = () => {
    if (Object.keys(hrMapping).length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <FileSpreadsheet className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground font-medium mb-4 leading-tight max-w-md">Importez votre base RH pour activer l'analyse par département.</p>
          <label className="cursor-pointer text-xs font-bold text-indigo-600 bg-indigo-500/10 px-4 py-2 rounded-md border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"><Upload className="w-3.5 h-3.5 inline mr-1.5" /> Charger Excel<input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} /></label>
        </div>
      );
    }
    if (!departmentRiskDistribution) {
      return <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /><span className="text-xs font-medium">Calcul XQL...</span></div>;
    }
    if (departmentRiskDistribution.length === 0) {
      return <p className="text-xs text-muted-foreground italic text-center py-12">Aucun domaine impacté sur la période.</p>;
    }
    return (
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="relative w-full sm:w-64"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="text" placeholder="Filtrer un domaine..." value={hrSearchTerm} onChange={(e) => setHrSearchTerm(e.target.value)} className="w-full bg-background border border-border text-foreground font-medium text-xs rounded-lg pl-9 pr-3 py-1.5 focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
        </div>
        <div className="overflow-auto rounded-lg border border-border/60 max-h-[350px] custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-secondary/60 sticky top-0 z-10 backdrop-blur-sm"><tr><th className="p-2.5 font-bold text-muted-foreground border-b border-border">Domaine</th><th className="p-2.5 font-bold text-muted-foreground border-b border-border text-right">Utilisateurs</th><th className="p-2.5 font-bold text-muted-foreground border-b border-border text-right">Alertes</th><th className="p-2.5 font-bold text-muted-foreground border-b border-border text-right">Score total</th><th className="p-2.5 font-bold text-muted-foreground border-b border-border text-right">Score moy. / util.</th><th className="p-2.5 font-bold text-muted-foreground border-b border-border text-right">Part du risque</th></tr></thead>
            <tbody>
              {filteredDist.map((d: any, index: number) => {
                const color = DOMAIN_PALETTE[index % DOMAIN_PALETTE.length];
                return (
                  <tr key={d.department} className="border-b border-border/40 hover:bg-secondary/20 transition-colors">
                    <td className="p-2.5 font-bold text-foreground"><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />{d.department}</span></td>
                    <td className="p-2.5 text-muted-foreground font-medium text-right">{d.userCount.toLocaleString()}</td>
                    <td className="p-2.5 text-muted-foreground font-medium text-right">{d.count.toLocaleString()}</td>
                    <td className="p-2.5 font-black text-foreground text-right">{d.score.toLocaleString()}</td>
                    <td className="p-2.5 text-muted-foreground font-medium text-right">{d.avgScorePerUser.toFixed(1)}</td>
                    <td className="p-2.5 text-right"><span className="inline-flex items-center gap-1.5 justify-end w-full"><span className="font-bold text-foreground">{d.sharePct.toFixed(1)}%</span><span className="w-14 h-1.5 rounded-full bg-secondary/60 overflow-hidden hidden sm:inline-block"><span className="block h-full rounded-full" style={{ width: `${d.sharePct}%`, backgroundColor: color }} /></span></span></td>
                  </tr>
                );
              })}
              {filteredDist.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground italic">Aucun domaine trouvé.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <Card className="border border-border shadow-sm flex flex-col mt-4">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-bold text-foreground uppercase flex items-center gap-2"><Briefcase className="w-4.5 h-4.5 text-emerald-500" /> Analyse du risque par domaine RH</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {hrFileMeta ? (
              <>
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" />{hrFileMeta.fileName}</span>
                <span className="text-[10px] font-medium text-muted-foreground">importé le {new Date(hrFileMeta.importedAt).toLocaleDateString("fr-FR")}</span>
                <label className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-500/10 px-2.5 py-1 rounded-md border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"><Upload className="w-3.5 h-3.5" /> Remplacer<input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} /></label>
              </>
            ) : <span className="text-[11px] font-bold text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-md border border-border">Base RH manquante</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">{renderContent()}</CardContent>
    </Card>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL (Coordinateur)
// ============================================================================

export default function CortexPanel() {
  const [timePrefix, setTimePrefix] = useState<"last" | "this" | "next">("last");
  const [timeValue, setTimeValue] = useState<number>(30);
  const [timeUnit, setTimeUnit] = useState<"days" | "months" | "years">("days");

  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());

  const [hrMapping, setHrMapping] = useState<Record<string, string>>({});
  const [hrFileMeta, setHrFileMeta] = useState<any>(null);

  const cortexData = useCortexData(timePrefix, timeValue, timeUnit);
  const [categoryTooltip, setCategoryTooltip] = useState<any>(null);

  useEffect(() => {
    try {
      const savedMapping = localStorage.getItem(HR_MAPPING_STORAGE_KEY);
      const savedMeta = localStorage.getItem(HR_MAPPING_META_STORAGE_KEY);
      if (savedMapping) setHrMapping(JSON.parse(savedMapping));
      if (savedMeta) setHrFileMeta(JSON.parse(savedMeta));
    } catch (err) { console.error("Erreur Restauration RH", err); }
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        // Correction SonarQube : Utilisation de readAsArrayBuffer au lieu de readAsBinaryString
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

        const newMapping: Record<string, string> = {};
        data.forEach((row: any) => {
          const keys = Object.keys(row);
          const idKey = keys.find(k => k.trim().toUpperCase() === 'IDUNIQUE');
          const domainKey = keys.find(k => k.trim().toUpperCase() === 'DOMAINE');
          if (idKey && domainKey && row[idKey]) newMapping[String(row[idKey]).trim().toLowerCase()] = String(row[domainKey]).trim();
        });
        const newMeta = { fileName: file.name, importedAt: new Date().toISOString(), rowCount: Object.keys(newMapping).length };
        setHrMapping(newMapping); setHrFileMeta(newMeta);
        localStorage.setItem(HR_MAPPING_STORAGE_KEY, JSON.stringify(newMapping));
        localStorage.setItem(HR_MAPPING_META_STORAGE_KEY, JSON.stringify(newMeta));
      } catch (err) { alert("Erreur Fichier Excel."); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const toggleHideUser = (user: string) => {
    setHiddenUsers(prev => {
      const next = new Set(prev);
      if (next.has(user)) next.delete(user); else next.add(user);
      return next;
    });
  };

  // Pré-calculs pour les vues principales
  const totalSeveritiesCount = cortexData.severityDistribution ? cortexData.severityDistribution.reduce((s: number, v: any) => s + v.count, 0) : 0;
  const totalCategories = cortexData.categoryDistribution ? cortexData.categoryDistribution.reduce((s: number, c: any) => s + c.count, 0) : 0;

  const totalAgents = cortexData.agentVersions ? cortexData.agentVersions.reduce((sum: number, v: any) => sum + v.count, 0) : 0;
  const referenceVersion = cortexData.agentVersions?.length ? cortexData.agentVersions.reduce((max: string, v: any) => (compareVersions(v.version, max) > 0 ? v.version : max), cortexData.agentVersions[0].version) : null;
  const referenceKey = referenceVersion ? referenceVersion.split(".").slice(0, 3).join(".") : null;
  const upToDateCount = cortexData.agentVersions ? cortexData.agentVersions.filter((v: any) => v.version.split(".").slice(0, 3).join(".") === referenceKey).reduce((sum: number, v: any) => sum + v.count, 0) : 0;
  const outdatedCount = totalAgents - upToDateCount;

  const totalOs = cortexData.osDistribution ? cortexData.osDistribution.reduce((sum: number, o: any) => sum + o.count, 0) : 0;
  const visibleTopUsers = useMemo(() => cortexData.allUsersAtRisk ? cortexData.allUsersAtRisk.filter((u: any) => !hiddenUsers.has(u.user)).slice(0, 10) : null, [cortexData.allUsersAtRisk, hiddenUsers]);

  // Fonctions de rendu extraites pour éliminer les ternaires imbriqués dans le composant principal
  const renderSeverityPieChart = () => {
    if (!cortexData.severityDistribution) return <Loader2 className="w-6 h-6 animate-spin text-orange-500" />;
    if (cortexData.severityDistribution.length === 0) return <p className="text-xs text-muted-foreground italic">Aucune alerte.</p>;
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={cortexData.severityDistribution.map(s => ({ name: getSeverityStyle(s.severity).label, severity: s.severity, value: s.count, color: getSeverityStyle(s.severity).color }))} innerRadius={65} outerRadius={95} paddingAngle={3} dataKey="value" stroke="none">
            {cortexData.severityDistribution.map((entry: any) => <Cell key={entry.severity} fill={getSeverityStyle(entry.severity).color} />)}
          </Pie>
          <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  const renderSeverityList = () => {
    if (!cortexData.severityDistribution) return <Loader2 className="w-6 h-6 animate-spin text-orange-500 mx-auto" />;
    if (cortexData.severityDistribution.length === 0) return <p className="text-center text-muted-foreground text-xs py-8">Aucune alerte à afficher.</p>;
    return (
      <div className="space-y-3.5 overflow-y-auto pr-2 max-h-[240px] custom-scrollbar">
        {cortexData.severityDistribution.map((s: any) => {
          const style = getSeverityStyle(s.severity);
          const percentage = totalSeveritiesCount > 0 ? ((s.count / totalSeveritiesCount) * 100).toFixed(1) : "0";
          return (
            <div key={s.severity} className="relative flex items-center justify-between p-3 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden">
              <div className="absolute top-0 left-0 h-full opacity-15" style={{ width: `${percentage}%`, backgroundColor: style.color }} />
              <div className="relative z-10 flex items-center gap-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: style.color }} />
                <span className="font-bold text-sm uppercase tracking-wide" style={{ color: style.color }}>{style.label}</span>
              </div>
              <div className="relative z-10 flex items-center gap-6">
                <span className="font-bold text-muted-foreground text-xs w-12 text-right">{percentage}%</span>
                <span className="font-black text-foreground text-base w-16 text-right">{s.count.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderTimelineChart = () => {
    if (!cortexData.alertsTimeline) return <Loader2 className="w-6 h-6 animate-spin text-purple-500" />;
    if (cortexData.alertsTimeline.length === 0) return <p className="text-xs text-muted-foreground italic">Aucune alerte.</p>;
    return (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={cortexData.alertsTimeline}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 600 }} />
          <YAxis tick={{ fontSize: 10, fontWeight: 600 }} allowDecimals={false} />
          <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
          <Line type="monotone" dataKey="count" name="Alertes" stroke="#8b5cf6" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  const renderHourlyChart = () => {
    if (!cortexData.hourlyDistribution) return <Loader2 className="w-6 h-6 animate-spin text-sky-500" />;
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={cortexData.hourlyDistribution}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fontWeight: 600 }} interval={2} />
          <YAxis tick={{ fontSize: 10, fontWeight: 600 }} allowDecimals={false} />
          <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
          <Bar dataKey="count" name="Alertes" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="space-y-6 relative">
      <InventoryModal isOpen={isInventoryOpen} onClose={() => setIsInventoryOpen(false)} coverageTotal={cortexData.kpis.coverageTotal} />
      <UsersRiskModal isOpen={isUsersModalOpen} onClose={() => setIsUsersModalOpen(false)} allUsersAtRisk={cortexData.allUsersAtRisk} hrMapping={hrMapping} hiddenUsers={hiddenUsers} toggleHideUser={toggleHideUser} />

      {/* HEADER & FILTRES */}
      <div className="border-b border-border pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-foreground flex items-center gap-3"><Activity className="w-7 h-7 text-purple-500" /> Évaluation des Risques</h2>
          <p className="text-muted-foreground font-medium mt-1">Synthèse globale de la surface d'attaque et des incidents de sécurité Cortex</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-secondary/20 p-2 rounded-xl border border-border">
          <Calendar className="w-4 h-4 text-muted-foreground ml-2" />
          <select value={timePrefix} onChange={(e) => setTimePrefix(e.target.value as "last"|"this"|"next")} className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 outline-none"><option value="last">Dernier(s)</option><option value="this">Ce/Cette</option><option value="next">Suivant(s)</option></select>
          {timePrefix !== "this" && <input type="number" min="1" value={timeValue} onChange={(e) => setTimeValue(Number(e.target.value))} className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 w-20 outline-none" />}
          <select value={timeUnit} onChange={(e) => setTimeUnit(e.target.value as "days"|"months"|"years")} className="bg-background border border-border text-foreground font-bold text-sm rounded-lg px-3 py-1.5 outline-none"><option value="days">Jour(s)</option><option value="months">Mois</option><option value="years">Année(s)</option></select>
        </div>
      </div>

      {cortexData.status === "loading" && <div className="flex flex-col items-center justify-center py-20 space-y-4"><Loader2 className="w-10 h-10 text-purple-500 animate-spin" /><p className="text-muted-foreground font-medium">{cortexData.message}</p></div>}
      {cortexData.status === "error" && <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive"><XCircle className="w-6 h-6 shrink-0" /><div><h4 className="font-bold text-sm uppercase">Échec de synchronisation</h4><p className="text-xs opacity-90 mt-0.5">{cortexData.message}</p></div></div>}

      {cortexData.status === "success" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card shadow-sm border-l-4 border-l-blue-500"><CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0"><CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Couverture Endpoints</CardTitle><div className="p-1.5 bg-blue-500/10 rounded-md"><Cpu className="w-4 h-4 text-blue-600" /></div></CardHeader><CardContent><div className="flex items-baseline gap-2"><span className="text-3xl font-black text-foreground">{cortexData.kpis.coverageConnected.toLocaleString()}</span><span className="text-sm font-bold text-muted-foreground">/ {cortexData.kpis.coverageTotal.toLocaleString()}</span></div><p className="text-[11px] font-medium text-muted-foreground mt-1">Agents actuellement connectés</p></CardContent></Card>
            <Card className="bg-card shadow-sm border-l-4 border-l-purple-500"><CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0"><CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Volume d&apos;Alertes</CardTitle><div className="p-1.5 bg-purple-500/10 rounded-md"><AlertOctagon className="w-4 h-4 text-purple-600" /></div></CardHeader><CardContent><div className="text-3xl font-black text-foreground">{cortexData.kpis.totalAlerts.toLocaleString()}</div><p className="text-[11px] font-medium text-muted-foreground mt-1">Total généré sur la période</p></CardContent></Card>
            <Card className="bg-card shadow-sm border-l-4 border-l-orange-500"><CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0"><CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Endpoints Impactés</CardTitle><div className="p-1.5 bg-orange-500/10 rounded-md"><Target className="w-4 h-4 text-orange-600" /></div></CardHeader><CardContent>{cortexData.kpis.impactedEndpoints === null ? <div className="flex items-center gap-2 text-muted-foreground mt-1"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /><span className="text-xs font-medium">Calcul XQL...</span></div> : <><div className="text-3xl font-black text-foreground">{cortexData.kpis.impactedEndpoints.toLocaleString()}</div><p className="text-[11px] font-medium text-muted-foreground mt-1">Hôtes distincts impactés</p></>}</CardContent></Card>
            <Card className="bg-card shadow-sm border-l-4 border-l-emerald-500"><CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0"><CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Utilisateurs Impactés</CardTitle><div className="p-1.5 bg-emerald-500/10 rounded-md"><Users className="w-4 h-4 text-emerald-600" /></div></CardHeader><CardContent>{cortexData.kpis.impactedUsers === null ? <div className="flex items-center gap-2 text-muted-foreground mt-1"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /><span className="text-xs font-medium">Calcul XQL...</span></div> : <><div className="text-3xl font-black text-foreground">{cortexData.kpis.impactedUsers.toLocaleString()}</div><p className="text-[11px] font-medium text-muted-foreground mt-1">Comptes distincts impactés</p></>}</CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> Sévérité des alertes</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col items-center justify-center min-h-[280px]">
                {renderSeverityPieChart()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2 border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Détail par niveau de risque</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col justify-center">
                {renderSeverityList()}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
            <Card className="lg:col-span-2 border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0 flex flex-row justify-between"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><TrendingUp className="w-4 h-4 text-purple-500" /> Évolution du volume d&apos;alertes</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow flex items-center justify-center min-h-[260px]">
                {renderTimelineChart()}
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><Clock className="w-4 h-4 text-sky-500" /> Répartition horaire des alertes</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow flex items-center justify-center min-h-[260px]">
                {renderHourlyChart()}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50 h-[56px]"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><Layers className="w-4 h-4 text-violet-500" /> Répartition par catégorie</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow">
                {!cortexData.categoryDistribution ? <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto" /> : cortexData.categoryDistribution.length === 0 ? <p className="text-center text-muted-foreground text-xs py-8">Aucune catégorie.</p> : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {cortexData.categoryDistribution.map((c: any, i: number) => {
                      const color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
                      const percentage = totalCategories > 0 ? ((c.count / totalCategories) * 100).toFixed(1) : "0";
                      return (
                        <div key={c.category} onMouseEnter={(e) => setCategoryTooltip({ category: c.category, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top })} onMouseLeave={() => setCategoryTooltip(null)} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden">
                          <div className="absolute top-0 left-0 h-full opacity-15" style={{ width: `${percentage}%`, backgroundColor: color }} />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} /><span className="font-bold text-foreground text-xs truncate">{c.category}</span></div>
                          <div className="relative z-10 flex items-center gap-4 shrink-0"><span className="font-bold text-muted-foreground text-[10px] w-10 text-right">{percentage}%</span><span className="font-black text-foreground text-sm w-12 text-right">{c.count.toLocaleString()}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50 h-[56px]">
                <div className="flex items-center justify-between"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><ServerCrash className="w-4 h-4 text-rose-500" /> Top endpoints à risque</CardTitle><button type="button" onClick={() => setIsInventoryOpen(true)} className="text-[10px] font-bold text-indigo-600 bg-indigo-500/10 px-2 py-1 rounded-md border border-indigo-500/20"><Monitor className="w-3 h-3 inline" /> Inventaire</button></div>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {!cortexData.topEndpoints ? <Loader2 className="w-6 h-6 animate-spin text-rose-500 mx-auto" /> : cortexData.topEndpoints.length === 0 ? <p className="text-center text-muted-foreground text-xs py-8">Aucun endpoint.</p> : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {cortexData.topEndpoints.map((e: any, i: number) => {
                      const maxScore = cortexData.topEndpoints[0]?.score || 1;
                      const percentage = ((e.score / maxScore) * 100).toFixed(0);
                      return (
                        <div key={e.host} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden">
                          <div className="absolute top-0 left-0 h-full opacity-15 bg-rose-500" style={{ width: `${percentage}%` }} />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden"><span className="font-black text-rose-500 text-[10px] w-4 shrink-0">#{i + 1}</span><span className="font-bold text-foreground text-xs truncate">{e.host}</span></div>
                          <div className="relative z-10 flex items-center gap-4 shrink-0"><span className="font-bold text-muted-foreground text-[10px]">{e.count} alerte{e.count > 1 ? "s" : ""}</span><span className="font-black text-rose-500 text-sm w-10 text-right">{e.score.toLocaleString()}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50 h-[56px]">
                <div className="flex items-center justify-between"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><UserX className="w-4 h-4 text-amber-500" /> Top utilisateurs à risque</CardTitle><button type="button" onClick={() => setIsUsersModalOpen(true)} className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20"><Users className="w-3 h-3 inline" /> Tous</button></div>
              </CardHeader>
              <CardContent className="pt-4 flex-grow">
                {!visibleTopUsers ? <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto" /> : visibleTopUsers.length === 0 ? <p className="text-center text-muted-foreground text-xs py-8">Aucun utilisateur.</p> : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {visibleTopUsers.map((u: any, i: number) => {
                      const maxScore = visibleTopUsers[0]?.score || 1;
                      const percentage = ((u.score / maxScore) * 100).toFixed(0);
                      return (
                        <div key={u.user} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden">
                          <div className="absolute top-0 left-0 h-full opacity-15 bg-amber-500" style={{ width: `${percentage}%` }} />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden"><span className="font-black text-amber-500 text-[10px] w-4 shrink-0">#{i + 1}</span><span className="font-bold text-foreground text-xs truncate">{u.user}</span></div>
                          <div className="relative z-10 flex items-center gap-4 shrink-0"><span className="font-bold text-muted-foreground text-[10px]">{u.count} alerte{u.count > 1 ? "s" : ""}</span><span className="font-black text-amber-500 text-sm w-10 text-right">{u.score.toLocaleString()}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <HrDomainSection hrFileMeta={hrFileMeta} hrMapping={hrMapping} allUsersAtRisk={cortexData.allUsersAtRisk} hiddenUsers={hiddenUsers} handleFileUpload={handleFileUpload} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-0"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-500" /> Statut global des agents</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow flex flex-col items-center justify-center min-h-[260px]">
                {cortexData.agentVersions === null ? <Loader2 className="w-6 h-6 animate-spin text-teal-500" /> : cortexData.agentVersions.length === 0 ? <p className="text-xs text-muted-foreground italic">Aucune donnée.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={[{ name: "À jour", value: upToDateCount, color: "#14b8a6" }, { name: "Obsolète", value: outdatedCount, color: "#64748b" }].filter(s => s.value > 0)} innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value" stroke="none">
                        {[{ name: "À jour", color: "#14b8a6" }, { name: "Obsolète", color: "#64748b" }].map((entry: any) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '12px', fontWeight: 'bold' }} itemStyle={{ color: 'var(--foreground)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50 h-[56px]"><div className="flex justify-between items-center"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-500" /> Versions des agents</CardTitle>{referenceVersion && <span className="text-[10px] font-bold text-teal-600 bg-teal-500/10 px-2 py-1 rounded-md border border-teal-500/20">Ref: {referenceVersion}</span>}</div></CardHeader>
              <CardContent className="pt-4 flex-grow">
                {cortexData.agentVersions === null ? <Loader2 className="w-6 h-6 animate-spin text-teal-500 mx-auto" /> : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[220px] custom-scrollbar">
                    {cortexData.agentVersions.map((v: any) => {
                      const isRef = v.version.split(".").slice(0, 3).join(".") === referenceKey;
                      const percentage = totalAgents > 0 ? ((v.count / totalAgents) * 100).toFixed(1) : "0";
                      return (
                        <div key={v.version} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/10 overflow-hidden">
                          <div className={`absolute top-0 left-0 h-full opacity-10 ${isRef ? 'bg-teal-500' : 'bg-slate-500'}`} style={{ width: `${percentage}%` }} />
                          <span className={`relative z-10 font-mono text-[11px] md:text-xs font-bold truncate ${isRef ? "text-teal-500" : "text-foreground"}`}>{v.version}</span>
                          <div className="relative z-10 flex items-center gap-2 shrink-0"><span className="font-bold text-muted-foreground text-[10px] w-8 text-right">{percentage}%</span><span className="font-black text-foreground text-xs w-8 text-right">{v.count.toLocaleString()}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm flex flex-col">
              <CardHeader className="pb-2 border-b border-border/50 h-[56px]"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2"><Monitor className="w-4 h-4 text-sky-500" /> Parc OS</CardTitle></CardHeader>
              <CardContent className="pt-4 flex-grow">
                {cortexData.osDistribution === null ? <Loader2 className="w-6 h-6 animate-spin text-sky-500 mx-auto" /> : (
                  <div className="space-y-2.5 overflow-y-auto pr-2 max-h-[220px] custom-scrollbar">
                    {cortexData.osDistribution.map((o: any, index: number) => {
                      const color = OS_PALETTE[index % OS_PALETTE.length];
                      const percentage = totalOs > 0 ? ((o.count / totalOs) * 100).toFixed(1) : "0";
                      return (
                        <div key={o.os} className="relative flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/5 overflow-hidden">
                          <div className="absolute top-0 left-0 h-full opacity-20" style={{ width: `${percentage}%`, backgroundColor: color }} />
                          <div className="relative z-10 flex items-center gap-2 overflow-hidden"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} /><span className="font-bold text-foreground text-[11px] md:text-xs truncate">{o.os}</span></div>
                          <div className="relative z-10 flex items-center gap-2 shrink-0"><span className="font-bold text-muted-foreground text-[10px] w-8 text-right">{percentage}%</span><span className="font-black text-foreground text-xs w-8 text-right">{o.count.toLocaleString()}</span></div>
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

      {categoryTooltip && (
        <div className="pointer-events-none fixed z-[100] w-64" style={{ left: Math.min(categoryTooltip.x, window.innerWidth - 272), top: categoryTooltip.y - 8, transform: "translateY(-100%)" }}>
          <div className="bg-popover text-popover-foreground text-xs rounded-lg border border-border shadow-lg p-3"><p className="font-bold mb-1 text-foreground">{categoryTooltip.category}</p><p className="text-muted-foreground leading-snug">{getCategoryDescription(categoryTooltip.category)}</p></div>
        </div>
      )}
    </div>
  );
}