import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Globe, TrendingUp, TrendingDown, ShieldCheck,
  Activity, ArrowUpRight, ArrowDownRight, AlertOctagon,
  ShieldAlert, Lock, Cpu, X, Info, Server, ExternalLink, Filter, Search, Target, Mail, Network
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart as RechartsBarChart, Bar,
  CartesianGrid, Tooltip as RechartsTooltip, Legend, XAxis, YAxis, Cell
} from "recharts";

// Dictionnaire officiel des libellés de vecteurs de risque BitSight
const BITSIGHT_VECTOR_NAMES: Record<string, string> = {
  ssl_configurations: "SSL Configurations", spf: "SPF", dmarc: "DMARC", dkim: "DKIM",
  open_ports: "Open Ports", patching: "Patching", vulnerabilities: "Vulnerabilities",
  botnets: "Botnets", malware: "Malware", desktop_software: "Desktop Software",
  server_software: "Server Software", file_sharing: "File Sharing", dns: "DNS",
  ip_reputation: "IP Reputation", web_application: "Application Security",
  social_engineering: "Social Engineering", mobile_applications: "Mobile Applications",
  network_filtering: "Network Filtering", tls_ssl: "SSL/TLS"
};

// ============================================================================
// SOUS-FONCTIONS UTILITAIRES (Pour éliminer la complexité et les ternaires)
// ============================================================================

// Générateur d'ID sécurisé (remplace Math.random)
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const array = new Uint32Array(1);
  if (typeof window !== 'undefined' && window.crypto) window.crypto.getRandomValues(array);
  return `id-${array[0].toString(16)}-${Date.now().toString(36)}`;
};

const isAssetMatchingFilter = (asset: any, filter: string) => {
  if (filter === 'domains') return asset.type === 'Domaine';
  if (filter === 'ips') return asset.type === 'IP Publique';
  if (filter === 'critical') return asset.riskLevel === 'Critique';
  return true;
};

const sortTechsByRisk = (a: any, b: any) => {
  if (a.risk === 'Élevé' && b.risk !== 'Élevé') return -1;
  if (a.risk !== 'Élevé' && b.risk === 'Élevé') return 1;
  return 0;
};

const getSeverityBadgeProps = (severity: string): { variant: "destructive" | "default" | "secondary" | "outline", className: string } => {
  if (severity === 'Critique' || severity === 'Matériel') return { variant: 'destructive', className: '' };
  if (severity === 'Modéré') return { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-600 text-white' };
  return { variant: 'secondary', className: '' };
};

const getTechRiskBadgeVariant = (risk: string): "destructive" | "secondary" => {
  return risk === 'Élevé' ? 'destructive' : 'secondary';
};

const getScoreCardStyles = (score: number) => {
  if (score < 600) return { borderClass: 'border-l-destructive', iconClass: 'text-destructive' };
  if (score < 700) return { borderClass: 'border-l-orange-500', iconClass: 'text-orange-500' };
  return { borderClass: 'border-l-emerald-500', iconClass: 'text-emerald-500' };
};

const getTrendStyle = (trend: string) => {
  if (trend.startsWith('+')) return { color: "text-emerald-500", bg: "bg-emerald-500/10", Icon: TrendingUp };
  if (trend.startsWith('-')) return { color: "text-destructive", bg: "bg-destructive/10", Icon: TrendingDown };
  return { color: "text-slate-500", bg: "bg-slate-500/10", Icon: Activity };
};

const getAssetFilterStyle = (currentFilter: string, targetFilter: string) => {
  const isSelected = currentFilter === targetFilter;
  if (targetFilter === 'critical') {
    return isSelected ? 'bg-destructive/20 border-destructive ring-2 ring-destructive/50' : 'bg-destructive/10 border-destructive/20 hover:bg-destructive/20';
  }
  return isSelected ? 'bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/50' : 'bg-secondary/20 border-border hover:bg-secondary/40';
};

const getHygieneCardClass = (grade: string) => {
  if (grade === 'A' || grade === 'B') return 'border-emerald-500/20 bg-emerald-500/5';
  if (grade === 'N/A') return 'border-border bg-secondary/10';
  return 'border-destructive/20 bg-destructive/5';
};

const getHygieneBadgeClass = (grade: string) => {
  if (grade === 'A' || grade === 'B') return 'bg-emerald-500';
  if (grade === 'N/A') return 'bg-slate-500';
  return 'bg-destructive';
};


// ============================================================================
// SOUS-FONCTIONS API
// ============================================================================

const processScoreAndPosture = (ratingData: any, realData: any) => {
  realData.executive.score = ratingData.current_rating || 0;
  realData.executive.industryName = ratingData.industry || "Secteur inconnu";

  if (ratingData.rating_industry_median === "below") realData.executive.percentile = "Sous la moyenne";
  else if (ratingData.rating_industry_median === "above") realData.executive.percentile = "Au-dessus";
  else realData.executive.percentile = "Dans la moyenne";

  realData.attackSurface.publicIpsCount = ratingData.ipv4_count || 0;
  realData.executive.monitoredAssets = ratingData.ipv4_count || 0;

  if (ratingData.rating_details && typeof ratingData.rating_details === 'object') {
    const categoriesList: any[] = [];
    const positiveList: any[] = [];
    const negativeList: any[] = [];

    Object.entries(ratingData.rating_details).forEach(([key, val]: [string, any]) => {
      const officialName = BITSIGHT_VECTOR_NAMES[key] || key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const grade = val.grade || 'B';
      let progressScore = 70;

      if (grade === 'A' || grade === 'GOOD') {
        progressScore = 95;
        positiveList.push({ factor: officialName, impact: "Conforme (A)" });
      } else if (grade === 'B' || grade === 'WARN') {
        // default 70
      } else {
        progressScore = 40;
        negativeList.push({ factor: officialName, impact: `Risque (${grade})` });
      }

      categoriesList.push({ name: officialName, key: key, score: progressScore, rating: grade.charAt(0).toUpperCase() });
    });

    realData.scorePosture.categories = categoriesList;
    realData.scorePosture.positiveFactors = positiveList.slice(0, 3);
    realData.scorePosture.negativeFactors = negativeList.slice(0, 3);
  }
};

const processHistoricalRatings = (ratingData: any, realData: any) => {
  if (!Array.isArray(ratingData.ratings) || ratingData.ratings.length === 0) return;
  const sortedRatings = [...ratingData.ratings].sort((a: any, b: any) => a.rating_date.localeCompare(b.rating_date));
  const currentScore = realData.executive.score;

  const getRatingDaysAgo = (days: number) => {
    if (sortedRatings.length === 0) return null;
    const latestDate = new Date(sortedRatings[sortedRatings.length - 1].rating_date);
    latestDate.setDate(latestDate.getDate() - days);
    const targetStr = latestDate.toISOString().split('T')[0];

    let match = sortedRatings.find(r => r.rating_date === targetStr);
    if (!match) match = sortedRatings[Math.max(0, sortedRatings.length - 1 - days)];
    return match ? match.rating : null;
  };

  const formatDiff = (pastScore: number | null) => {
    if (pastScore === null) return "N/A";
    const diff = currentScore - pastScore;
    // Correction SonarQube : Déstructuration du ternaire imbriqué en if/else
    if (diff === 0) return "0";
    if (diff > 0) return `+${diff}`;
    return `${diff}`;
  };

  realData.executive.trends = {
    d7: formatDiff(getRatingDaysAgo(7)),
    d30: formatDiff(getRatingDaysAgo(30)),
    d90: formatDiff(getRatingDaysAgo(90))
  };

  const monthlyMap = new Map();
  sortedRatings.forEach((r: any) => { if (r.rating_date) monthlyMap.set(r.rating_date.substring(0, 7), r.rating); });

  realData.scorePosture.historical = Array.from(monthlyMap.entries()).map(([monthKey, score]) => {
    const [year, month] = monthKey.split('-');
    const dateObj = new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, 1);
    const formattedLabel = dateObj.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    return { month: formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1), score, industry: null, topPeers: null };
  });
};

