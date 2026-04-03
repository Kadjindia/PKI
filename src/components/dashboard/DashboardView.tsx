import { useKpi } from "@/context/KpiContext";
import { KpiCategory, CATEGORY_LABELS } from "@/types/kpi";
import KpiCard from "./KpiCard";
import KpiChartTabs from "./KpiChartTabs";
import PeriodFilterBar from "./PeriodFilterBar";
import ExecutiveSummary from "./ExecutiveSummary";
import TopAlerts from "./TopAlerts";
import { Activity, ChevronLeft, ChevronRight, Calendar, ShieldAlert, TrendingUp, TrendingDown, Minus, Rocket, Target, ShieldCheck, Bug, FileText, AlertTriangle, UserX, Mic, Monitor, Inbox, Globe, AlertCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchProjects, fetchApplications, fetchVulnerabilities } from "@/lib/supabase-security";
import { fetchPolicies, fetchGaps } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns, fetchPhishingProfiles, fetchElearningModules } from "@/lib/supabase-awareness";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const CATEGORIES: KpiCategory[] = ["gouvernance", "sensibilisation", "risques", "continuite"];

// --- FONCTIONS UTILITAIRES COMMUNES ---
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

// --- COMPOSANT DE TENDANCE ---
const TrendIndicator = ({ current, previous, inverseColors = false }: { current?: number | null, previous?: number | null, inverseColors?: boolean }) => {
  if (previous === undefined || previous === null || current === undefined || current === null) return null;
  const diff = current - previous;

  if (diff === 0) return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1 font-medium">
      <Minus className="w-3 h-3" /> Stable
    </div>
  );

  const percent = previous !== 0 ? Math.round((Math.abs(diff) / previous) * 100) : 100;
  const isGood = inverseColors ? diff < 0 : diff > 0;
  const textColor = isGood ? 'text-emerald-500' : 'text-rose-500';

  return (
    <div className={`flex items-center gap-1 text-[10px] mt-1 font-bold ${textColor}`}>
      {diff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      <span>{diff > 0 ? '+' : '-'}{percent}%</span>
    </div>
  );
};

