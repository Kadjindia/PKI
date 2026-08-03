import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  X, ShieldAlert, Rocket, Clock, Target, FileText, Bell, CheckCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Fetchers
import { fetchProjects, fetchApplications } from "@/lib/supabase-security";
import { fetchPolicies, fetchGaps } from "@/lib/supabase-governance";
import { fetchPhishingCampaigns } from "@/lib/supabase-awareness";

// --- TYPES & INTERFACES ---
interface AlertItem {
  id: string;
  severity: 'critical' | 'warning';
  icon: React.ReactNode;
  title: string;
  message: string;
  link: string;
}

// --- FONCTIONS UTILITAIRES EXTRAITES POUR RÉDUIRE LA COMPLEXITÉ COGNITIVE ---

// Correction SonarQube: Date.now() au lieu de new Date().getTime()
const getDynamicStatus = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "manquant";
  const nextDate = new Date(lastDate);
  nextDate.setMonth(nextDate.getMonth() + (freqMonths || 12));
  const diffDays = Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "dépassé";
  if (diffDays <= 60) return "bientôt";
  return "ok";
};

const getPolicyAlerts = (policies: any[]): AlertItem[] => {
  const alerts: AlertItem[] = [];
  policies.forEach(p => {
    const status = getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths);
    if (status === "dépassé" || status === "bientôt") {
      alerts.push({
        id: `policy-${p.id}-${status}`,
        severity: status === "dépassé" ? 'critical' : 'warning',
        icon: <FileText className="w-4 h-4" />,
        title: `Politique ${status}`,
        message: `"${p.title}" est ${status === "dépassé" ? 'expirée' : 'à réviser'}.`,
        link: `/gouvernance?policyId=${p.id}`
      });
    }
  });
  return alerts;
};

const getGapAlerts = (gaps: any[]): AlertItem[] => {
  const alerts: AlertItem[] = [];
  const today = Date.now(); // Correction SonarQube
  gaps.forEach(g => {
    if (g.status !== 'resolu') {
      const createdDate = new Date(g.createdAt).getTime();
      const diffMonth = (today - createdDate) / (1000 * 60 * 60 * 24 * 30);
      if (diffMonth >= 1) {
        alerts.push({
          id: `gap-${g.id}`,
          severity: 'critical',
          icon: <ShieldAlert className="w-4 h-4" />,
          title: "Écart ancien non clôturé",
          message: `L'écart "${g.title}" traîne depuis plus d'un mois.`,
          link: `/governance?gapId=${g.id}`
        });
      }
    }
  });
  return alerts;
};

const getPasAlerts = (projects: any[]): AlertItem[] => {
  const alerts: AlertItem[] = [];
  const today = Date.now(); // Correction SonarQube
  projects.forEach(p => {
    if (p.pasStatus !== 'validated' && p.goLiveDate) {
      const glDate = new Date(p.goLiveDate).getTime();
      const diffMonth = (glDate - today) / (1000 * 60 * 60 * 24 * 30);
      if (diffMonth <= 3 && diffMonth >= 0) {
        alerts.push({
          id: `pas-${p.id}`,
          severity: 'critical',
          icon: <Rocket className="w-4 h-4" />,
          title: "Alerte Go-Live (PAS)",
          message: `Mise en prod de "${p.name}" dans <3 mois, PAS toujours invalide.`,
          link: `/security-ops?projectId=${p.id}`
        });
      }
    }
  });
  return alerts;
};

const getAppAlerts = (apps: any[]): AlertItem[] => {
  const alerts: AlertItem[] = [];
  apps.forEach(a => {
    const auditStatus = getDynamicStatus(a.lastAuditDate, a.auditFrequencyMonths);
    const riskStatus = getDynamicStatus(a.lastRiskAnalysisDate, a.riskAnalysisFrequencyMonths);

    if (["bientôt", "dépassé", "manquant"].includes(auditStatus) || ["bientôt", "dépassé", "manquant"].includes(riskStatus)) {
      alerts.push({
        id: `app-status-${a.id}`,
        severity: (auditStatus === 'dépassé' || riskStatus === 'dépassé') ? 'critical' : 'warning',
        icon: <Clock className="w-4 h-4" />,
        title: "Contrôle en retard",
        message: `Audit ou analyse de risques pour "${a.name}" ${auditStatus === 'dépassé' ? 'dépassé' : 'à prévoir'}.`,
        link: `/security-ops?appId=${a.id}`
      });
    }
  });
  return alerts;
};

