import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/types/kpi";
import { Activity } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// Imports des fetchers pour interroger la vraie base de données
import { fetchProjects, fetchApplications, fetchVulnerabilities } from "@/lib/supabase-security";
import { fetchPolicies, fetchGaps } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns, fetchPhishingProfiles, fetchElearningModules } from "@/lib/supabase-awareness";

// Utilitaires de calcul
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
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

export default function ExecutiveSummary() {
  const { selectedPeriod } = useKpi();

  // 1. FETCH DE TOUTES LES DONNÉES OPÉRATIONNELLES
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: vulns = [] } = useQuery({ queryKey: ['vulnerabilities'], queryFn: fetchVulnerabilities });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: gaps = [] } = useQuery({ queryKey: ['gaps'], queryFn: fetchGaps });
  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [] } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [] } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  // 2. CALCUL EXPERT DES SCORES PAR DOMAINE
  const categoryHealth = useMemo(() => {
    const health = [];

    // ---------------------------------------------------------
    // A. GOUVERNANCE
    // ---------------------------------------------------------
    const totalPolicies = policies.length;
    const okPolicies = policies.filter(p => getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths, p.status) === 'ok').length;
    const govBase = totalPolicies > 0 ? (okPolicies / totalPolicies) * 100 : 100;

    const critGapsCount = gaps.filter(g => g.status !== 'resolu' && g.severity === 'critique').length;
    const govScore = Math.max(0, govBase - (critGapsCount * 20));

    health.push({ cat: "gouvernance", score: Math.round(govScore), label: CATEGORY_LABELS["gouvernance"], color: CATEGORY_COLORS["gouvernance"] });

    // ---------------------------------------------------------
    // B. RISQUES (PAS & Audits)
    // ---------------------------------------------------------
    const pasCov = projects.length > 0 ? (projects.filter(p => p.pasStatus === "validated").length / projects.length) * 100 : 100;
    const audCov = apps.length > 0 ? (apps.filter(a => a.lastAuditDate && getDynamicStatus(a.lastAuditDate, a.auditFrequencyMonths || 12, "active") !== "expired").length / apps.length) * 100 : 100;
    const riskCov = apps.length > 0 ? (apps.filter(a => a.lastRiskAnalysisDate && getDynamicStatus(a.lastRiskAnalysisDate, a.riskAnalysisFrequencyMonths || 36, "active") !== "expired").length / apps.length) * 100 : 100;
    const riskBase = (pasCov + audCov + riskCov) / 3;

    const activeVulns = vulns.filter(v => v.status === "ouvert");
    const critVulnsCount = activeVulns.filter(v => v.severity === "critique").length;
    const highVulnsCount = activeVulns.filter(v => v.severity === "eleve").length;
    const badGoLiveCount = projects.filter(p => p.pasStatus !== "validated" && p.riskLevel === "fort").length;

    const riskScore = Math.max(0, riskBase - (critVulnsCount * 20) - (highVulnsCount * 5) - (badGoLiveCount * 15));

    health.push({ cat: "risques", score: Math.round(riskScore), label: CATEGORY_LABELS["risques"], color: CATEGORY_COLORS["risques"] });

    // ---------------------------------------------------------
    // C. SENSIBILISATION
    // ---------------------------------------------------------
    const selectedYear = selectedPeriod ? parseInt(selectedPeriod.split("-")[0]) : new Date().getFullYear();

    const elearningModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") === "E-Learning");
    const totalElearningAssigned = elearningModules.reduce((acc, m) => acc + (safeNum(m.totalAssigned) || safeNum((m as any).total_assigned)), 0);
    const totalElearningCompleted = elearningModules.reduce((acc, m) => acc + (safeNum(m.completedCount) || safeNum((m as any).completed_count)), 0);
    const elearningScore = totalElearningAssigned > 0 ? (totalElearningCompleted / totalElearningAssigned) * 100 : 100;

    const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === selectedYear);
    const phishingExecScore = Math.min(100, (campaignsThisYear.length / 4) * 100);

    const sessionModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning");
    const sessionsThisYear = sessionModules.filter(m => new Date(m.startDate || m.createdAt || "").getFullYear() === selectedYear);
    const sessionsExecScore = Math.min(100, (sessionsThisYear.length / 4) * 100);

    const sensiBase = (elearningScore * 0.4) + (phishingExecScore * 0.3) + (sessionsExecScore * 0.3);

    const highRiskProfilesCount = profiles.filter(p => safeNum(p.riskScore) >= 60).length;
    const riskProfileRatio = profiles.length > 0 ? (highRiskProfilesCount / profiles.length) * 100 : 0;
    const profilePenalty = Math.min(15, riskProfileRatio);

    const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.sendDate).getTime() - new Date(a.sendDate).getTime());
    const latestCompRate = sortedCampaigns.length > 0 ? (safeNum(sortedCampaigns[0].compromisedCount) / safeNum(sortedCampaigns[0].targetCount)) * 100 : 0;

    let phishingPenalty = 0;
    if (latestCompRate > 10) phishingPenalty = 20;
    else if (latestCompRate > 5) phishingPenalty = 10;

    const sensiScore = Math.max(0, sensiBase - profilePenalty - phishingPenalty);

    health.push({ cat: "sensibilisation", score: Math.round(sensiScore), label: CATEGORY_LABELS["sensibilisation"], color: CATEGORY_COLORS["sensibilisation"] });

    return health;
  }, [projects, apps, vulns, policies, gaps, campaigns, profiles, modules, selectedPeriod]);

  // 3. LE SCORE GLOBAL DE LA CONSOLE
  const securityScore = categoryHealth.length > 0
    ? Math.round(categoryHealth.reduce((acc, cat) => acc + cat.score, 0) / categoryHealth.length)
    : 0;

  // Design dynamique
  const scoreColor = securityScore >= 75 ? "text-emerald-500" : securityScore >= 50 ? "text-amber-500" : "text-rose-500";
  const scoreRing = securityScore >= 75 ? "stroke-emerald-500" : securityScore >= 50 ? "stroke-amber-500" : "stroke-rose-500";

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (securityScore / 100) * circumference;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Jauge Centrale de l'Indice de Posture (1/3 de l'espace) */}
      <div className="glass-panel flex flex-col items-center justify-center py-8 shadow-sm border border-border">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              className={scoreRing}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-3xl font-bold font-mono ${scoreColor}`}>{securityScore}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Score</span>
          </div>
        </div>
        <p className="text-sm text-foreground mt-4 font-bold uppercase tracking-wide">Indice de Posture Globale</p>
      </div>

      {/* Barres de Santé par Catégorie (2/3 de l'espace) */}
      <div className="glass-panel lg:col-span-2 p-6 shadow-sm border border-border flex flex-col justify-center">
        <h3 className="text-sm font-bold uppercase text-foreground mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Maturité Évaluée par Domaine
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-8">
          {categoryHealth.map(({ cat, score, label, color }) => (
            <div key={cat} className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-foreground">{label}</span>
                <span style={{ color }} className="font-mono text-sm">{score}%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-200/80 dark:bg-slate-800 shadow-inner overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${score}%`, backgroundColor: color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}