export default function Dashboard() {
  const { kpis, entries, getPreviousValue, getLatestValue } = useKpi();
  const [expandedCategory, setExpandedCategory] = useState<KpiCategory | null>(null);

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
  // FETCH DES DONNÉES EXACTES
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
  // CALCULS : PAS & AUDITS (Sécurité)
  // ============================================================================
  const totalProjects = projects.length;
  const validatedPas = projects.filter(p => p.pasStatus === "validated").length;
  const pasCoverage = totalProjects > 0 ? Math.round((validatedPas / totalProjects) * 100) : 0;
  const projectsAtRisk = projects.filter(p => p.pasStatus !== "validated" && p.riskLevel === "fort").length;

  const totalApps = apps.length;
  const auditedApps = apps.filter(a => a.lastAuditDate && getDynamicStatus(a.lastAuditDate, a.auditFrequencyMonths || 12, "active") !== "expired").length;
  const auditCoverage = totalApps > 0 ? Math.round((auditedApps / totalApps) * 100) : 0;

  const appsWithRiskAnalysis = apps.filter(a => a.lastRiskAnalysisDate && getDynamicStatus(a.lastRiskAnalysisDate, a.riskAnalysisFrequencyMonths || 36, "active") !== "expired").length;
  const riskAnalysisCoverage = totalApps > 0 ? Math.round((appsWithRiskAnalysis / totalApps) * 100) : 0;

  const activeVulns = vulns.filter(v => v.status === "ouvert");
  const totalCriticalVulns = activeVulns.filter(v => v.severity === "critique").length;
  const totalHighVulns = activeVulns.filter(v => v.severity === "eleve").length;

  // ============================================================================
  // CALCULS : REVUE DES POLITIQUES (Gouvernance)
  // ============================================================================
  const totalPolicies = policies.length;
  const activeGaps = gaps.filter(g => g.status !== 'resolu');
  const openGapsCount = activeGaps.length;
  const criticalGapsCount = activeGaps.filter(g => g.severity === "critique").length;
  const okPoliciesCount = policies.filter(p => getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths, p.status) === 'ok').length;

  const avgCompliance = totalPolicies > 0 ? Math.round(policies.reduce((acc, p) => {
    const status = getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths, p.status);
    if (status === "expired") return acc;
    let score = 100;
    activeGaps.filter(g => g.policyId === p.id).forEach(gap => {
      score -= gap.severity === 'critique' ? 20 : gap.severity === 'eleve' ? 10 : gap.severity === 'moyen' ? 5 : 2;
    });
    return acc + Math.max(0, score);
  }, 0) / totalPolicies) : 0;

  // ============================================================================
  // CALCULS : SENSIBILISATION
  // ============================================================================
  const highRiskProfiles = profiles.filter(p => safeNum(p.riskScore) >= 60);
  const currentYear = new Date().getFullYear();

  const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === currentYear);
  const targetCampaignsPerYear = 4;
  const campaignProgress = Math.min(100, Math.round((campaignsThisYear.length / targetCampaignsPerYear) * 100));
  const isGoalReached = campaignsThisYear.length >= targetCampaignsPerYear;

  const elearningModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") === "E-Learning");
  const sessionModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning");

  const totalElearningAssigned = elearningModules.reduce((acc, m) => acc + (safeNum(m.totalAssigned) || safeNum((m as any).total_assigned)), 0);
  const totalElearningCompleted = elearningModules.reduce((acc, m) => acc + (safeNum(m.completedCount) || safeNum((m as any).completed_count)), 0);
  const elearningRate = totalElearningAssigned > 0 ? calculatePercentage(totalElearningCompleted, totalElearningAssigned) : 0;
  const elearningGoalReached = elearningRate >= 95;
  const elearningProgress = Math.min(100, Math.round((elearningRate / 95) * 100));

  const sessionsThisYear = sessionModules.filter(m => {
    const dStr = m.startDate || m.createdAt || "";
    if (!dStr) return false;
    return new Date(dStr).getFullYear() === currentYear;
  });
  const targetSessionsPerYear = 4;
  const sessionProgress = Math.min(100, Math.round((sessionsThisYear.length / targetSessionsPerYear) * 100));
  const isSessionGoalReached = sessionsThisYear.length >= targetSessionsPerYear;

  // ============================================================================
  // CALCULS : MESSAGERIE SSI
  // ============================================================================
  const msgEntries = entries.filter(e => e.kpiId.startsWith('msg-'));
  const msgAvailablePeriods = useMemo(() => {
    return [...new Set(msgEntries.map((e) => e.period))].sort();
  }, [msgEntries]);

  const monthlyData = useMemo(() => {
    return msgAvailablePeriods.map(period => {
      const getVal = (id: string) => safeNum(msgEntries.find(e => e.kpiId === id && e.period === period)?.value);
      const total = getVal('msg-total');
      const fraude = getVal('msg-fraude');
      const interne = getVal('msg-1212');
      const externe = getVal('msg-externe');
      const erreur = getVal('msg-erreur');
      return {
        period,
        total, fraude, interne, externe, erreur,
        tauxFraude: calculatePercentage(fraude, total),
        tauxInterne: calculatePercentage(interne, total)
      };
    });
  }, [msgAvailablePeriods, msgEntries]);

  const msgCurrentData = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;
  const msgPreviousData = monthlyData.length > 1 ? monthlyData[monthlyData.length - 2] : null;

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
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">

          <Card className={`border-l-4 shadow-sm ${projectsAtRisk > 0 ? 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-slate-200'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className={`text-xs font-medium ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'} uppercase`}>Alerte Go-Live</CardTitle>
              <Rocket className={`w-4 h-4 ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${projectsAtRisk > 0 ? 'text-rose-600' : ''}`}>{projectsAtRisk}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Projets risqués sans PAS</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${(totalCriticalVulns + totalHighVulns) > 0 ? 'border-l-rose-600' : 'border-l-emerald-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Dette Majeure</CardTitle>
              <Bug className={`w-4 h-4 ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-500'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalCriticalVulns + totalHighVulns}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Vulnérabilités Crit/Élev (pentest)</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${criticalGapsCount > 0 ? 'border-l-rose-600 bg-rose-50/50' : 'border-l-slate-200'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className={`text-xs font-medium ${criticalGapsCount > 0 ? 'text-rose-600' : 'text-muted-foreground'} uppercase`}>Urgences</CardTitle>
              <AlertTriangle className={`w-4 h-4 ${criticalGapsCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${criticalGapsCount > 0 ? 'text-rose-600' : ''}`}>{criticalGapsCount}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Écarts critiques actifs (politiques)</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${campaigns.length > 0 && calculatePercentage(campaigns[0].compromisedCount, campaigns[0].targetCount) > 5 ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Compromission</CardTitle>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].compromisedCount, campaigns[0].targetCount) : 0}%</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Dernière campagne</p>
                <TrendIndicator current={campaigns.length > 0 ? calculatePercentage(campaigns[0].compromisedCount, campaigns[0].targetCount) : null} previous={campaigns.length > 1 ? calculatePercentage(campaigns[1].compromisedCount, campaigns[1].targetCount) : null} inverseColors />
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${highRiskProfiles.length > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Risque &gt; 60</CardTitle>
              <UserX className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{highRiskProfiles.length}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Collaborateurs à suivre</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${msgCurrentData && msgCurrentData.tauxFraude > 20 ? 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-amber-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Fraude</CardTitle>
              <AlertTriangle className={`w-4 h-4 ${msgCurrentData && msgCurrentData.tauxFraude > 20 ? 'text-rose-500' : 'text-amber-500'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${msgCurrentData && msgCurrentData.tauxFraude > 20 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-500'}`}>
                {msgCurrentData?.fraude || 0} <span className="text-sm font-normal opacity-70">({msgCurrentData?.tauxFraude || 0}%)</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Mails provenants de la BP Fraude</p>
                <TrendIndicator current={msgCurrentData?.fraude} previous={msgPreviousData?.fraude} inverseColors />
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${msgCurrentData && msgCurrentData.erreur > 25 ? 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10' : msgCurrentData && msgCurrentData.erreur > 10 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Erreurs Adressage</CardTitle>
              <AlertCircle className={`w-4 h-4 ${msgCurrentData && msgCurrentData.erreur > 10 ? 'text-rose-500' : 'text-emerald-500'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${msgCurrentData && msgCurrentData.erreur > 25 ? 'text-rose-600 dark:text-rose-400' : msgCurrentData && msgCurrentData.erreur > 10 ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {msgCurrentData?.erreur || 0}
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Mails non justifiés</p>
                <TrendIndicator current={msgCurrentData?.erreur} previous={msgPreviousData?.erreur} inverseColors />
              </div>
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
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">

          <Card className={`border-l-4 shadow-sm ${pasCoverage >= 80 ? 'border-l-emerald-500' : pasCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Couverture PAS</CardTitle>
              <ShieldCheck className={`w-4 h-4 ${pasCoverage >= 80 ? 'text-emerald-500' : pasCoverage > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pasCoverage}%</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">{validatedPas} projets sur {totalProjects}</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${riskAnalysisCoverage >= 80 ? 'border-l-primary' : riskAnalysisCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Analyses Risques</CardTitle>
              <Target className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{riskAnalysisCoverage}%</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">{appsWithRiskAnalysis} périmètres sur {totalApps}</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${auditCoverage >= 80 ? 'border-l-blue-500' : auditCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Couverture Audit (pentest)</CardTitle>
              <ShieldAlert className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{auditCoverage}%</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">{auditedApps} périmètres sur {totalApps}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-primary shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Santé du Référentiel</CardTitle>
              <FileText className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{okPoliciesCount} / {totalPolicies}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Politiques à jour</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${avgCompliance >= 80 ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Score Conformité (politiques)</CardTitle>
              <ShieldCheck className={`w-4 h-4 ${avgCompliance >= 80 ? 'text-emerald-500' : 'text-amber-500'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgCompliance}%</div>
              <div className="flex items-center justify-between mt-1">
                <Progress value={avgCompliance} className="h-1 w-2/3" />
                <TrendIndicator current={getLatestValue('gov-conformite')} previous={getPreviousValue('gov-conformite')} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Plan d'Action</CardTitle>
              <Activity className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{openGapsCount}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Écarts ouverts (politiques)</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${isGoalReached ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Phishing</CardTitle>
              <Target className={`w-4 h-4 ${isGoalReached ? 'text-emerald-500' : 'text-blue-500'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-baseline gap-1">
                {campaignsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ {targetCampaignsPerYear}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <Progress value={campaignProgress} className={`h-1 w-2/3 ${isGoalReached ? '[&>div]:bg-emerald-500' : ''}`} />
                <TrendIndicator current={campaignsThisYear.length} previous={campaigns.filter(c => new Date(c.sendDate).getFullYear() === currentYear - 1).length} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-tight">Campagnes annuelles</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Signalements</CardTitle>
              <ShieldCheck className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].reportedCount, campaigns[0].targetCount) : 0}%</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Dernière campagne</p>
                <TrendIndicator current={campaigns.length > 0 ? calculatePercentage(campaigns[0].reportedCount, campaigns[0].targetCount) : null} previous={campaigns.length > 1 ? calculatePercentage(campaigns[1].reportedCount, campaigns[1].targetCount) : null} />
              </div>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${isSessionGoalReached ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Sessions Animées</CardTitle>
              <Mic className={`w-4 h-4 ${isSessionGoalReached ? 'text-emerald-500' : 'text-amber-500'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-baseline gap-1">
                {sessionsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ {targetSessionsPerYear}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <Progress value={sessionProgress} className={`h-1 w-2/3 ${isSessionGoalReached ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'}`} />
                <TrendIndicator current={sessionsThisYear.length} previous={modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning" && new Date(m.startDate || m.createdAt || "").getFullYear() === currentYear - 1).length} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-tight">Webinaires / Présentiel</p>
            </CardContent>
          </Card>

          <Card className={`border-l-4 shadow-sm ${elearningGoalReached ? 'border-l-emerald-500' : 'border-l-primary'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Couverture E-Learning</CardTitle>
              <Target className={`w-4 h-4 ${elearningGoalReached ? 'text-emerald-500' : 'text-primary'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-baseline gap-1">
                {elearningRate}% <span className="text-sm font-normal text-muted-foreground">/ 95%</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <Progress value={elearningProgress} className={`h-1 w-2/3 ${elearningGoalReached ? '[&>div]:bg-emerald-500' : '[&>div]:bg-primary'}`} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-tight">Objectif de réalisation</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Volume Total (SSI)</CardTitle>
              <Inbox className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{msgCurrentData?.total || 0}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Mails traités ce mois</p>
                <TrendIndicator current={msgCurrentData?.total} previous={msgPreviousData?.total} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Remontées 1212</CardTitle>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {msgCurrentData?.interne || 0} <span className="text-sm font-normal opacity-70">({msgCurrentData?.tauxInterne || 0}%)</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Mails provenant du 1212</p>
                <TrendIndicator current={msgCurrentData?.interne} previous={msgPreviousData?.interne} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-slate-400 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Externes</CardTitle>
              <Globe className="w-4 h-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{msgCurrentData?.externe || 0}</div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">Provenant de l'extérieur</p>
                <TrendIndicator current={msgCurrentData?.externe} previous={msgPreviousData?.externe} />
              </div>
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