const getPhishingAlerts = (campaigns: any[]): AlertItem[] => {
  const alerts: AlertItem[] = [];
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.sendDate).getTime() - new Date(a.sendDate).getTime());

  if (sortedCampaigns.length > 0) {
    const latestCampaign = sortedCampaigns[0];
    const clickRate = latestCampaign.targetCount > 0 ? (latestCampaign.clickedCount / latestCampaign.targetCount) * 100 : 0;
    if (clickRate > 5) {
      alerts.push({
        id: `phish-${latestCampaign.id}`,
        severity: 'warning',
        icon: <Target className="w-4 h-4" />,
        title: "Alerte Phishing (>5%)",
        message: `La dernière campagne affiche un taux de clics de ${Math.round(clickRate)}%.`,
        link: `/sensibilisation?campaignId=${latestCampaign.id}`
      });
    }
  }
  return alerts;
};

// --- COMPOSANT PRINCIPAL ---

export default function TopAlerts() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Persistance des notifications supprimées
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem("dismissed_alerts");
    return saved ? JSON.parse(saved) : [];
  });

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: policies = [] } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: gaps = [] } = useQuery({ queryKey: ['gaps'], queryFn: fetchGaps });
  const { data: campaigns = [] } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });

  useEffect(() => {
    localStorage.setItem("dismissed_alerts", JSON.stringify(dismissedIds));
  }, [dismissedIds]);

  // Fermer le menu si on clique en dehors
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDismissedIds(prev => [...prev, id]);
  };

  const handleDismissAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const allIds = currentAlerts.map(a => a.id);
    setDismissedIds(prev => [...new Set([...prev, ...allIds])]);
    setIsOpen(false);
  };

  // Agrégation optimisée des alertes grâce à l'extraction des fonctions
  const allAlerts = useMemo(() => {
    return [
      ...getPolicyAlerts(policies),
      ...getGapAlerts(gaps),
      ...getPasAlerts(projects),
      ...getAppAlerts(apps),
      ...getPhishingAlerts(campaigns)
    ];
  }, [policies, gaps, projects, apps, campaigns]);

  const currentAlerts = allAlerts.filter(alert => !dismissedIds.includes(alert.id));
  const unreadCount = currentAlerts.length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* LA PASTILLE (CLOCHE) EN HAUT */}
      {/* Correction SonarQube : Ajout explicite du type="button" */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 rounded-full bg-background border border-border shadow-sm hover:bg-secondary transition-all"
        aria-label="Ouvrir les notifications"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white shadow-sm ring-2 ring-background">
            {unreadCount}
          </span>
        )}
      </button>

      {/* LE MENU DÉROULANT DES NOTIFICATIONS */}
      {isOpen && (
        <div className="absolute right-0 mt-3 w-[380px] bg-background border border-border rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-top-2">

          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <h3 className="font-bold text-sm flex items-center gap-2">
              Notifications
              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">{unreadCount}</Badge>
            </h3>
            {unreadCount > 0 && (
              // Correction SonarQube : Ajout explicite du type="button"
              <button
                type="button"
                onClick={handleDismissAll}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Tout ignorer
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 p-2 space-y-1 bg-muted/10">
            {unreadCount === 0 ? (
              <div className="py-8 text-center flex flex-col items-center text-muted-foreground">
                <Bell className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm font-medium">Tout est en ordre</p>
                <p className="text-xs opacity-60">Aucune alerte en attente</p>
              </div>
            ) : (
              currentAlerts.map((alert) => (
                // Correction SonarQube : Retrait du onClick de la DIV, utilisation d'un bouton Overlay natif
                <div
                  key={alert.id}
                  className={`group relative p-3 rounded-lg border bg-background transition-all hover:shadow-md hover:scale-[1.01] ${
                    alert.severity === 'critical' ? 'hover:border-rose-300' : 'hover:border-amber-300'
                  }`}
                >
                  {/* BOUTON OVERLAY POUR L'ACCESSIBILITÉ */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      navigate(alert.link);
                    }}
                    className="absolute inset-0 w-full h-full z-10 cursor-pointer outline-none focus:ring-2 focus:ring-primary rounded-lg opacity-0 focus:opacity-100"
                    aria-label={`Ouvrir ${alert.title}`}
                  />

                  <div className="flex gap-3 relative z-0">
                    <div className={`mt-0.5 w-8 h-8 rounded-full flex flex-shrink-0 items-center justify-center ${
                      alert.severity === 'critical' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                    }`}>
                      {alert.icon}
                    </div>
                    <div className="flex-1 pr-6">
                      <p className={`text-xs font-bold mb-0.5 ${alert.severity === 'critical' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-500'}`}>
                        {alert.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {alert.message}
                      </p>
                    </div>
                  </div>

                  {/* Bouton pour ignorer individuellement (La croix) */}
                  {/* Correction SonarQube : Ajout explicite du type="button" et z-index pour passer au dessus de l'overlay */}
                  <button
                    type="button"
                    onClick={(e) => handleDismiss(e, alert.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary transition-all z-20"
                    aria-label="Ignorer l'alerte"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}