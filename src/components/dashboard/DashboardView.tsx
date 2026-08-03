import { useKpi } from "@/context/KpiContext";
import KpiChartTabs from "./KpiChartTabs";
import PeriodFilterBar from "./PeriodFilterBar";
import ExecutiveSummary from "./ExecutiveSummary";
import TopAlerts from "./TopAlerts";
import { Activity, ChevronLeft, ChevronRight, Calendar, ShieldAlert, TrendingUp, TrendingDown, Minus, Rocket, Target, ShieldCheck, Bug, FileText, AlertTriangle, UserX, Mic, Monitor, Inbox, Globe, AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { fetchProjects, fetchApplications, fetchVulnerabilities } from "@/lib/supabase-security";
import { fetchPolicies, fetchGaps } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns, fetchPhishingProfiles, fetchElearningModules } from "@/lib/supabase-awareness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// --- FONCTIONS UTILITAIRES ---
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
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
  const diffDays = Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 60) return "warning";
  return "ok";
};
const formatPeriod = (p: string) => {
  if (!p) return "—";
  const d = new Date(p + "-01");
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};

const GAP_SEVERITY_PENALTY: Record<string, number> = { critique: 20, eleve: 10, moyen: 5 };
function getGapPenalty(severity: string): number {
  return GAP_SEVERITY_PENALTY[severity] ?? 2;
}

function binaryClass(condition: boolean, trueClass: string, falseClass: string): string {
  return condition ? trueClass : falseClass;
}

// Valeur haute = mauvais signe (ex: nombre d'erreurs, taux de fraude)
function thresholdClassDesc(value: number, dangerMin: number, warnMin: number, dangerClass: string, warnClass: string, okClass: string): string {
  if (value > dangerMin) return dangerClass;
  if (value > warnMin) return warnClass;
  return okClass;
}

// Valeur haute = bon signe (ex: taux de couverture)
function thresholdClassAsc(value: number, goodMin: number, warnMin: number, goodClass: string, warnClass: string, noneClass: string): string {
  if (value >= goodMin) return goodClass;
  if (value > warnMin) return warnClass;
  return noneClass;
}

// --- HOOKS DE CALCUL ---

function useSecurityIndicators(projects: any[], apps: any[], vulns: any[]) {
  return useMemo(() => {
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

    return {
      totalProjects, validatedPas, pasCoverage, projectsAtRisk,
      totalApps, auditedApps, auditCoverage, appsWithRiskAnalysis, riskAnalysisCoverage,
      totalCriticalVulns, totalHighVulns,
    };
  }, [projects, apps, vulns]);
}

function useGovernanceIndicators(policies: any[], gaps: any[]) {
  return useMemo(() => {
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
        score -= getGapPenalty(gap.severity);
      });
      return acc + Math.max(0, score);
    }, 0) / totalPolicies) : 0;

    return { totalPolicies, openGapsCount, criticalGapsCount, okPoliciesCount, avgCompliance };
  }, [policies, gaps]);
}

