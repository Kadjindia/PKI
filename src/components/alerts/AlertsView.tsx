import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS } from "@/types/kpi";
import {
  Bell, AlertTriangle, AlertCircle, CheckCircle2,
  Filter, Check, Activity, Lightbulb
} from "lucide-react";
import { toast } from "sonner"; // Utilise la librairie de toast de ton projet

// --- MOTEUR D'INTELLIGENCE ET RECOMMANDATIONS SSI ---
const getContextualAdvice = (category: string, level: string) => {
  if (level === "ok") return null;

  const advices: Record<string, { danger: string, warning: string }> = {
    gouvernance: {
      danger: "Alerte de conformité critique. Convoquer la direction et lancer un audit d'urgence.",
      warning: "Écart documentaire détecté. Planifier une revue des politiques de sécurité."
    },
    'security-ops': {
      danger: "Vulnérabilité ou menace active. Isoler les systèmes, vérifier l'EDR et analyser le SIEM.",
      warning: "Anomalie technique. Vérifier la couverture des correctifs et les journaux d'événements."
    },
    sensibilisation: {
      danger: "Risque humain très élevé. Déployer une formation anti-phishing obligatoire immédiatement.",
      warning: "Baisse d'attention détectée. Programmer un rappel des bonnes pratiques aux collaborateurs."
    },
    risques: {
      danger: "Risque inacceptable avéré. Appliquer le plan de remédiation sans délai.",
      warning: "Évolution négative d'un risque. Surveiller l'indicateur et revoir les mesures compensatoires."
    },
    messagerie: {
      danger: "Forte vague d'attaques par email. Bloquer les domaines suspects et alerter les utilisateurs.",
      warning: "Hausse du spam/phishing bloqué. Vérifier les règles de filtrage de la passerelle mail."
    }
  };

  const defaultAdvice = {
    danger: "Violation de seuil de sécurité critique. Investigation et action corrective immédiates requises.",
    warning: "Seuil d'attention atteint. Analyse préventive recommandée par l'équipe SSI."
  };

  return advices[category]?.[level as "danger" | "warning"] || defaultAdvice[level as "danger" | "warning"];
};