const processFindings = (allData: any, realData: any) => {
  realData.executive.totalFindings = allData.count || 0;
  realData.findings.kpis.total = allData.count || 0;

  if (allData.results && Array.isArray(allData.results)) {
    const uniqueFindingsMap = new Map();

    allData.results.forEach((f: any) => {
      let assetList = "Actif inconnu";
      if (Array.isArray(f.assets) && f.assets.length > 0) assetList = f.assets.map((a: any) => a.asset).filter(Boolean).join(", ");

      const vectorLabel = f.risk_vector_label || BITSIGHT_VECTOR_NAMES[f.risk_vector] || "Autre";
      const uniqueKey = `${assetList}::${vectorLabel}`;
      const parsedDate = new Date(f.first_seen || "1970-01-01").getTime();

      if (!uniqueFindingsMap.has(uniqueKey) || parsedDate > uniqueFindingsMap.get(uniqueKey).parsedDate) {
        uniqueFindingsMap.set(uniqueKey, { ...f, assetList, vectorLabel, parsedDate });
      }
    });

    realData.findings.list = Array.from(uniqueFindingsMap.values()).map((f: any) => {
      const rawSeverity = f.severity_category || "minor";
      let sevLabel = "Mineur";
      if (rawSeverity === "severe") sevLabel = "Critique";
      else if (rawSeverity === "material") sevLabel = "Matériel";
      else if (rawSeverity === "moderate") sevLabel = "Modéré";

      return {
        id: generateId(), finding: f.vectorLabel, vectorKey: f.risk_vector, severity: sevLabel,
        severityKey: rawSeverity, asset: f.assetList, status: "Ouvert",
        discoveryDate: f.first_seen || "Récemment", rawDateMs: f.parsedDate
      };
    }).sort((a, b) => b.rawDateMs - a.rawDateMs);
  }
};

const processPriorityRisks = (findingsData: any, realData: any) => {
  if (findingsData && Array.isArray(findingsData.results)) {
    realData.executive.criticalRisks = findingsData.count || 0;
    realData.priorityRisks = findingsData.results.map((finding: any, index: number) => {
      let assetList = "Actif inconnu";
      if (Array.isArray(finding.assets) && finding.assets.length > 0) assetList = finding.assets.map((a: any) => a.asset).filter(Boolean).join(", ");

      return {
        id: `RSK-${index + 1}`, risk: finding.risk_vector_label || "Vulnérabilité critique", severity: "Critique",
        impactScore: `Sévérité ${finding.severity || 'N/A'}`, assets: assetList, discoveryDate: finding.first_seen || "Récemment",
        lastSeen: finding.last_seen || "Récemment", status: "Ouvert",
        details: { remediations: finding.details?.remediations || [], ips: finding.details?.observed_ips || [], evidence: finding.evidence_key || assetList }
      };
    });
  }
};

const processAssetsAndTech = (assetsData: any, realData: any) => {
  if (assetsData && typeof assetsData.count === 'number') realData.executive.monitoredAssets = assetsData.count;

  if (assetsData && Array.isArray(assetsData.results)) {
    let criticalCount = 0; let ipCount = 0; let domainCount = 0;
    const techList: any[] = [];

    realData.attackSurface.riskyAssets = assetsData.results.map((asset: any) => {
      const category = String(asset.importance_category || "").toLowerCase();
      const importanceNum = Number(asset.importance);
      const severeFindings = asset.findings?.counts_by_severity?.severe || 0;
      const materialFindings = asset.findings?.counts_by_severity?.material || 0;

      let riskLabel = "Faible";
      if (category === "critical" || importanceNum === 1 || severeFindings > 0 || materialFindings > 0) { riskLabel = "Critique"; criticalCount++; }
      else if (category === "high" || importanceNum === 2) riskLabel = "Élevé";
      else if (category === "medium" || importanceNum === 3) riskLabel = "Moyen";

      let typeLabel = "Domaine";
      if (asset.is_ip === true || asset.asset_type === "IP" || asset.type === "ip") { typeLabel = "IP Publique"; ipCount++; }
      else domainCount++;

      if (Array.isArray(asset.products)) {
        asset.products.forEach((prod: any) => {
          if (prod.vendor && prod.vendor !== "unknown") {
            const version = prod.version || 'Version non détectée';
            let techRisk = "Normal";
            if (version.startsWith('7.') || version.startsWith('5.') || prod.vendor === 'centos') techRisk = "Élevé";
            techList.push({
              id: generateId(), name: `${prod.vendor.charAt(0).toUpperCase() + prod.vendor.slice(1)} ${prod.product ? prod.product.replace(/_/g, ' ') : ''}`,
              version: version, type: prod.type || 'application', asset: asset.asset || 'Actif non spécifié', risk: techRisk
            });
          }
        });
      }

      return {
        id: generateId(), asset: asset.asset || "Actif sans nom", type: typeLabel, riskLevel: riskLabel,
        findings: asset.findings?.total_count || 0,
        countsBySeverity: asset.findings?.counts_by_severity || { severe: 0, material: 0, moderate: 0, minor: 0 },
        vendors: Array.isArray(asset.products) ? asset.products.map((p: any) => p.vendor).filter(Boolean) : []
      };
    });

    realData.attackSurface.publicIpsCount = ipCount;
    realData.attackSurface.domainsCount = domainCount;
    realData.attackSurface.criticalAssetsCount = criticalCount;
    realData.techShadowIt.technologies = techList;
  }
};

const processHygiene = (realData: any) => {
  if (realData.scorePosture.categories.length > 0) {
    const getCat = (keys: string[]) => realData.scorePosture.categories.find((c: any) => keys.includes(c.key));
    const setHygiene = (target: any, cat: any) => {
      if (cat) {
        target.grade = cat.rating; target.score = cat.score;
        if (cat.rating === 'A') target.status = "Optimal";
        else if (cat.rating === 'B') target.status = "Acceptable";
        else if (cat.rating === 'C') target.status = "Vulnérable";
        else target.status = "Critique";
      }
    };
    setHygiene(realData.hygiene.ssl, getCat(['ssl_configurations', 'tls_ssl']));
    setHygiene(realData.hygiene.dns, getCat(['spf', 'dkim', 'dmarc', 'dns']));
    setHygiene(realData.hygiene.ports, getCat(['open_ports']));
  }

  if (realData.findings.list.length > 0) {
    realData.findings.list.forEach((f: any) => {
      if (['ssl_configurations', 'tls_ssl'].includes(f.vectorKey)) realData.hygiene.ssl.findings++;
      if (['spf', 'dkim', 'dmarc', 'dns'].includes(f.vectorKey)) realData.hygiene.dns.findings++;
      if (['open_ports'].includes(f.vectorKey)) realData.hygiene.ports.findings++;
    });
  }
};

