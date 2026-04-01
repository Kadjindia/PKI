import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS } from "@/types/kpi";
import KpiCard from "./KpiCard";
import KpiChartTabs from "./KpiChartTabs";
import PeriodFilterBar from "./PeriodFilterBar";
import ExecutiveSummary from "./ExecutiveSummary";
import TopAlerts from "./TopAlerts";
import { Activity, ChevronLeft, ChevronRight, Calendar, ShieldAlert, TrendingUp, Rocket, Target, ShieldCheck, Bug, FileText, AlertTriangle, UserX, Mic, Mail, Monitor, Inbox, Globe, AlertCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// Imports des requêtes Supabase de tous les modules
import { fetchProjects, fetchApplications, fetchVulnerabilities } from "@/lib/supabase-security";
import { fetchPolicies, fetchGaps } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns, fetchPhishingProfiles, fetchElearningModules } from "@/lib/supabase-awareness";

// --- COMPOSANTS UI ---
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

// On a retiré "messagerie" de la liste du bas pour ne pas faire doublon avec les belles cartes du haut
const CATEGORIES: KpiCategory[] = ["gouvernance", "sensibilisation", "risques", "continuite"];

// --- FONCTIONS UTILITAIRES ---
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const calculatePercentage = (part: number, total: number) => {
  const p = safeNum(part);
  const t = safeNum(total);
  if (t === 0) return 0;
  return Math.round((p / t) * 100);
};

const getDeadlineStatus = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "missing";
  const deadline = new Date(lastDate);
  deadline.setMonth(deadline.getMonth() + (freqMonths || 12));
  const diffDays = Math.ceil((deadline.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 90) return "warning";
  return "ok";
};