export default function AlertsView() {
  const { kpis, getLatestValue } = useKpi();

  // Nouveaux états pour le filtre et l'acquittement
  const [filter, setFilter] = useState<"all" | "danger" | "warning">("all");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());

  // Calcul des alertes
  const allAlerts = kpis
    .filter((kpi) => kpi.thresholdDanger !== undefined || kpi.thresholdWarning !== undefined)
    .map((kpi) => {
      const value = getLatestValue(kpi.id);
      const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";
      let level: "ok" | "warning" | "danger" = "ok";

      if (value !== undefined) {
        if (kpi.thresholdDanger !== undefined && (isPercentage ? value <= kpi.thresholdDanger : value >= kpi.thresholdDanger)) {
          level = "danger";
        } else if (kpi.thresholdWarning !== undefined && (isPercentage ? value <= kpi.thresholdWarning : value >= kpi.thresholdWarning)) {
          level = "warning";
        }
      }
      return { kpi, value, level, isPercentage };
    })
    .sort((a, b) => {
      const order = { danger: 0, warning: 1, ok: 2 };
      return order[a.level] - order[b.level];
    });

  // Statistiques pour les nouvelles cartes en haut
  const activeAlerts = allAlerts.filter(a => a.level !== "ok" && !acknowledgedAlerts.has(a.kpi.id));
  const dangerCount = activeAlerts.filter(a => a.level === "danger").length;
  const warningCount = activeAlerts.filter(a => a.level === "warning").length;
  const okCount = allAlerts.filter(a => a.level === "ok").length;

  // Filtrage
  const displayedAlerts = allAlerts.filter(a => {
    if (filter === "danger") return a.level === "danger";
    if (filter === "warning") return a.level === "warning";
    return true;
  });

  // Action métier
  const handleAcknowledge = (kpiId: string, kpiName: string) => {
    setAcknowledgedAlerts(prev => new Set(prev).add(kpiId));
    toast.success(`Alerte prise en charge : ${kpiName}`);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* 1. NOUVEL EN-TÊTE */}
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Bell className="w-8 h-8 text-primary" />
          Centre Opérationnel d'Alertes
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Surveillance des indicateurs et recommandations de remédiation.
        </p>
      </div>

      {/* 2. NOUVELLES CARTES DE RÉSUMÉ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5 border-t-4 border-t-destructive flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Alertes Critiques</p>
            <h2 className="text-3xl font-bold text-foreground mt-1">{dangerCount}</h2>
          </div>
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
        </div>

        <div className="glass-panel p-5 border-t-4 border-t-accent flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Avertissements</p>
            <h2 className="text-3xl font-bold text-foreground mt-1">{warningCount}</h2>
          </div>
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-accent" />
          </div>
        </div>

        <div className="glass-panel p-5 border-t-4 border-t-success flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Indicateurs Sains</p>
            <h2 className="text-3xl font-bold text-foreground mt-1">{okCount}</h2>
          </div>
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-success" />
          </div>
        </div>
      </div>

      {/* 3. NOUVEAU FILTRE */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-card border border-border p-3 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground pl-2">
          <Filter className="w-4 h-4" />
          Niveau de sévérité :
        </div>
        <div className="flex p-1 bg-muted rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setFilter("all")}
            className={`flex-1 sm:px-6 py-1.5 text-sm font-semibold rounded-md transition-colors ${filter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Toutes
          </button>
          <button
            onClick={() => setFilter("danger")}
            className={`flex-1 sm:px-6 py-1.5 text-sm font-semibold rounded-md transition-colors ${filter === "danger" ? "bg-destructive text-destructive-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Critiques
          </button>
          <button
            onClick={() => setFilter("warning")}
            className={`flex-1 sm:px-6 py-1.5 text-sm font-semibold rounded-md transition-colors ${filter === "warning" ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Avertissements
          </button>
        </div>
      </div>

      {/* 4. LISTE DÉTAILLÉE DES ALERTES */}
      <div className="space-y-4">
        {displayedAlerts.length === 0 ? (
          <div className="text-center py-12 glass-panel flex flex-col items-center">
            <CheckCircle2 className="w-12 h-12 text-success mb-3 opacity-50" />
            <h3 className="text-lg font-bold text-foreground">Aucune alerte à afficher</h3>
            <p className="text-sm text-muted-foreground mt-1">Tous les indicateurs pour ce filtre sont dans les normes.</p>
          </div>
        ) : (
          displayedAlerts.map(({ kpi, value, level, isPercentage }) => {
            const isAcknowledged = acknowledgedAlerts.has(kpi.id);
            const valueDisplay = value !== undefined ? (isPercentage ? `${value}%` : value) : "—";
            const advice = getContextualAdvice(kpi.category, level);

            return (
              <div
                key={kpi.id}
                className={`glass-panel p-0 overflow-hidden flex flex-col transition-all duration-300 border-l-4 ${
                  isAcknowledged ? "opacity-60 border-l-muted grayscale-[50%]" :
                  level === "danger" ? "border-l-destructive shadow-sm shadow-destructive/10" :
                  level === "warning" ? "border-l-accent shadow-sm shadow-accent/10" : "border-l-success"
                }`}
              >
                <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
                  {/* Icône */}
                  <div className="shrink-0">
                    {level === "danger" ? <AlertCircle className="w-8 h-8 text-destructive" /> :
                     level === "warning" ? <AlertTriangle className="w-8 h-8 text-accent" /> :
                     <CheckCircle2 className="w-8 h-8 text-success" />}
                  </div>

                  {/* Infos */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold ${isAcknowledged ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {kpi.name}
                      </h3>
                      {isAcknowledged && (
                        <span className="px-2 py-0.5 text-[10px] uppercase font-bold bg-muted text-muted-foreground rounded-full">
                          En cours
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 bg-secondary rounded-md text-xs font-medium">
                        {CATEGORY_LABELS[kpi.category] || kpi.category}
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <Activity className="w-3 h-3" /> Valeur :
                        <strong className={level === "danger" ? "text-destructive" : level === "warning" ? "text-accent" : "text-foreground"}>
                          {valueDisplay}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Seuils */}
                  <div className="w-full sm:w-64 shrink-0 bg-muted/50 p-3 rounded-lg flex flex-col justify-center">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-medium">Seuils définis :</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      {kpi.thresholdWarning !== undefined && (
                        <span className="text-accent font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {isPercentage ? `${kpi.thresholdWarning}%` : kpi.thresholdWarning}
                        </span>
                      )}
                      {kpi.thresholdDanger !== undefined && (
                        <span className="text-destructive font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {isPercentage ? `${kpi.thresholdDanger}%` : kpi.thresholdDanger}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action */}
                  <div className="shrink-0 flex sm:flex-col gap-2 justify-end">
                    {level !== "ok" && !isAcknowledged && (
                      <button
                        onClick={() => handleAcknowledge(kpi.id, kpi.name)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground rounded-lg font-semibold text-sm transition-colors"
                      >
                        <Check className="w-4 h-4" /> Prendre en charge
                      </button>
                    )}
                  </div>
                </div>

                {/* BANDEAU DE RECOMMANDATION (Nouveau) */}
                {advice && !isAcknowledged && (
                  <div className={`px-5 py-3 flex items-start gap-3 border-t ${level === 'danger' ? 'bg-destructive/5 border-destructive/10' : 'bg-accent/5 border-accent/10'}`}>
                    <Lightbulb className={`w-5 h-5 mt-0.5 shrink-0 ${level === 'danger' ? 'text-destructive' : 'text-accent'}`} />
                    <div>
                      <span className={`text-xs font-bold uppercase tracking-wider ${level === 'danger' ? 'text-destructive' : 'text-accent'}`}>
                        Action requise
                      </span>
                      <p className="text-sm font-medium text-foreground mt-0.5">
                        {advice}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}