function useAwarenessIndicators(campaigns: any[], profiles: any[], modules: any[], selectedYear: number) {
  return useMemo(() => {
    const highRiskProfiles = profiles.filter(p => safeNum(p.riskScore) >= 60);

    const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.sendDate).getTime() - new Date(a.sendDate).getTime());
    const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === selectedYear);
    const targetCampaignsPerYear = 4;
    const isGoalReached = campaignsThisYear.length >= targetCampaignsPerYear;
    const latestCampaign = sortedCampaigns.length > 0 ? sortedCampaigns[0] : null;
    const prevCampaign = sortedCampaigns.length > 1 ? sortedCampaigns[1] : null;
    const compromiseRate = latestCampaign ? calculatePercentage(latestCampaign.compromisedCount, latestCampaign.targetCount) : 0;
    const prevCompromiseRate = prevCampaign ? calculatePercentage(prevCampaign.compromisedCount, prevCampaign.targetCount) : null;
    const reportRate = latestCampaign ? calculatePercentage(latestCampaign.reportedCount, latestCampaign.targetCount) : 0;
    const prevReportRate = prevCampaign ? calculatePercentage(prevCampaign.reportedCount, prevCampaign.targetCount) : null;
    const phishingChartData = sortedCampaigns.slice(0, 6).reverse().map(c => ({
      name: new Date(c.sendDate).toLocaleDateString('fr-FR', { month: 'short' }),
      clics: calculatePercentage(c.clickedCount, c.targetCount),
      saisies: calculatePercentage(c.compromisedCount, c.targetCount),
      signalements: calculatePercentage(c.reportedCount, c.targetCount)
    }));

    const elearningModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") === "E-Learning");
    const sessionModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning");
    const totalElearningAssigned = elearningModules.reduce((acc, m) => acc + (safeNum(m.totalAssigned) || safeNum((m as any).total_assigned)), 0);
    const totalElearningCompleted = elearningModules.reduce((acc, m) => acc + (safeNum(m.completedCount) || safeNum((m as any).completed_count)), 0);
    const elearningRate = totalElearningAssigned > 0 ? calculatePercentage(totalElearningCompleted, totalElearningAssigned) : 0;
    const elearningGoalReached = elearningRate >= 95;
    const sessionsThisYear = sessionModules.filter(m => new Date(m.startDate || m.createdAt || "").getFullYear() === selectedYear);
    const targetSessionsPerYear = 4;
    const isSessionGoalReached = sessionsThisYear.length >= targetSessionsPerYear;

    return {
      highRiskProfiles, campaignsThisYear, targetCampaignsPerYear, isGoalReached,
      compromiseRate, prevCompromiseRate, reportRate, prevReportRate, phishingChartData,
      elearningRate, elearningGoalReached, sessionsThisYear, targetSessionsPerYear, isSessionGoalReached,
    };
  }, [campaigns, profiles, modules, selectedYear]);
}

function useMessagingIndicators(entries: any[], getFilteredValue: (id: string) => number | undefined) {
  const msgTotal = getFilteredValue('msg-total') || 0;
  const msgFraude = getFilteredValue('msg-fraude') || 0;
  const msgErreur = getFilteredValue('msg-erreur') || 0;
  const msg1212 = getFilteredValue('msg-1212') || 0;
  const msgExterne = getFilteredValue('msg-externe') || 0;
  const tauxFraude = msgTotal > 0 ? Math.round((msgFraude / msgTotal) * 100) : 0;
  const tauxInterne = msgTotal > 0 ? Math.round((msg1212 / msgTotal) * 100) : 0;

  const msgEntries = useMemo(() => entries.filter(e => e.kpiId.startsWith('msg-')), [entries]);
  const msgAvailablePeriods = useMemo(
    () => [...new Set(msgEntries.map((e) => e.period))].sort((a, b) => a.localeCompare(b)),
    [msgEntries]
  );
  const monthlyMsgData = useMemo(() => {
    return msgAvailablePeriods.map(period => {
      const getVal = (id: string) => safeNum(msgEntries.find(e => e.kpiId === id && e.period === period)?.value);
      return {
        period: new Date(period + "-01").toLocaleDateString('fr-FR', { month: 'short' }),
        total: getVal('msg-total'),
        fraude: getVal('msg-fraude'),
        erreur: getVal('msg-erreur'),
      };
    });
  }, [msgAvailablePeriods, msgEntries]);

  return { msgTotal, msgFraude, msgErreur, msg1212, msgExterne, tauxFraude, tauxInterne, monthlyMsgData };
}

// --- SOUS-COMPOSANTS ---