const getDynamicStatus = (lastDate: string | null, freqMonths: number, manualStatus: string) => {
  if (manualStatus === "draft") return "draft";
  if (!lastDate) return "warning";
  const nextDate = new Date(lastDate);
  nextDate.setMonth(nextDate.getMonth() + (freqMonths || 24));
  const diffDays = Math.ceil((nextDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 60) return "warning";
  return "ok";
};

const calculateDynamicCompliance = (policy: any, allGaps: any[]) => {
  const status = getDynamicStatus(policy.lastReviewDate, policy.reviewFrequencyMonths, policy.status);
  if (status === "expired") return 0;
  let score = 100;
  const openGaps = allGaps.filter(g => g.policyId === policy.id && g.status !== 'resolu');
  openGaps.forEach(gap => {
    switch(gap.severity) {
      case 'critique': score -= 20; break;
      case 'eleve': score -= 10; break;
      case 'moyen': score -= 5; break;
      case 'faible': score -= 2; break;
    }
  });
  return Math.max(0, score);
};

export default function Dashboard() {
  const { kpis, entries } = useKpi();
  const [expandedCategory, setExpandedCategory] = useState<KpiCategory | null>(null);

  // Navigations (Mois du Comité)
  const availablePeriods = useMemo(() => {
    return [...new Set(entries.map((e) => e.period))].sort();
  }, [entries]);

  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(() => availablePeriods.length - 1);
  const currentPeriod = availablePeriods[selectedPeriodIdx] || "";

  const formatPeriod = (p: string) => {
    if (!p) return "—";
    const d = new Date(p + "-01");
    return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };

  const canPrev = selectedPeriodIdx > 0;
  const canNext = selectedPeriodIdx < availablePeriods.length - 1;

  // ============================================================================
  // FETCH DE TOUTES LES DONNÉES (Console Centrale)
  // ============================================================================
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: vulns = [] } = useQuery({ queryKey: ['vulnerabilities'], queryFn: fetchVulnerabilities });

  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: gaps = [] } = useQuery({ queryKey: ['gaps'], queryFn: fetchGaps });

  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [] } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [] } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  // ============================================================================
  // CALCULS : SÉCURITÉ OPÉRATIONNELLE
  // ============================================================================
  const totalProjects = projects.length;
  const validatedPas = projects.filter(p => p.pasStatus === "validated").length;
  const pasCoverage = totalProjects > 0 ? Math.round((validatedPas / totalProjects) * 100) : 0;
  const projectsAtRisk = projects.filter(p => p.pasStatus !== "validated" && p.riskLevel === "fort").length;

  const totalApps = apps.length;
  const auditedApps = apps.filter(a => getDeadlineStatus(a.lastAuditDate, a.auditFrequencyMonths) !== "expired" && a.lastAuditDate).length;
  const auditCoverage = totalApps > 0 ? Math.round((auditedApps / totalApps) * 100) : 0;

  const appsWithRiskAnalysis = apps.filter(a => getDeadlineStatus(a.lastRiskAnalysisDate, a.riskAnalysisFrequencyMonths) !== "expired" && a.lastRiskAnalysisDate).length;
  const riskAnalysisCoverage = totalApps > 0 ? Math.round((appsWithRiskAnalysis / totalApps) * 100) : 0;

  const activeVulns = vulns.filter(v => v.status === "ouvert");
  const totalCriticalVulns = activeVulns.filter(v => v.severity === "critique").length;
  const totalHighVulns = activeVulns.filter(v => v.severity === "eleve").length;

  // ============================================================================
  // CALCULS : GOUVERNANCE
  // ============================================================================
  const totalPolicies = policies.length;
  const avgCompliance = totalPolicies > 0 ? Math.round(policies.reduce((acc, p) => acc + calculateDynamicCompliance(p, gaps), 0) / totalPolicies) : 0;
  const activeGaps = gaps.filter(g => g.status !== 'resolu');
  const openGapsCount = activeGaps.length;
  const criticalGapsCount = activeGaps.filter(g => g.severity === "critique").length;
  const okPoliciesCount = policies.filter(p => getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths, p.status) === 'ok').length;

  // ============================================================================
  // CALCULS : SENSIBILISATION & RISQUE HUMAIN
  // ============================================================================
  const highRiskProfiles = profiles.filter(p => safeNum(p.riskScore) >= 60);
  const currentYear = new Date().getFullYear();
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.sendDate).getTime() - new Date(a.sendDate).getTime());

  const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === currentYear);
  const campaignProgress = Math.min(100, Math.round((campaignsThisYear.length / 4) * 100));

  const latestCampaign = sortedCampaigns.length > 0 ? sortedCampaigns[0] : null;
  const compromiseRate = latestCampaign ? calculatePercentage(latestCampaign.compromisedCount, latestCampaign.targetCount) : 0;
  const reportRate = latestCampaign ? calculatePercentage(latestCampaign.reportedCount, latestCampaign.targetCount) : 0;

  const elearningModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") === "E-Learning");
  const sessionModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning");

  const totalElearningAssigned = elearningModules.reduce((acc, m) => acc + (safeNum(m.totalAssigned) || safeNum((m as any).total_assigned)), 0);
  const totalElearningCompleted = elearningModules.reduce((acc, m) => acc + (safeNum(m.completedCount) || safeNum((m as any).completed_count)), 0);
  const elearningRate = totalElearningAssigned > 0 ? calculatePercentage(totalElearningCompleted, totalElearningAssigned) : 0;
  const elearningProgress = Math.min(100, Math.round((elearningRate / 95) * 100));

  const sessionsThisYear = sessionModules.filter(m => new Date(m.startDate || m.createdAt || "").getFullYear() === currentYear);
  const sessionProgress = Math.min(100, Math.round((sessionsThisYear.length / 4) * 100));

  // ============================================================================
  // CALCULS : MESSAGERIE SSI
  // ============================================================================
  const msgEntries = entries.filter(e => e.kpiId.startsWith('msg-'));
  const msgAvailablePeriods = useMemo(() => {
    return [...new Set(msgEntries.map((e) => e.period))].sort();
  }, [msgEntries]);

  const msgCurrentData = useMemo(() => {
    if (msgAvailablePeriods.length === 0) return null;
    const lastPeriod = msgAvailablePeriods[msgAvailablePeriods.length - 1];
    const getVal = (id: string) => safeNum(msgEntries.find(e => e.kpiId === id && e.period === lastPeriod)?.value);

    const total = getVal('msg-total');
    const fraude = getVal('msg-fraude');
    const interne = getVal('msg-1212');
    const externe = getVal('msg-externe');
    const erreur = getVal('msg-erreur');

    return {
      total, fraude, interne, externe, erreur,
      tauxFraude: calculatePercentage(fraude, total),
      tauxInterne: calculatePercentage(interne, total)
    };
  }, [msgAvailablePeriods, msgEntries]);


  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Console Centrale de Supervision
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vision 360° de la posture de cybersécurité en temps réel
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 glass-panel px-2 py-1 hidden lg:flex">
            <button onClick={() => canPrev && setSelectedPeriodIdx((i) => i - 1)} disabled={!canPrev} className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-1.5 px-2 min-w-[160px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium text-foreground capitalize">{formatPeriod(currentPeriod)}</span>
            </div>
            <button onClick={() => canNext && setSelectedPeriodIdx((i) => i + 1)} disabled={!canNext} className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <PeriodFilterBar />
        </div>
      </div>

      {/* ========================================================= */}
      {/* SECTION 1 : INDICATEURS DE MAÎTRISE DES RISQUES (KRI)     */}
      {/* ========================================================= */}
      <section>
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4 border-b pb-2">
          <ShieldAlert className="w-5 h-5 text-rose-500" /> Indicateurs de Maîtrise des Risques (KRI)
        </h2>
        {/* On passe sur xl:grid-cols-5 pour avoir 2 belles lignes de 5 cartes équilibrées (10 cartes total) */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">

          <Card className={`border-l-4 shadow-sm ${projectsAtRisk > 0 ? 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-emerald-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Rocket className="w-3 h-3" /> Alerte Go-Live
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`text-2xl font-bold ${projectsAtRisk > 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{projectsAtRisk}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Projets risqués sans PAS</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${(totalCriticalVulns + totalHighVulns) > 0 ? 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-emerald-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Bug className="w-3 h-3" /> Dette Majeure
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`text-2xl font-bold ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600'}`}>{totalCriticalVulns + totalHighVulns}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Vuln. Critiques/Élevées (pentest)</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${avgCompliance >= 80 ? 'border-l-emerald-500' : avgCompliance >= 50 ? 'border-l-amber-500' : 'border-l-rose-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Conformité Gov. (politiques)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{avgCompliance}%</div>
              <Progress value={avgCompliance} className="h-1 mt-2" />
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Activity className="w-3 h-3" /> Plan d'Action Gov.
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{openGapsCount}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Écarts ouverts</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${criticalGapsCount > 0 ? 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-slate-200'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> Urgences Gov.
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`text-2xl font-bold ${criticalGapsCount > 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{criticalGapsCount}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Écarts critiques actifs</p>
            </CardContent>
          </Card>

          {/* --- NOUVELLE CARTE MESSAGERIE (KRI) --- */}
          <Card className={`border-l-4 shadow-sm ${msgCurrentData && msgCurrentData.tauxFraude > 20 ? 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-amber-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> Fraudes (Msg)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`text-2xl font-bold ${msgCurrentData && msgCurrentData.tauxFraude > 20 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-500'}`}>
                {msgCurrentData?.fraude || 0} <span className="text-sm font-normal opacity-70">({msgCurrentData?.tauxFraude || 0}%)</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails provenant de BP Fraude</p>
            </CardContent>
          </Card>

          {/* --- NOUVELLE CARTE MESSAGERIE (KRI) --- */}
          <Card className={`border-l-4 shadow-sm ${msgCurrentData && msgCurrentData.erreur > 25 ? 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10' : msgCurrentData && msgCurrentData.erreur > 10 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <AlertCircle className="w-3 h-3" /> Erreurs d'adressage (Msg)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`text-2xl font-bold ${msgCurrentData && msgCurrentData.erreur > 25 ? 'text-rose-600 dark:text-rose-400' : msgCurrentData && msgCurrentData.erreur > 10 ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {msgCurrentData?.erreur || 0}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails non justifiés (Bruit)</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${compromiseRate > 5 ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> Compromission (Phishing)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{compromiseRate}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Dernière campagne</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Signalements (Phishing)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{reportRate}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Dernière campagne</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${highRiskProfiles.length > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <UserX className="w-3 h-3" /> Risque &gt; 60
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{highRiskProfiles.length}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Collaborateur(s) à suivre</p>
            </CardContent>
          </Card>

        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION 2 : INDICATEURS DE PERFORMANCE (KPI)              */}
      {/* ========================================================= */}
      <section>
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4 border-b pb-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Indicateurs de Performance (KPI)
        </h2>
        {/* On passe sur xl:grid-cols-5 pour avoir 2 belles lignes de 5 cartes équilibrées (10 cartes total) */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">

          <Card className={`border-l-4 shadow-sm ${pasCoverage >= 80 ? 'border-l-emerald-500' : pasCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Couverture PAS
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{pasCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{validatedPas} validés / {totalProjects}</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${riskAnalysisCoverage >= 80 ? 'border-l-primary' : riskAnalysisCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Target className="w-3 h-3" /> Analyses Risques
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{riskAnalysisCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{appsWithRiskAnalysis} à jour / {totalApps}</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${auditCoverage >= 80 ? 'border-l-blue-500' : auditCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <ShieldAlert className="w-3 h-3" /> Couverture Audit (Pentests)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{auditCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{auditedApps} à jour / {totalApps}</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-primary shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <FileText className="w-3 h-3" /> Santé Référentiel
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{okPoliciesCount} <span className="text-sm font-normal text-muted-foreground">/ {totalPolicies}</span></div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Politiques à jour</p>
            </CardContent>
          </Card>

          {/* --- NOUVELLE CARTE MESSAGERIE (KPI) --- */}
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Inbox className="w-3 h-3" /> Volume Msg
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold text-foreground">{msgCurrentData?.total || 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails reçus ce mois</p>
            </CardContent>
          </Card>

          {/* --- NOUVELLE CARTE MESSAGERIE (KPI) --- */}
          <Card className="border-l-4 border-l-emerald-500 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Sig. 1212 (Msg)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {msgCurrentData?.interne || 0} <span className="text-sm font-normal opacity-70">({msgCurrentData?.tauxInterne || 0}%)</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Remontées 1212</p>
            </CardContent>
          </Card>

          {/* --- NOUVELLE CARTE MESSAGERIE (KPI) --- */}
          <Card className="border-l-4 border-l-slate-400 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Globe className="w-3 h-3" /> Ext. (Msg)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{msgCurrentData?.externe || 0}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Provenant de l'extérieur</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${campaignsThisYear.length >= 4 ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Mail className="w-3 h-3" /> Phishing (An)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{campaignsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ 4</span></div>
              <Progress value={campaignProgress} className="h-1 mt-2" />
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${sessionsThisYear.length >= 4 ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Mic className="w-3 h-3" /> Sessions Animées (an)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{sessionsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ 4</span></div>
              <Progress value={sessionProgress} className={`h-1 mt-2 [&>div]:bg-amber-500`} />
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${elearningRate >= 95 ? 'border-l-emerald-500' : 'border-l-primary'}`}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-2">
                <Monitor className="w-3 h-3" /> E-Learning (an)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{elearningRate}% <span className="text-sm font-normal text-muted-foreground">/ 95%</span></div>
              <Progress value={elearningProgress} className={`h-1 mt-2 ${elearningRate >= 95 ? '[&>div]:bg-emerald-500' : '[&>div]:bg-primary'}`} />
            </CardContent>
          </Card>

        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION 3 : VUES DÉTAILLÉES (Graphiques & Alertes)        */}
      {/* ========================================================= */}

      <ExecutiveSummary />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-4 border-t">
        <div className="xl:col-span-2">
          <KpiChartTabs />
        </div>
        <div>
          <TopAlerts />
        </div>
      </div>

    </div>
  );
}