const fetchBitsightDetails = async () => {
  const realData = {
    executive: { score: 0, maxScore: 900, trends: { d7: "N/A", d30: "N/A", d90: "N/A" }, industryName: "N/A", percentile: "N/A", monitoredAssets: 0, newAssets: 0, totalFindings: 0, criticalRisks: 0 },
    scorePosture: { historical: [] as any[], positiveFactors: [] as any[], negativeFactors: [] as any[], categories: [] as any[] },
    priorityRisks: [] as any[],
    attackSurface: { totalExposed: 0, newAssetsCount: 0, domainsCount: 0, subdomainsCount: 0, publicIpsCount: 0, criticalAssetsCount: 0, exposedServicesCount: 0, technologiesCount: 0, riskyAssets: [] as any[] },
    findings: { kpis: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, severityDistribution: [] as any[], categoryDistribution: [] as any[], agingData: [], list: [] as any[] },
    hygiene: { ssl: { grade: "N/A", score: 0, findings: 0, status: "Inconnu" }, dns: { grade: "N/A", score: 0, findings: 0, status: "Inconnu" }, ports: { grade: "N/A", score: 0, findings: 0, status: "Inconnu" } },
    techShadowIt: { technologies: [], shadowIt: [] }
  };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return realData;

  const call = async (path: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams({ path, ...params }).toString();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bitsight-proxy?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!res.ok) throw new Error(`Erreur API BitSight : ${res.status}`);
    return res.json();
  };

  try {
    const ratingData = await call("");
    processScoreAndPosture(ratingData, realData);
    processHistoricalRatings(ratingData, realData);
  } catch (e) { console.error(e); }

  try {
    const allData = await call("findings", { limit: "500" });
    processFindings(allData, realData);
  } catch (e) { console.error(e); }

  try {
    const findingsData = await call("findings", { severity_category: "severe", limit: "10" });
    processPriorityRisks(findingsData, realData);
  } catch (e) { console.error(e); }

  try {
    const assetsData = await call("assets", { limit: "1000" });
    processAssetsAndTech(assetsData, realData);
  } catch (e) { console.error(e); }

  processHygiene(realData);
  return realData;
};

// ============================================================================
// HOOK DE TRAITEMENT (Pour retirer la logique du composant)
// ============================================================================

function useBitsightDataProcessing(data: any, filters: any, selectedAssetForFindings: string | null) {
  return useMemo(() => {
    if (!data) return {} as any;
    const {
      assetFilter, modalAssetSearch, modalAssetTypeFilter, modalAssetRiskFilter,
      modalTechSearch, modalTechRiskFilter, findingSeverityFilter, findingVectorFilter,
      modalFindingSearch
    } = filters;

    const allAssets = [...(data.attackSurface.riskyAssets || [])].sort((a, b) => (b.findings || 0) - (a.findings || 0));
    const fAssets = allAssets.filter(a => isAssetMatchingFilter(a, assetFilter));

    const mAssets = allAssets.filter(a => {
      const ms = modalAssetSearch.toLowerCase();
      return (a.asset.toLowerCase().includes(ms) || a.vendors?.join(' ').toLowerCase().includes(ms)) &&
             (modalAssetTypeFilter === "all" || a.type === modalAssetTypeFilter) &&
             (modalAssetRiskFilter === "all" || a.riskLevel === modalAssetRiskFilter);
    });

    const counts: Record<string, number> = {};
    fAssets.forEach(a => a.vendors?.forEach((v: string) => {
      const label = v.charAt(0).toUpperCase() + v.slice(1);
      counts[label] = (counts[label] || 0) + 1;
    }));
    const aTechs = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);

    const sTechs = [...(data.techShadowIt.technologies || [])].sort(sortTechsByRisk);
    const mTechs = sTechs.filter(t => (t.name.toLowerCase().includes(modalTechSearch.toLowerCase()) || t.asset.toLowerCase().includes(modalTechSearch.toLowerCase())) && (modalTechRiskFilter === "all" || t.risk === modalTechRiskFilter));

    const rFind = data.findings.list || [];
    const fFind = rFind.filter((f: any) => (findingSeverityFilter === "all" || f.severityKey === findingSeverityFilter) && (findingVectorFilter === "all" || f.vectorKey === findingVectorFilter));

    const sc = { Critique: 0, Matériel: 0, Modéré: 0, Mineur: 0 };
    rFind.filter((f: any) => findingVectorFilter === "all" || f.vectorKey === findingVectorFilter).forEach((f: any) => sc[f.severity as keyof typeof sc]++);
    const sevDist = [
      { name: 'Critique', value: sc.Critique, color: '#ef4444', key: 'severe' },
      { name: 'Matériel', value: sc.Matériel, color: '#f97316', key: 'material' },
      { name: 'Modéré', value: sc.Modéré, color: '#eab308', key: 'moderate' },
      { name: 'Mineur', value: sc.Mineur, color: '#3b82f6', key: 'minor' }
    ];

    const cm: Record<string, any> = {};
    rFind.filter((f: any) => findingSeverityFilter === "all" || f.severityKey === findingSeverityFilter).forEach((f: any) => {
      if (!cm[f.finding]) { cm[f.finding] = { count: 0, key: f.vectorKey }; }
      cm[f.finding].count++;
    });

    const catDist = Object.entries(cm).map(([category, details]) => ({ category, count: details.count, vectorKey: details.key })).sort((a, b) => b.count - a.count).slice(0, 10);

    const mFind = fFind.filter((f: any) => f.asset.toLowerCase().includes(modalFindingSearch.toLowerCase()) || f.finding.toLowerCase().includes(modalFindingSearch.toLowerCase()));
    const spFind = rFind.filter((f: any) => selectedAssetForFindings && f.asset.includes(selectedAssetForFindings));

    return {
      top10Assets: fAssets.slice(0, 10), modalFilteredAssets: mAssets, activeTopTechnologies: aTechs,
      top10Techs: sTechs.slice(0, 10), modalFilteredTechs: mTechs, displayFindings: fFind.slice(0, 10), dynamicSeverityDistribution: sevDist,
      dynamicCategoryDistribution: catDist, modalFilteredFindings: mFind, specificAssetFindings: spFind
    };
  }, [data, filters, selectedAssetForFindings]);
}

// ============================================================================
// SOUS-COMPOSANTS REACT (Pour réduire la complexité cognitive de la vue principale)
// ============================================================================