const TrendIndicator = ({ current, previous, inverseColors = false }: Readonly<{ current?: number | null, previous?: number | null, inverseColors?: boolean }>) => {
  if (previous === undefined || previous === null || current === undefined || current === null) return null;
  const diff = current - previous;
  if (diff === 0) return <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium"><Minus className="w-3 h-3" /> Stable</div>;
  const percent = previous !== 0 ? Math.round((Math.abs(diff) / previous) * 100) : 100;
  const isGood = inverseColors ? diff < 0 : diff > 0;
  return (
    <div className={`flex items-center gap-1 text-[10px] font-bold ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
      {diff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      <span>{diff > 0 ? '+' : '-'}{percent}%</span>
    </div>
  );
};

const CustomProgress = ({ value, max = 100, label, colorClass = "bg-primary" }: Readonly<{ value: number, max?: number, label: string, colorClass?: string }>) => {
  const percentage = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mt-3">
      <div className="w-full bg-slate-200/80 dark:bg-slate-800/80 rounded-full h-2.5 overflow-hidden flex shadow-inner">
        <div className={`h-full ${colorClass} transition-all duration-1000 ease-out`} style={{ width: `${percentage}%` }}></div>
      </div>
      <div className="flex justify-between items-center text-[10px] font-medium text-muted-foreground mt-1.5">
        <span>{label}</span>
        <span className={`font-bold text-[11px] ${colorClass.replace('bg-', 'text-')}`}>{percentage}% complété</span>
      </div>
    </div>
  );
};

interface KriGridProps {
  projectsAtRisk: number;
  totalCriticalVulns: number;
  totalHighVulns: number;
  criticalGapsCount: number;
  highRiskProfilesCount: number;
  compromiseRate: number;
  prevCompromiseRate: number | null;
  reportRate: number;
  prevReportRate: number | null;
  tauxFraude: number;
  msgFraude: number;
  msgErreur: number;
}

    // Section KRI extraite : sort tous ses ternaires de className de la fonction Dashboard
    function KriGrid({
      projectsAtRisk, totalCriticalVulns, totalHighVulns, criticalGapsCount, highRiskProfilesCount,
      compromiseRate, prevCompromiseRate, reportRate, prevReportRate, tauxFraude, msgFraude, msgErreur,
    }: Readonly<KriGridProps>) {
      const totalDebtVulns = totalCriticalVulns + totalHighVulns;

      const goLiveBorder = binaryClass(projectsAtRisk > 0, 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10', 'border-l-slate-200');
      const goLiveValue = binaryClass(projectsAtRisk > 0, 'text-rose-600 dark:text-rose-400', '');

      const debtBorder = binaryClass(totalDebtVulns > 0, 'border-l-rose-600 dark:bg-rose-900/10', 'border-l-emerald-500');
      const debtIcon = binaryClass(totalDebtVulns > 0, 'text-rose-600', 'text-emerald-500');
      const debtValue = binaryClass(totalDebtVulns > 0, 'text-rose-600 dark:text-rose-400', 'text-emerald-600');

      const criticalGapsBorder = binaryClass(criticalGapsCount > 0, 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10', 'border-l-slate-200');
      const criticalGapsValue = binaryClass(criticalGapsCount > 0, 'text-rose-600 dark:text-rose-400', '');

      const highRiskBorder = binaryClass(highRiskProfilesCount > 0, 'border-l-amber-500', 'border-l-emerald-500');
      const compromiseBorder = binaryClass(compromiseRate > 5, 'border-l-rose-500', 'border-l-emerald-500');

      const fraudeBorder = binaryClass(tauxFraude > 20, 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10', 'border-l-amber-500');
      const fraudeIcon = binaryClass(tauxFraude > 20, 'text-rose-500', 'text-amber-500');
      const fraudeValue = binaryClass(tauxFraude > 20, 'text-rose-600 dark:text-rose-400', 'text-amber-600 dark:text-amber-500');

      const erreurBorder = thresholdClassDesc(msgErreur, 25, 10, 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10', 'border-l-amber-500', 'border-l-emerald-500');
      const erreurIcon = binaryClass(msgErreur > 10, 'text-rose-500', 'text-emerald-500');
      const erreurValue = thresholdClassDesc(msgErreur, 25, 10, 'text-rose-600 dark:text-rose-400', 'text-amber-600 dark:text-amber-500', 'text-emerald-600 dark:text-emerald-400');

      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className={`border-l-4 shadow-sm ${goLiveBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Alerte Go-Live</CardTitle>
              <Rocket className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${goLiveValue}`}>{projectsAtRisk}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Projets risqués sans PAS</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${debtBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Dette Majeure</CardTitle>
              <Bug className={`w-4 h-4 ${debtIcon}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${debtValue}`}>{totalDebtVulns}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Vulnérabilités Crit/Élev (Audits)</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${criticalGapsBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Urgences (Gov)</CardTitle>
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${criticalGapsValue}`}>{criticalGapsCount}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Écarts critiques actifs (Politiques)</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${highRiskBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Risque &gt; 60</CardTitle>
              <UserX className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{highRiskProfilesCount}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Collaborateurs à suivre</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${compromiseBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Compromission</CardTitle>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{compromiseRate}%</div>
                <TrendIndicator current={compromiseRate} previous={prevCompromiseRate} inverseColors />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Dernière campagne</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Signalements</CardTitle>
              <ShieldCheck className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{reportRate}%</div>
                <TrendIndicator current={reportRate} previous={prevReportRate} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Dernière campagne</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${fraudeBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Fraude Entrante</CardTitle>
              <AlertTriangle className={`w-4 h-4 ${fraudeIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className={`text-2xl font-bold ${fraudeValue}`}>
                  {msgFraude} <span className="text-sm font-normal opacity-70">({tauxFraude}%)</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails provenants de la BP Fraude</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${erreurBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Erreurs Adressage</CardTitle>
              <AlertCircle className={`w-4 h-4 ${erreurIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className={`text-2xl font-bold ${erreurValue}`}>
                  {msgErreur}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails non justifiés</p>
            </CardContent>
          </Card>
        </div>
      );
    }

interface MessagingChartsProps {
  monthlyMsgData: { period: string; total: number; fraude: number; erreur: number }[];
  phishingChartData: { name: string; clics: number; saisies: number; signalements: number }[];
}

function MessagingCharts({ monthlyMsgData, phishingChartData }: Readonly<MessagingChartsProps>) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 shadow-sm flex flex-col">
        <CardHeader className="pb-0">
          <CardTitle className="text-xs font-semibold text-foreground uppercase flex items-center justify-between">
            <span>Bruit et Fraudes (Messagerie)</span>
            <span className="text-[10px] text-muted-foreground font-normal">6 derniers mois</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 pt-4 pb-2">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyMsgData.slice(-6)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="erreur" name="Erreurs (Bruit)" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="fraude" name="Fraudes" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card className="shadow-sm flex flex-col border-l-4 border-l-amber-500">
        <CardHeader className="pb-0">
          <CardTitle className="text-xs font-semibold text-foreground uppercase flex items-center justify-between">
            <span>Taux de Clics (Phishing)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 pt-4 pb-2">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={phishingChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={10} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px', borderRadius: '8px' }} formatter={(val) => `${val}%`} />
                <Bar dataKey="clics" name="Taux de Clics" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface KpiGridProps {
  pasCoverage: number; validatedPas: number; totalProjects: number;
  riskAnalysisCoverage: number; appsWithRiskAnalysis: number; totalApps: number;
  auditCoverage: number; auditedApps: number;
  msgTotal: number; msg1212: number; tauxInterne: number; msgExterne: number;
  okPoliciesCount: number; totalPolicies: number; avgCompliance: number; openGapsCount: number;
  campaignsThisYearCount: number; targetCampaignsPerYear: number; isGoalReached: boolean;
  sessionsThisYearCount: number; targetSessionsPerYear: number; isSessionGoalReached: boolean;
  elearningRate: number; elearningGoalReached: boolean;
}

    function KpiGrid(props: Readonly<KpiGridProps>) {
      const {
        pasCoverage, validatedPas, totalProjects, riskAnalysisCoverage, appsWithRiskAnalysis, totalApps,
        auditCoverage, auditedApps, msgTotal, msg1212, tauxInterne, msgExterne,
        okPoliciesCount, totalPolicies, avgCompliance, openGapsCount,
        campaignsThisYearCount, targetCampaignsPerYear, isGoalReached,
        sessionsThisYearCount, targetSessionsPerYear, isSessionGoalReached,
        elearningRate, elearningGoalReached,
      } = props;

      const pasBorder = thresholdClassAsc(pasCoverage, 80, 0, 'border-l-emerald-500', 'border-l-amber-500', 'border-l-slate-300');
      const pasIcon = thresholdClassAsc(pasCoverage, 80, 0, 'text-emerald-500', 'text-amber-500', 'text-slate-400');

      const riskBorder = thresholdClassAsc(riskAnalysisCoverage, 80, 0, 'border-l-primary', 'border-l-amber-500', 'border-l-slate-300');
      const auditBorder = thresholdClassAsc(auditCoverage, 80, 0, 'border-l-blue-500', 'border-l-amber-500', 'border-l-slate-300');

      const complianceBorder = binaryClass(avgCompliance >= 80, 'border-l-emerald-500', 'border-l-amber-500');
      const complianceIcon = binaryClass(avgCompliance >= 80, 'text-emerald-500', 'text-amber-500');

      const goalBorder = binaryClass(isGoalReached, 'border-l-emerald-500', 'border-l-blue-500');
      const goalIcon = binaryClass(isGoalReached, 'text-emerald-500', 'text-blue-500');

      const sessionBorder = binaryClass(isSessionGoalReached, 'border-l-emerald-500', 'border-l-amber-500');
      const sessionIcon = binaryClass(isSessionGoalReached, 'text-emerald-500', 'text-amber-500');

      const elearningBorder = binaryClass(elearningGoalReached, 'border-l-emerald-500', 'border-l-primary');
      const elearningIcon = binaryClass(elearningGoalReached, 'text-emerald-500', 'text-primary');

      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className={`border-l-4 shadow-sm ${pasBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Couverture PAS</CardTitle>
              <ShieldCheck className={`w-4 h-4 ${pasIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pasCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{validatedPas} projets sur {totalProjects}</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${riskBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Analyses Risques</CardTitle>
              <Target className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{riskAnalysisCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{appsWithRiskAnalysis} périmètres sur {totalApps}</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${auditBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Couverture Audit</CardTitle>
              <ShieldAlert className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{auditCoverage}%</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{auditedApps} périmètres sur {totalApps}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Volume Total Msg</CardTitle>
              <Inbox className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-foreground">{msgTotal}</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails reçus ce mois</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Remontées 1212</CardTitle>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {msg1212} <span className="text-sm font-normal opacity-70">({tauxInterne}%)</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Mails provenant du 1212</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-slate-400 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Externes</CardTitle>
              <Globe className="w-4 h-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{msgExterne}</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Provenant de l'extérieur</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-primary shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Santé du Référentiel</CardTitle>
              <FileText className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{okPoliciesCount} / {totalPolicies}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Politiques à jour</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${complianceBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Score Conformité</CardTitle>
              <ShieldCheck className={`w-4 h-4 ${complianceIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgCompliance}%</div>
              <CustomProgress value={avgCompliance} label="Score moyen" colorClass={binaryClass(avgCompliance >= 80, "bg-emerald-500", "bg-amber-500")} />
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Plan d'Action</CardTitle>
              <Activity className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{openGapsCount}</div>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Écarts ouverts (Politiques)</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${goalBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Campagnes Phishing</CardTitle>
              <Target className={`w-4 h-4 ${goalIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold flex items-baseline gap-1">
                {campaignsThisYearCount} <span className="text-sm font-normal text-muted-foreground">/ {targetCampaignsPerYear}</span>
              </div>
              <CustomProgress value={campaignsThisYearCount} max={targetCampaignsPerYear} label="Campagnes annuelles" colorClass={binaryClass(isGoalReached, "bg-emerald-500", "bg-blue-500")} />
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${sessionBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">Sessions Animées</CardTitle>
              <Mic className={`w-4 h-4 ${sessionIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold flex items-baseline gap-1">
                {sessionsThisYearCount} <span className="text-sm font-normal text-muted-foreground">/ {targetSessionsPerYear}</span>
              </div>
              <CustomProgress value={sessionsThisYearCount} max={targetSessionsPerYear} label="Webinaires / Présentiel" colorClass={binaryClass(isSessionGoalReached, "bg-emerald-500", "bg-amber-500")} />
            </CardContent>
          </Card>
          <Card className={`border-l-4 shadow-sm ${elearningBorder}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase">E-Learning</CardTitle>
              <Monitor className={`w-4 h-4 ${elearningIcon}`} />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold flex items-baseline gap-1">
                {elearningRate}% <span className="text-sm font-normal text-muted-foreground">/ 95%</span>
              </div>
              <CustomProgress value={elearningRate} max={95} label="Taux de complétion (Année en cours)" colorClass={binaryClass(elearningGoalReached, "bg-emerald-500", "bg-primary")} />
            </CardContent>
          </Card>
        </div>
      );
    }

function CoverageChart({ data }: Readonly<{ data: { name: string; value: number; fill: string }[] }>) {
  return (
    <Card className="shadow-sm w-full">
      <CardHeader className="pb-0">
        <CardTitle className="text-xs font-semibold text-foreground uppercase">Couverture Sécurité Globale</CardTitle>
      </CardHeader>
      <CardContent className="pt-2 pb-4">
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
              <XAxis type="number" hide domain={[0, 100]} />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--foreground))", fontWeight: 500 }} width={120} />
              <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px', borderRadius: '8px' }} formatter={(val) => `${val}%`} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                {data.map((entry, index) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { entries, availablePeriods, selectedPeriod, setSelectedPeriod, getFilteredValue } = useKpi();
  const currentIdx = availablePeriods.indexOf(selectedPeriod);
  const canPrev = currentIdx > 0;
  const canNext = currentIdx < availablePeriods.length - 1;

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: vulns = [] } = useQuery({ queryKey: ['vulnerabilities'], queryFn: fetchVulnerabilities });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: gaps = [] } = useQuery({ queryKey: ['gaps'], queryFn: fetchGaps });
  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [] } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [] } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  const selectedYear = selectedPeriod ? Number.parseInt(selectedPeriod.split("-")[0], 10) : new Date().getFullYear();

  const {
    totalProjects, validatedPas, pasCoverage, projectsAtRisk,
    totalApps, auditedApps, auditCoverage, appsWithRiskAnalysis, riskAnalysisCoverage,
    totalCriticalVulns, totalHighVulns,
  } = useSecurityIndicators(projects, apps, vulns);

  const {
    totalPolicies, openGapsCount, criticalGapsCount, okPoliciesCount, avgCompliance,
  } = useGovernanceIndicators(policies, gaps);

  const {
    highRiskProfiles, campaignsThisYear, targetCampaignsPerYear, isGoalReached,
    compromiseRate, prevCompromiseRate, reportRate, prevReportRate, phishingChartData,
    elearningRate, elearningGoalReached, sessionsThisYear, targetSessionsPerYear, isSessionGoalReached,
  } = useAwarenessIndicators(campaigns, profiles, modules, selectedYear);

  const {
    msgTotal, msgFraude, msgErreur, msg1212, msgExterne, tauxFraude, tauxInterne, monthlyMsgData,
  } = useMessagingIndicators(entries, getFilteredValue);

  const coverageData = [
    { name: "Projets (PAS)", value: pasCoverage, fill: "#10b981" },
    { name: "Analyses Risques", value: riskAnalysisCoverage, fill: "#3b82f6" },
    { name: "Audits", value: auditCoverage, fill: "#8b5cf6" },
  ];

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
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
            <button type="button" onClick={() => setSelectedPeriod(availablePeriods[currentIdx - 1])} disabled={!canPrev} className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-1.5 px-2 min-w-[160px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium text-foreground capitalize">{formatPeriod(selectedPeriod)}</span>
            </div>
            <button type="button" onClick={() => setSelectedPeriod(availablePeriods[currentIdx + 1])} disabled={!canNext} className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors">
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <PeriodFilterBar />
          <TopAlerts />
        </div>
      </div>

      <section>
        <ExecutiveSummary />
      </section>

      <section className="pt-6 border-t border-border/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-500" /> Indicateurs de Maîtrise des Risques (KRI)
          </h2>
        </div>
        <KriGrid
          projectsAtRisk={projectsAtRisk}
          totalCriticalVulns={totalCriticalVulns}
          totalHighVulns={totalHighVulns}
          criticalGapsCount={criticalGapsCount}
          highRiskProfilesCount={highRiskProfiles.length}
          compromiseRate={compromiseRate}
          prevCompromiseRate={prevCompromiseRate}
          reportRate={reportRate}
          prevReportRate={prevReportRate}
          tauxFraude={tauxFraude}
          msgFraude={msgFraude}
          msgErreur={msgErreur}
        />
        <MessagingCharts monthlyMsgData={monthlyMsgData} phishingChartData={phishingChartData} />
      </section>

      <section className="pt-6 border-t border-border/50">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-primary" /> Performance et Conformité (KPI)
        </h2>
        <KpiGrid
          pasCoverage={pasCoverage}
          validatedPas={validatedPas}
          totalProjects={totalProjects}
          riskAnalysisCoverage={riskAnalysisCoverage}
          appsWithRiskAnalysis={appsWithRiskAnalysis}
          totalApps={totalApps}
          auditCoverage={auditCoverage}
          auditedApps={auditedApps}
          msgTotal={msgTotal}
          msg1212={msg1212}
          tauxInterne={tauxInterne}
          msgExterne={msgExterne}
          okPoliciesCount={okPoliciesCount}
          totalPolicies={totalPolicies}
          avgCompliance={avgCompliance}
          openGapsCount={openGapsCount}
          campaignsThisYearCount={campaignsThisYear.length}
          targetCampaignsPerYear={targetCampaignsPerYear}
          isGoalReached={isGoalReached}
          sessionsThisYearCount={sessionsThisYear.length}
          targetSessionsPerYear={targetSessionsPerYear}
          isSessionGoalReached={isSessionGoalReached}
          elearningRate={elearningRate}
          elearningGoalReached={elearningGoalReached}
        />
        <CoverageChart data={coverageData} />
      </section>

      <div className="pt-6 border-t border-border/50">
        <KpiChartTabs />
      </div>
    </div>
  );
}