const RiskModal = ({ selectedRisk, onClose }: any) => {
  if (!selectedRisk) return null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-background/50 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg bg-card h-full shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-start justify-between p-6 border-b border-border bg-secondary/20">
          <div>
            <Badge variant="destructive" className="mb-3 font-bold uppercase">{selectedRisk.impactScore}</Badge>
            <h3 className="text-xl font-black flex items-center gap-2 text-foreground"><AlertOctagon className="w-6 h-6 text-destructive" />{selectedRisk.risk}</h3>
            <p className="text-sm text-muted-foreground font-mono mt-2">{selectedRisk.id}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors">
            <X className="w-5 h-5 text-foreground" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><span className="text-xs font-bold text-muted-foreground uppercase">Première découverte</span><p className="text-sm font-medium">{selectedRisk.discoveryDate}</p></div>
            <div className="space-y-1"><span className="text-xs font-bold text-muted-foreground uppercase">Dernière vue</span><p className="text-sm font-medium">{selectedRisk.lastSeen}</p></div>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-blue-500"/> Preuve d'exposition</h4>
            <div className="p-3 bg-secondary/30 rounded-lg border border-border font-mono text-sm text-foreground break-all">{selectedRisk.details.evidence}</div>
          </div>
          {selectedRisk.details.ips && selectedRisk.details.ips.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-bold flex items-center gap-2"><Server className="w-4 h-4 text-purple-500"/> IPs Observées</h4>
              <div className="p-3 bg-secondary/30 rounded-lg border border-border flex flex-wrap gap-2">
                {selectedRisk.details.ips.map((ip: string) => <Badge key={ip} variant="outline" className="font-mono bg-background">{ip}</Badge>)}
              </div>
            </div>
          )}
          <div className="space-y-3 pt-4 border-t border-border">
            <h4 className="text-sm font-bold flex items-center gap-2"><Info className="w-4 h-4 text-emerald-500"/> Pistes de Remédiation</h4>
            {selectedRisk.details.remediations && selectedRisk.details.remediations.length > 0 ? (
              <div className="space-y-3">
                {selectedRisk.details.remediations.map((rem: any) => (
                  <div key={rem.message} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                    <strong className="text-sm text-foreground block">{rem.message}</strong>
                    {rem.help_text && <p className="text-xs text-muted-foreground">{rem.help_text}</p>}
                    {rem.remediation_tip && (
                      <div
                        className="text-xs text-blue-500 font-medium mt-2 break-words [&_a]:underline [&_a]:text-blue-600 hover:[&_a]:text-blue-800"
                        dangerouslySetInnerHTML={{ __html: rem.remediation_tip }}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground italic p-4 bg-secondary/20 rounded-lg border border-border">Aucune recommandation automatique fournie par l'API.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

const AssetsModal = ({ isOpen, onClose, modalFilteredAssets, data, filters, setFilters }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 transition-opacity">
      <div className="w-full max-w-[90vw] bg-card rounded-2xl shadow-2xl border border-border flex flex-col animate-in fade-in zoom-in-95 duration-200 h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-border bg-secondary/20 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-xl font-black flex items-center gap-2 text-foreground"><Globe className="w-6 h-6 text-blue-500" /> Inventaire de la surface d'attaque</h3>
            <p className="text-sm text-muted-foreground mt-1">Affichage de {modalFilteredAssets.length} actifs sur un total de {data.attackSurface.riskyAssets.length}.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-wrap gap-4 p-4 border-b border-border bg-secondary/5 shrink-0">
          <div className="relative flex-1 min-w-[250px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="text" placeholder="Rechercher une IP, un domaine ou une techno..." value={filters.modalAssetSearch} onChange={(e) => setFilters({...filters, modalAssetSearch: e.target.value})} className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <select value={filters.modalAssetTypeFilter} onChange={(e) => setFilters({...filters, modalAssetTypeFilter: e.target.value})} className="bg-background border border-border text-sm rounded-lg px-4 py-2 outline-none cursor-pointer"><option value="all">Tous les types</option><option value="Domaine">Domaine</option><option value="IP Publique">IP Publique</option></select>
          <select value={filters.modalAssetRiskFilter} onChange={(e) => setFilters({...filters, modalAssetRiskFilter: e.target.value})} className="bg-background border border-border text-sm rounded-lg px-4 py-2 outline-none cursor-pointer"><option value="all">Toutes les criticités</option><option value="Critique">Critique</option><option value="Élevé">Élevé</option><option value="Moyen">Moyen</option><option value="Faible">Faible</option></select>
        </div>
        <div className="overflow-y-auto flex-1 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm"><TableRow><TableHead className="pl-6">Actif</TableHead><TableHead>Type</TableHead><TableHead>Technologies Détectées</TableHead><TableHead>Criticité</TableHead><TableHead className="text-right pr-6">Failles (Findings)</TableHead></TableRow></TableHeader>
            <TableBody>
              {modalFilteredAssets.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">Aucun actif ne correspond.</TableCell></TableRow> : null}
              {modalFilteredAssets.map((a: any) => {
                const badgeProps = getSeverityBadgeProps(a.riskLevel);
                return (
                  <TableRow key={a.id} className="hover:bg-secondary/40">
                    <TableCell className="font-mono text-xs font-bold text-foreground pl-6">{a.asset}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.type}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground uppercase">{a.vendors?.length > 0 ? a.vendors.join(', ') : "-"}</TableCell>
                    <TableCell><Badge variant={badgeProps.variant} className={badgeProps.className}>{a.riskLevel}</Badge></TableCell>
                    <TableCell className="font-bold text-sm text-right pr-6">{a.findings}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

const SpecificAssetFindingsModal = ({ asset, specificAssetFindings, onClose }: any) => {
  if (!asset) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 transition-opacity">
      <div className="w-full max-w-4xl bg-card rounded-2xl shadow-2xl border border-border flex flex-col animate-in fade-in zoom-in-95 duration-200 h-[85vh]">
        <div className="flex items-center justify-between p-6 border-b border-border bg-secondary/20 rounded-t-2xl shrink-0">
          <div>
            <Badge variant="outline" className="mb-2 bg-background">Ciblage d'actif</Badge>
            <h3 className="text-xl font-black flex items-center gap-2 text-foreground"><Target className="w-6 h-6 text-indigo-500" /> Détail des vulnérabilités</h3>
            <p className="text-sm font-mono text-indigo-500 font-bold mt-1">{asset}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors"><X className="w-5 h-5 text-foreground" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm"><TableRow><TableHead className="pl-6">Vulnérabilité (Vecteur)</TableHead><TableHead>Sévérité</TableHead><TableHead>Dernière Découverte</TableHead></TableRow></TableHeader>
            <TableBody>
              {specificAssetFindings.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-sm text-muted-foreground">Aucune vulnérabilité trouvée pour cet actif.</TableCell></TableRow> : null}
              {specificAssetFindings.map((f: any) => {
                const badgeProps = getSeverityBadgeProps(f.severity);
                return (
                  <TableRow key={f.id} className="hover:bg-secondary/40">
                    <TableCell className="font-bold text-sm text-foreground pl-6">{f.finding}</TableCell>
                    <TableCell><Badge variant={badgeProps.variant} className={badgeProps.className}>{f.severity}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{f.discoveryDate}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

const FindingsModal = ({ isOpen, onClose, modalFilteredFindings, data, filters, setFilters, setSelectedAssetForFindings }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 transition-opacity">
      <div className="w-full max-w-[90vw] bg-card rounded-2xl shadow-2xl border border-border flex flex-col animate-in fade-in zoom-in-95 duration-200 h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-border bg-secondary/20 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-xl font-black flex items-center gap-2 text-foreground"><ShieldAlert className="w-6 h-6 text-orange-500" /> Inventaire exhaustif des vulnérabilités</h3>
            <p className="text-sm text-muted-foreground mt-1">Affichage de {modalFilteredFindings.length} failles sur un total de {data.findings.list.length} (dédoublonnées par actif).</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-wrap gap-4 p-4 border-b border-border bg-secondary/5 shrink-0">
          <div className="relative flex-1 min-w-[250px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="text" placeholder="Rechercher par faille ou par actif..." value={filters.modalFindingSearch} onChange={(e) => setFilters({...filters, modalFindingSearch: e.target.value})} className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none" /></div>
          <select value={filters.findingSeverityFilter} onChange={(e) => setFilters({...filters, findingSeverityFilter: e.target.value})} className="bg-background border border-border text-sm rounded-lg px-4 py-2 outline-none cursor-pointer"><option value="all">Toutes les sévérités</option><option value="severe">Critique</option><option value="material">Matériel</option><option value="moderate">Modéré</option><option value="minor">Mineur</option></select>
          <select value={filters.findingVectorFilter} onChange={(e) => setFilters({...filters, findingVectorFilter: e.target.value})} className="bg-background border border-border text-sm rounded-lg px-4 py-2 outline-none cursor-pointer max-w-[200px] truncate"><option value="all">Tous les vecteurs</option>{Object.entries(BITSIGHT_VECTOR_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </div>
        <div className="overflow-y-auto flex-1 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm"><TableRow><TableHead className="pl-6">Vulnérabilité (Vecteur)</TableHead><TableHead>Sévérité</TableHead><TableHead>Actif Associé (Cliquez pour cibler)</TableHead><TableHead>Statut</TableHead><TableHead className="pr-6">Dernière Découverte</TableHead></TableRow></TableHeader>
            <TableBody>
              {modalFilteredFindings.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">Aucune faille ne correspond.</TableCell></TableRow> : null}
              {modalFilteredFindings.map((f: any) => {
                const badgeProps = getSeverityBadgeProps(f.severity);
                return (
                  <TableRow key={f.id} className="hover:bg-secondary/40">
                    <TableCell className="font-bold text-sm text-foreground pl-6">{f.finding}</TableCell>
                    <TableCell><Badge variant={badgeProps.variant} className={badgeProps.className}>{f.severity}</Badge></TableCell>
                    <TableCell><button type="button" onClick={() => setSelectedAssetForFindings(f.asset)} className="font-mono text-xs max-w-[250px] truncate block text-blue-500 hover:text-blue-600 hover:underline transition-colors text-left bg-transparent border-none p-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500" title={`Voir toutes les failles pour ${f.asset}`}>{f.asset}</button></TableCell>
                    <TableCell className="text-xs">{f.status}</TableCell>
                    <TableCell className="text-xs text-muted-foreground pr-6">{f.discoveryDate}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

const TechModal = ({ isOpen, onClose, modalFilteredTechs, data, filters, setFilters }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 transition-opacity">
      <div className="w-full max-w-[90vw] bg-card rounded-2xl shadow-2xl border border-border flex flex-col animate-in fade-in zoom-in-95 duration-200 h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-border bg-secondary/20 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-xl font-black flex items-center gap-2 text-foreground"><Cpu className="w-6 h-6 text-purple-500" /> Inventaire des technologies</h3>
            <p className="text-sm text-muted-foreground mt-1">Affichage de {modalFilteredTechs.length} technologies sur un total de {data.techShadowIt.technologies.length}.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-wrap gap-4 p-4 border-b border-border bg-secondary/5 shrink-0">
          <div className="relative flex-1 min-w-[250px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="text" placeholder="Rechercher une technologie, version ou actif..." value={filters.modalTechSearch} onChange={(e) => setFilters({...filters, modalTechSearch: e.target.value})} className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" /></div>
          <select value={filters.modalTechRiskFilter} onChange={(e) => setFilters({...filters, modalTechRiskFilter: e.target.value})} className="bg-background border border-border text-sm rounded-lg px-4 py-2 outline-none cursor-pointer"><option value="all">Tous les risques</option><option value="Élevé">Élevé</option><option value="Normal">Normal</option></select>
        </div>
        <div className="overflow-y-auto flex-1 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm"><TableRow><TableHead className="pl-6">Technologie / Logiciel</TableHead><TableHead>Version</TableHead><TableHead>Actif Associé</TableHead><TableHead className="pr-6">Niveau de Risque</TableHead></TableRow></TableHeader>
            <TableBody>
              {modalFilteredTechs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">Aucune technologie ne correspond.</TableCell></TableRow> : null}
              {modalFilteredTechs.map((t: any) => (
                <TableRow key={t.id} className="hover:bg-secondary/40">
                  <TableCell className="font-bold text-sm text-foreground pl-6">{t.name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{t.version}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{t.asset}</TableCell>
                  <TableCell className="pr-6"><Badge variant={getTechRiskBadgeVariant(t.risk)}>{t.risk}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

const ExecutiveSummary = ({ data }: { data: any }) => {
  const scoreStyles = getScoreCardStyles(data.executive.score);
  const d30Style = getTrendStyle(data.executive.trends.d30);

  // Utilisation d'un objet (map) pour corriger l'erreur de SonarQube sur le ternaire imbriqué
  const trendDaysMap: Record<string, string> = { d7: '7', d30: '30', d90: '90' };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
      <Card className={`lg:col-span-2 border-l-4 ${scoreStyles.borderClass} bg-card shadow-sm flex flex-col justify-between`}>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">BitSight Rating</CardTitle>
          <ShieldCheck className={`w-5 h-5 ${scoreStyles.iconClass}`} />
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black tracking-tight text-foreground">{data.executive.score}</span>
            <span className="text-sm text-muted-foreground font-medium">/ {data.executive.maxScore}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge className={`${d30Style.bg} ${d30Style.color} font-bold border-none`}>
              <d30Style.Icon className="w-3.5 h-3.5 mr-1" /> {data.executive.trends.d30} {data.executive.trends.d30 !== "N/A" && data.executive.trends.d30 !== "0" ? "pts (30j)" : ""}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tendance</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {['d7', 'd30', 'd90'].map(d => {
            const trendStr = data.executive.trends[d as keyof typeof data.executive.trends];
            const tStyle = getTrendStyle(trendStr);
            const daysLabel = trendDaysMap[d] || '90';

            return (
              <div key={d} className="flex justify-between items-center">
                <span>{daysLabel} jours:</span>
                <span className={`font-bold flex items-center gap-1 ${tStyle.color}`}><tStyle.Icon className="w-3 h-3" /> {trendStr}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Benchmark</CardTitle></CardHeader>
        <CardContent>
          <div className={`text-2xl font-black ${data.executive.percentile === 'Sous la moyenne' ? 'text-orange-500' : 'text-blue-500'}`}>{data.executive.percentile}</div>
          <p className="text-[11px] text-muted-foreground mt-1">Secteur: <strong className="uppercase">{data.executive.industryName}</strong></p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Actifs Exposés</CardTitle></CardHeader>
        <CardContent>
          <div className="text-2xl font-black text-foreground">{data.executive.monitoredAssets.toLocaleString()}</div>
          <p className="text-[11px] text-muted-foreground mt-1">Empreinte globale</p>
        </CardContent>
      </Card>

      <Card className={`lg:col-span-1 border-t-4 ${data.executive.criticalRisks > 0 ? 'border-t-destructive' : 'border-t-emerald-500'} bg-card shadow-sm flex flex-col justify-between`}>
        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Risques Actifs</CardTitle></CardHeader>
        <CardContent>
          <div className={`text-2xl font-black ${data.executive.criticalRisks > 0 ? 'text-destructive' : 'text-emerald-500'}`}>{data.executive.criticalRisks} <span className="text-xs text-muted-foreground font-normal">sévères</span></div>
          <p className="text-[11px] text-muted-foreground mt-1">Findings: {data.executive.totalFindings}</p>
        </CardContent>
      </Card>
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function BitsightPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['bitsight-real-data-v45'],
    queryFn: fetchBitsightDetails,
    refetchInterval: 1000 * 60 * 15,
  });

  const [selectedRisk, setSelectedRisk] = useState<any>(null);
  const [isAssetsModalOpen, setIsAssetsModalOpen] = useState(false);
  const [isFindingsModalOpen, setIsFindingsModalOpen] = useState(false);
  const [selectedAssetForFindings, setSelectedAssetForFindings] = useState<string | null>(null);
  const [isTechModalOpen, setIsTechModalOpen] = useState(false);

  // Regroupement des filtres pour faciliter la transmission
  const [filters, setFilters] = useState({
    assetFilter: 'all' as 'all' | 'domains' | 'ips' | 'critical',
    modalAssetSearch: "",
    modalAssetTypeFilter: "all",
    modalAssetRiskFilter: "all",
    findingSeverityFilter: "all",
    findingVectorFilter: "all",
    modalFindingSearch: "",
    modalTechSearch: "",
    modalTechRiskFilter: "all"
  });

  const {
    top10Assets, modalFilteredAssets, activeTopTechnologies,
    top10Techs, modalFilteredTechs, displayFindings, dynamicSeverityDistribution, dynamicCategoryDistribution,
    modalFilteredFindings, specificAssetFindings
  } = useBitsightDataProcessing(data, filters, selectedAssetForFindings);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <Globe className="w-10 h-10 text-emerald-500 animate-spin opacity-50" />
        <p className="text-muted-foreground font-medium animate-pulse">Extraction des données brutes depuis BitSight...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      <RiskModal selectedRisk={selectedRisk} onClose={() => setSelectedRisk(null)} />
      <AssetsModal isOpen={isAssetsModalOpen} onClose={() => setIsAssetsModalOpen(false)} modalFilteredAssets={modalFilteredAssets} data={data} filters={filters} setFilters={setFilters} />
      <SpecificAssetFindingsModal asset={selectedAssetForFindings} specificAssetFindings={specificAssetFindings} onClose={() => setSelectedAssetForFindings(null)} />
      <FindingsModal isOpen={isFindingsModalOpen} onClose={() => setIsFindingsModalOpen(false)} modalFilteredFindings={modalFilteredFindings} data={data} filters={filters} setFilters={setFilters} setSelectedAssetForFindings={setSelectedAssetForFindings} />
      <TechModal isOpen={isTechModalOpen} onClose={() => setIsTechModalOpen(false)} modalFilteredTechs={modalFilteredTechs} data={data} filters={filters} setFilters={setFilters} />

      <ExecutiveSummary data={data} />

      {/* 2. Score & Posture */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2"><Activity className="w-5 h-5 text-blue-500" /> 2. Score & Posture de Sécurité</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase">Évolution du Security Rating</h4>
              <div className="h-64 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.scorePosture.historical} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="scoreColor" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.1} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis domain={[600, 850]} axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <RechartsTooltip />
                    <Legend verticalAlign="top" height={36}/>
                    <Area type="monotone" dataKey="score" name="Posture de l'Entreprise" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#scoreColor)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-muted-foreground uppercase">Facteurs d'impact</h4>
              <div className="space-y-2">
                <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1"><ArrowUpRight className="w-4 h-4"/> Impacts Positifs</span>
                {data.scorePosture.positiveFactors.length === 0 ? <p className="text-xs text-muted-foreground italic">Aucun facteur positif majeur</p> : null}
                {data.scorePosture.positiveFactors.map((f: any) => (
                  <div key={f.factor} className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex justify-between items-center text-xs">
                    <span className="text-foreground truncate max-w-[150px]" title={f.factor}>{f.factor}</span><Badge className="bg-emerald-500 text-white font-bold">{f.impact}</Badge>
                  </div>
                ))}
              </div>
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-destructive flex items-center gap-1"><ArrowDownRight className="w-4 h-4"/> Impacts Négatifs</span>
                {data.scorePosture.negativeFactors.length === 0 ? <p className="text-xs text-muted-foreground italic">Aucun facteur négatif majeur</p> : null}
                {data.scorePosture.negativeFactors.map((f: any) => (
                  <div key={f.factor} className="p-2.5 bg-destructive/5 border border-destructive/20 rounded-lg flex justify-between items-center text-xs">
                    <span className="text-foreground truncate max-w-[150px]" title={f.factor}>{f.factor}</span><Badge variant="destructive" className="font-bold">{f.impact}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4">Répartition par Catégorie (Vecteurs de Risque)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.scorePosture.categories.length === 0 ? <p className="text-xs text-muted-foreground col-span-4 italic">Données de catégorie non chargées</p> : null}
              {data.scorePosture.categories.map((cat: any) => (
                <div key={cat.key} className="p-4 bg-secondary/20 rounded-xl border border-border space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground truncate max-w-[160px]" title={cat.name}>{cat.name}</span>
                    <Badge variant={cat.rating === 'A' || cat.rating === 'G' ? 'default' : 'secondary'} className={cat.rating === 'A' || cat.rating === 'G' ? 'bg-emerald-500 text-white' : 'bg-orange-500 text-white'}>{cat.rating}</Badge>
                  </div>
                  <Progress value={cat.score} className="h-1.5" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" className="w-full space-y-4">

        {/* 3. Risques Sévères Prioritaires */}
        <AccordionItem value="item-3" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-3 text-base font-bold text-foreground"><AlertOctagon className="w-5 h-5 text-destructive" /> 3. Risques Sévères Prioritaires</div>
              <Badge variant="destructive">{data.executive.criticalRisks} Sévères au total</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <div className="px-6 py-3 bg-destructive/5 border-b border-border text-xs text-muted-foreground flex items-center gap-2">
              <Info className="w-4 h-4 text-destructive shrink-0" />
              <span>Le compteur global représente l'ensemble des occurrences critiques recensées. Le tableau ci-dessous présente le Top 10 prioritaire.</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Risque / Finding</TableHead>
                  <TableHead>Gravité</TableHead>
                  <TableHead>Impact Score</TableHead>
                  <TableHead>Actifs Concernés</TableHead>
                  <TableHead>Découverte</TableHead>
                  <TableHead className="text-right pr-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.priorityRisks.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-4 text-xs text-muted-foreground">Aucun risque sévère détecté</TableCell></TableRow> : null}
                {data.priorityRisks.map((r: any) => (
                  <TableRow key={r.id} onClick={() => setSelectedRisk(r)} className="cursor-pointer hover:bg-secondary/40 transition-colors group">
                    <TableCell className="font-bold text-sm pl-6"><span className="block text-blue-600 group-hover:text-blue-500">{r.risk}</span><span className="text-xs text-muted-foreground font-mono">{r.id}</span></TableCell>
                    <TableCell><Badge variant="destructive">{r.severity}</Badge></TableCell>
                    <TableCell className="font-bold text-muted-foreground">{r.impactScore}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.assets}</TableCell>
                    <TableCell className="text-xs">{r.discoveryDate}</TableCell>
                    <TableCell className="text-right pr-6"><Badge variant="outline" className="group-hover:bg-background shadow-sm cursor-pointer">Détails</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* 4. Surface d'Attaque */}
        <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold"><Globe className="w-5 h-5 text-blue-500" /> 4. Surface d'Attaque Externe</div>
          </AccordionTrigger>
          <AccordionContent className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <button type="button" onClick={() => setFilters(p => ({...p, assetFilter: p.assetFilter === 'domains' ? 'all' : 'domains'}))} className={`p-4 border rounded-xl cursor-pointer transition-all focus:outline-none w-full text-center flex flex-col items-center justify-center ${getAssetFilterStyle(filters.assetFilter, 'domains')}`}>
                <span className="block text-2xl font-black text-foreground">{data.attackSurface.domainsCount || 0}</span>
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Domaines & Sous-domaines</span>
              </button>
              <button type="button" onClick={() => setFilters(p => ({...p, assetFilter: p.assetFilter === 'ips' ? 'all' : 'ips'}))} className={`p-4 border rounded-xl cursor-pointer transition-all focus:outline-none w-full text-center flex flex-col items-center justify-center ${getAssetFilterStyle(filters.assetFilter, 'ips')}`}>
                <span className="block text-2xl font-black text-foreground">{data.attackSurface.publicIpsCount || 0}</span>
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">IPs Publiques</span>
              </button>
              <button type="button" onClick={() => setFilters(p => ({...p, assetFilter: p.assetFilter === 'critical' ? 'all' : 'critical'}))} className={`p-4 border rounded-xl cursor-pointer transition-all focus:outline-none w-full text-center flex flex-col items-center justify-center ${getAssetFilterStyle(filters.assetFilter, 'critical')}`}>
                <span className="block text-2xl font-black text-destructive">{data.attackSurface.criticalAssetsCount || 0}</span>
                <span className="text-[11px] font-bold text-destructive uppercase tracking-wider">Actifs Critiques</span>
              </button>
            </div>
            <div className="p-5 border border-border rounded-xl">
              <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Top 5 Technologies Exposées</h5>
              <div className="h-48">
                {activeTopTechnologies.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={activeTopTechnologies} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" tick={{fontSize: 11, fill: 'currentColor'}} axisLine={false} tickLine={false} width={120} />
                      <RechartsTooltip cursor={{fill: 'transparent'}} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                        {activeTopTechnologies.map((entry: any, index: number) => (<Cell key={`cell-${entry.name}`} fill={index === 0 ? '#3b82f6' : '#60a5fa'} />))}
                      </Bar>
                    </RechartsBarChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Aucune technologie identifiée</div>}
              </div>
            </div>
            <div>
              <h5 className="text-sm font-bold flex items-center justify-between mb-4"><span>Top 10 des actifs les plus vulnérables</span></h5>
              <div className="border border-border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/5">
                      <TableHead>Actif</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Tech / OS</TableHead>
                      <TableHead>Criticité</TableHead>
                      <TableHead className="text-right">Findings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top10Assets.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground">Aucun actif spécifique remonté</TableCell></TableRow> : null}
                    {top10Assets.map((a: any) => {
                      const badgeProps = getSeverityBadgeProps(a.riskLevel);
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs font-bold text-foreground">{a.asset}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.type}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground uppercase">{a.vendors?.length > 0 ? a.vendors.slice(0, 2).join(', ') : "-"}</TableCell>
                          <TableCell><Badge variant={badgeProps.variant} className={badgeProps.className}>{a.riskLevel}</Badge></TableCell>
                          <TableCell className="font-bold text-sm text-right text-destructive">{a.findings}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {(data.attackSurface.riskyAssets?.length || 0) > 0 && (
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={() => setIsAssetsModalOpen(true)} className="flex items-center gap-2 text-sm font-bold text-blue-500 hover:text-blue-600 transition-colors bg-blue-500/10 hover:bg-blue-500/20 px-5 py-2.5 rounded-lg">
                    <ExternalLink className="w-4 h-4" /> Ouvrir l'inventaire complet
                  </button>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 5. Findings & Vulnérabilités */}
        <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-3 text-base font-bold"><ShieldAlert className="w-5 h-5 text-orange-500" /> 5. Findings & Vulnérabilités</div>
              <Badge variant="secondary" className="bg-background">{data.findings.list?.length || 0} Uniques</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-6 space-y-6">
            <div className="px-4 py-3 bg-secondary/20 border border-border rounded-lg text-xs text-muted-foreground flex items-center gap-2">
              <Info className="w-4 h-4 text-orange-500 shrink-0" />
              <span><strong>Dédoublonnage intelligent :</strong> Pour un même actif et un même vecteur de risque, seul le scan le plus récent est conservé.</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 border border-border rounded-xl flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h5 className="text-xs font-bold text-muted-foreground uppercase">Répartition Sévérité</h5>
                  {filters.findingSeverityFilter !== "all" && (
                    <button type="button" className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold cursor-pointer bg-red-500/10 text-red-500 hover:bg-red-500/20 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-red-500" onClick={() => setFilters(p => ({...p, findingSeverityFilter: "all"}))}>
                      Effacer <X className="w-3 h-3 ml-1" />
                    </button>
                  )}
                </div>
                <div className="flex-1 min-h-[180px]">
                  {dynamicSeverityDistribution.some((d: any) => d.value > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBarChart data={dynamicSeverityDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1}/>
                        <XAxis dataKey="name" tick={{fontSize: 10, fill: 'currentColor'}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fontSize: 10, fill: 'currentColor'}} axisLine={false} tickLine={false} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} />
                        <Bar
                          dataKey="value"
                          radius={[4, 4, 0, 0]}
                          barSize={40}
                          style={{ cursor: 'pointer' }}
                          onClick={(chartData) => {
                            setFilters(p => ({...p, findingSeverityFilter: p.findingSeverityFilter === chartData.key ? "all" : chartData.key}));
                          }}
                        >
                          {dynamicSeverityDistribution.map((entry: any) => {
                            const isSelected = filters.findingSeverityFilter === "all" || filters.findingSeverityFilter === entry.key;
                            return <Cell key={`cell-${entry.key}`} fill={entry.color} opacity={isSelected ? 1 : 0.3} className="transition-opacity duration-300" />;
                          })}
                        </Bar>
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                </div>
              </div>

              <div className="p-4 border border-border rounded-xl md:col-span-2 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h5 className="text-xs font-bold text-muted-foreground uppercase">Top 10 Catégories (Cliquez pour filtrer)</h5>
                  {filters.findingVectorFilter !== "all" && (
                    <button type="button" className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold cursor-pointer bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500" onClick={() => setFilters(p => ({...p, findingVectorFilter: "all"}))}>
                      Effacer <X className="w-3 h-3 ml-1" />
                    </button>
                  )}
                </div>
                <div className="flex-1 min-h-[180px]">
                  {dynamicCategoryDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBarChart data={dynamicCategoryDistribution} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="category" type="category" tick={{fontSize: 10, fill: 'currentColor'}} axisLine={false} tickLine={false} width={130} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} />
                        <Bar
                          dataKey="count"
                          radius={[0, 4, 4, 0]}
                          barSize={15}
                          style={{ cursor: 'pointer' }}
                          onClick={(chartData) => {
                            setFilters(p => ({...p, findingVectorFilter: p.findingVectorFilter === chartData.vectorKey ? "all" : chartData.vectorKey}));
                          }}
                        >
                          {dynamicCategoryDistribution.map((entry: any) => {
                            const isSelected = filters.findingVectorFilter === "all" || filters.findingVectorFilter === entry.vectorKey;
                            return <Cell key={`cell-${entry.vectorKey}`} fill="#f97316" opacity={isSelected ? 1 : 0.3} className="transition-opacity duration-300" />;
                          })}
                        </Bar>
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 py-4 border-t border-b border-border bg-secondary/5 px-4 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium"><Filter className="w-4 h-4" /> Filtres Tableau :</div>
              <select value={filters.findingSeverityFilter} onChange={(e) => setFilters(p => ({...p, findingSeverityFilter: e.target.value}))} className="bg-background border border-border text-foreground text-sm rounded-md px-3 py-1.5 focus:ring-2 focus:ring-orange-500 outline-none cursor-pointer">
                <option value="all">Sévérité : Toutes</option>
                <option value="severe">Sévérité : Critique</option>
                <option value="material">Sévérité : Matériel</option>
                <option value="moderate">Sévérité : Modéré</option>
                <option value="minor">Sévérité : Mineur</option>
              </select>
              <select value={filters.findingVectorFilter} onChange={(e) => setFilters(p => ({...p, findingVectorFilter: e.target.value}))} className="bg-background border border-border text-foreground text-sm rounded-md px-3 py-1.5 focus:ring-2 focus:ring-orange-500 outline-none cursor-pointer max-w-[200px] truncate">
                <option value="all">Vecteur : Tous</option>
                {Object.entries(BITSIGHT_VECTOR_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader className="bg-secondary/5">
                  <TableRow>
                    <TableHead>Vulnérabilité (Vecteur)</TableHead>
                    <TableHead>Sévérité</TableHead>
                    <TableHead>Actif Associé (Cliquez pour cibler)</TableHead>
                    <TableHead>Dernière Découverte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayFindings.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">Aucun finding ne correspond à vos filtres.</TableCell></TableRow> : null}
                  {displayFindings.map((f: any) => {
                    const badgeProps = getSeverityBadgeProps(f.severity);
                    return (
                      <TableRow key={f.id} className="hover:bg-secondary/20">
                        <TableCell className="font-bold text-sm text-foreground">{f.finding}</TableCell>
                        <TableCell><Badge variant={badgeProps.variant} className={badgeProps.className}>{f.severity}</Badge></TableCell>
                        <TableCell>
                          <button type="button" onClick={() => setSelectedAssetForFindings(f.asset)} className="font-mono text-xs max-w-[250px] truncate block text-blue-500 hover:text-blue-600 hover:underline transition-colors text-left bg-transparent border-none p-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500" title={`Voir toutes les failles pour ${f.asset}`}>
                            {f.asset}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.discoveryDate}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {(data.findings.list?.length || 0) > 0 && (
              <div className="mt-4 flex justify-center">
                <button type="button" onClick={() => setIsFindingsModalOpen(true)} className="flex items-center gap-2 text-sm font-bold text-orange-500 hover:text-orange-600 transition-colors bg-orange-500/10 hover:bg-orange-500/20 px-5 py-2.5 rounded-lg">
                  <ExternalLink className="w-4 h-4" /> Ouvrir l'inventaire complet
                </button>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 6. Hygiène Internet */}
        <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Lock className="w-5 h-5 text-emerald-500" /> 6. Hygiène Internet</div></AccordionTrigger>
          <AccordionContent className="p-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`p-5 border rounded-xl space-y-4 ${getHygieneCardClass(data.hygiene.ssl.grade)}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-black text-base flex items-center gap-2"><Lock className="w-4 h-4"/> SSL / TLS</span>
                      <span className="text-xs font-bold text-muted-foreground mt-1 block uppercase tracking-wide">{data.hygiene.ssl.status}</span>
                    </div>
                    <Badge className={`text-lg font-black ${getHygieneBadgeClass(data.hygiene.ssl.grade)}`}>
                      {data.hygiene.ssl.grade}
                    </Badge>
                  </div>
                  <Progress value={data.hygiene.ssl.score} className="h-2" />
                  <div className="pt-2 flex items-center justify-between border-t border-border/50 text-sm">
                    <span className="text-muted-foreground">Vulnérabilités actives</span>
                    <span className="font-black text-foreground">{data.hygiene.ssl.findings}</span>
                  </div>
                </div>

                <div className={`p-5 border rounded-xl space-y-4 ${getHygieneCardClass(data.hygiene.dns.grade)}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-black text-base flex items-center gap-2"><Mail className="w-4 h-4"/> Sécurité Email (DNS)</span>
                      <span className="text-xs font-bold text-muted-foreground mt-1 block uppercase tracking-wide">{data.hygiene.dns.status}</span>
                    </div>
                    <Badge className={`text-lg font-black ${getHygieneBadgeClass(data.hygiene.dns.grade)}`}>
                      {data.hygiene.dns.grade}
                    </Badge>
                  </div>
                  <Progress value={data.hygiene.dns.score} className="h-2" />
                  <div className="pt-2 flex items-center justify-between border-t border-border/50 text-sm">
                    <span className="text-muted-foreground">Vulnérabilités actives</span>
                    <span className="font-black text-foreground">{data.hygiene.dns.findings}</span>
                  </div>
                </div>

                <div className={`p-5 border rounded-xl space-y-4 ${getHygieneCardClass(data.hygiene.ports.grade)}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-black text-base flex items-center gap-2"><Network className="w-4 h-4"/> Services & Ports</span>
                      <span className="text-xs font-bold text-muted-foreground mt-1 block uppercase tracking-wide">{data.hygiene.ports.status}</span>
                    </div>
                    <Badge className={`text-lg font-black ${getHygieneBadgeClass(data.hygiene.ports.grade)}`}>
                      {data.hygiene.ports.grade}
                    </Badge>
                  </div>
                  <Progress value={data.hygiene.ports.score} className="h-2" />
                  <div className="pt-2 flex items-center justify-between border-t border-border/50 text-sm">
                    <span className="text-muted-foreground">Vulnérabilités actives</span>
                    <span className="font-black text-foreground">{data.hygiene.ports.findings}</span>
                  </div>
                </div>
             </div>
          </AccordionContent>
        </AccordionItem>

        {/* 7. Technologies & Shadow IT */}
        <AccordionItem value="item-7" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-3 text-base font-bold"><Cpu className="w-5 h-5 text-purple-500" /> 7. Technologies & Shadow IT</div>
              <Badge variant="secondary" className="bg-background">{(data.techShadowIt.technologies?.length || 0)} Détectées</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-6 space-y-6">
             <div className="border border-border rounded-xl overflow-hidden">
               <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/5">
                      <TableHead className="pl-6">Technologie / Logiciel</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Actif Associé</TableHead>
                      <TableHead>Niveau de Risque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top10Techs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">Aucune technologie recensée</TableCell></TableRow> : null}
                    {top10Techs.map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-bold text-sm text-foreground pl-6">{t.name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{t.version}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{t.asset}</TableCell>
                        <TableCell>
                          <Badge variant={getTechRiskBadgeVariant(t.risk)}>
                            {t.risk}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
             </div>

             {(data.techShadowIt.technologies?.length || 0) > 0 && (
               <div className="mt-4 flex justify-center">
                 <button type="button" onClick={() => setIsTechModalOpen(true)} className="flex items-center gap-2 text-sm font-bold text-purple-500 hover:text-purple-600 transition-colors bg-purple-500/10 hover:bg-purple-500/20 px-5 py-2.5 rounded-lg">
                   <ExternalLink className="w-4 h-4" /> Ouvrir l'inventaire complet
                 </button>
               </div>
             )}
          </AccordionContent>
        </AccordionItem>

      </Accordion>
    </div>
  );
}