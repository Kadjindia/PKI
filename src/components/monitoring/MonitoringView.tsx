import { useState, useMemo } from "react";
import {
  Radar, UploadCloud, Shield, RefreshCw,
  Lightbulb, AlertOctagon, AlertTriangle, CheckCircle2,
  Flame, ShieldAlert, Activity, Eye
} from "lucide-react";
import { toast } from "sonner";

// --- PARSEUR CSV QRADAR ---
const parseCSV = (text: string) => {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentVal = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && text[i + 1] === '"') {
      currentVal += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentVal.trim());
      currentVal = "";
    } else if (char === '\n' && !inQuotes) {
      currentLine.push(currentVal.trim());
      lines.push(currentLine);
      currentLine = [];
      currentVal = "";
    } else if (char !== '\r') {
      currentVal += char;
    }
  }
  if (currentVal || text[text.length - 1] === ',') currentLine.push(currentVal.trim());
  if (currentLine.length > 0 && currentLine.some(v => v !== "")) lines.push(currentLine);
  return lines;
};

const getCol = (headers: string[], row: string[], possibleNames: string[], defaultValue: any = "") => {
  const idx = headers.findIndex(h => possibleNames.includes(h.trim().toLowerCase()));
  if (idx === -1 || !row[idx]) return defaultValue;
  return row[idx].trim();
};

export default function MonitoringView() {
  const [qradarData, setQradarData] = useState<any[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleQradarUpload = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error("Veuillez sélectionner un fichier CSV valide.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = parseCSV(content);

      if (parsed.length < 2) {
        toast.error("Le fichier semble vide ou invalide.");
        return;
      }

      const headers = parsed[0].map(h => h.toLowerCase().trim());

      const mappedData = parsed.slice(1).map((row) => {
        const status = getCol(headers, row, ["status", "état"], "ouvert").toLowerCase();
        const isActive = !status.includes("clos") && !status.includes("closed") && !status.includes("hidden");

        return {
          magnitude: parseInt(getCol(headers, row, ["magnitude"], "0")) || 0,
          severity: parseInt(getCol(headers, row, ["severity"], "0")) || 0,
          credibility: parseInt(getCol(headers, row, ["credibility"], "0")) || 0,
          relevance: parseInt(getCol(headers, row, ["relevance"], "0")) || 0,
          description: getCol(headers, row, ["description", "offense description"], "Menace non spécifiée"),
          offenseType: getCol(headers, row, ["formattedoffensetype"], "Générique"),
          userCount: parseInt(getCol(headers, row, ["usercount"], "0")) || 0,
          deviceCount: parseInt(getCol(headers, row, ["devicecount"], "0")) || 0,
          eventCount: parseInt(getCol(headers, row, ["eventcount"], "0")) || 0,
          flowCount: parseInt(getCol(headers, row, ["flowcount"], "0")) || 0,
          isActive,
        };
      });

      setQradarData(mappedData);
      toast.success(`Analyse terminée : ${mappedData.length} signaux traités.`);
    };
    reader.readAsText(file);
  };

  // --- MOTEUR DE CALCUL STRATÉGIQUE (EXECUTIVE SUMMARY) ---
  const executiveSummary = useMemo(() => {
    if (!qradarData || qradarData.length === 0) return null;

    // Métriques d'agrégation globale pour le RSSI
    let totalMagnitude = 0;
    let totalSeverity = 0;
    let totalCredibility = 0;
    let totalRelevance = 0;
    let totalEvents = 0;
    let totalFlows = 0;
    let totalImpactedDevices = 0;

    let criticalThreatsCount = 0;
    let alertsTargetingIdentities = 0;
    let maxUsersInSingleAlert = 0;
    const descriptionDistribution: Record<string, number> = {};

    // Filtrage et calculs sur les menaces actives
    const activeAlerts = qradarData.filter(t => t.isActive);
    const totalActive = activeAlerts.length;

    activeAlerts.forEach(threat => {
      // Cumul pour les scores moyens de risque
      totalMagnitude += threat.magnitude;
      totalSeverity += threat.severity;
      totalCredibility += threat.credibility;
      totalRelevance += threat.relevance;

      // Cumul des volumes (Blast Radius)
      totalEvents += threat.eventCount;
      totalFlows += threat.flowCount;
      totalImpactedDevices += threat.deviceCount;

      // 1. Seuils de crise (Magnitude GRC ≥ 7)
      if (threat.magnitude >= 7) criticalThreatsCount++;

      // 2. Blast Radius Identités
      if (threat.userCount > 0) {
        alertsTargetingIdentities++;
        if (threat.userCount > maxUsersInSingleAlert) {
          maxUsersInSingleAlert = threat.userCount;
        }
      }

      // 3. Distribution des descriptions
      const cleanDesc = threat.description.split('-')[0].split(',')[0].trim();
      descriptionDistribution[cleanDesc] = (descriptionDistribution[cleanDesc] || 0) + 1;
    });

    const sortedDescriptions = Object.entries(descriptionDistribution).sort((a, b) => b[1] - a[1]);
    const mainThreat = sortedDescriptions.length > 0 ? sortedDescriptions[0] : null;

    // --- GÉNÉRATION DYNAMIQUE DES RECOMMANDATIONS ---
    const insights = [];

    if (criticalThreatsCount > 0) {
      insights.push({
        level: 'danger',
        text: `Exposition Critique : ${criticalThreatsCount} alertes de magnitude extrême (≥ 7) sont actuellement actives. Le potentiel de compromission systémique est élevé.`
      });
    }

    if (mainThreat && totalActive > 0 && (mainThreat[1] / totalActive) > 0.3) {
      const weight = Math.round((mainThreat[1] / totalActive) * 100);
      insights.push({
        level: 'warning',
        text: `Vecteur d'attaque dominant : La typologie "${mainThreat[0]}" représente à elle seule ${weight}% des menaces actives. Une remédiation ciblée sur cette famille d'alertes est requise.`
      });
    }

    if (alertsTargetingIdentities > 0) {
      insights.push({
        level: 'warning',
        text: `Risque d'usurpation : ${alertsTargetingIdentities} incidents distincts ciblent activement vos identités, avec un impact maximal de ${maxUsersInSingleAlert} comptes sur une seule et même attaque.`
      });
    }

    if (insights.length === 0) {
      insights.push({
        level: 'success',
        text: "Situation nominale : L'analyse automatisée ne met en évidence aucune anomalie de criticité, concentration de menace ou risque sur les comptes."
      });
    }

    return {
      total: qradarData.length,
      totalActive,
      // Calcul des scores moyens pondérés
      avgMagnitude: totalActive > 0 ? (totalMagnitude / totalActive).toFixed(1) : "0",
      avgSeverity: totalActive > 0 ? (totalSeverity / totalActive).toFixed(1) : "0",
      avgCredibility: totalActive > 0 ? (totalCredibility / totalActive).toFixed(1) : "0",
      avgRelevance: totalActive > 0 ? (totalRelevance / totalActive).toFixed(1) : "0",
      totalEvents,
      totalFlows,
      totalImpactedDevices,
      insights
    };
  }, [qradarData]);

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-12">
      {!qradarData || !executiveSummary ? (
        // DROPZONE
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-3 mb-6">
            <Radar className="w-7 h-7 text-blue-500" /> Analyse des Signaux de Menace (SIEM)
          </h2>
          <div className="border-2 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center bg-card border-border hover:border-blue-500/50 transition-all">
            <UploadCloud className="w-16 h-16 text-blue-500 mb-6" />
            <h3 className="text-xl font-bold text-foreground mb-2">Charger l'export des menaces</h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              Glissez-deposez le fichier CSV QRadar pour générer la synthèse décisionnelle.
            </p>
            <label className="px-6 py-3 bg-blue-500 text-white font-semibold rounded-lg cursor-pointer hover:bg-blue-600 transition-colors">
              Sélectionner le CSV
              <input type="file" className="hidden" accept=".csv" onChange={(e) => e.target.files && handleQradarUpload(e.target.files[0])} />
            </label>
          </div>
        </div>
      ) : (
        // TABLEAU DE BORD EXÉCUTIF COMPLÈTEMENT ALIMENTÉ
        <div className="space-y-6">
          <div className="flex justify-between items-end border-b border-border pb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <Shield className="w-8 h-8 text-blue-500" /> Note de Posture & État de la Menace
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                Analyse macro basée sur <strong>{executiveSummary.total} alertes qualifiées</strong> (dont {executiveSummary.totalActive} en cours).
              </p>
            </div>
            <label className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-secondary text-secondary-foreground rounded-lg cursor-pointer hover:bg-secondary/80 border border-border">
              <RefreshCw className="w-4 h-4" /> Changer de fichier
              <input type="file" className="hidden" accept=".csv" onChange={(e) => e.target.files && handleQradarUpload(e.target.files[0])} />
            </label>
          </div>

          {/* BLOC DES INCIDENTS ET DU NIVEAU DE RISQUE GLOBAL */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* CARTE 1 : INDICE DE GRAVITÉ EXÉCUTIF */}
            <div className="glass-panel p-6 flex flex-col justify-between border-t-4 border-t-destructive">
              <div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-destructive" /> Niveau de Menace Actuel
                </span>
                <div className="flex items-baseline gap-2 mt-4">
                  <span className="text-4xl font-black text-destructive">{executiveSummary.avgMagnitude}</span>
                  <span className="text-sm text-muted-foreground">/ 10 (Mag. Moyenne)</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-2 text-center text-xs">
                <div><span className="block font-bold text-foreground">{executiveSummary.avgSeverity}</span><span className="text-[10px] text-muted-foreground uppercase">Sévérité</span></div>
                <div><span className="block font-bold text-foreground">{executiveSummary.avgCredibility}</span><span className="text-[10px] text-muted-foreground uppercase">Crédibilité</span></div>
                <div><span className="block font-bold text-foreground">{executiveSummary.avgRelevance}</span><span className="text-[10px] text-muted-foreground uppercase">Pertinence</span></div>
              </div>
            </div>

            {/* CARTE 2 : INTENSITÉ DU RISK (BLAST RADIUS METIER) */}
            <div className="glass-panel p-6 flex flex-col justify-between border-t-4 border-t-blue-500">
              <div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-blue-500" /> Intensité de l'Attaque
                </span>
                <div className="flex items-baseline gap-2 mt-4">
                  <span className="text-4xl font-black text-foreground">
                    {executiveSummary.totalEvents >= 1000 ? (executiveSummary.totalEvents / 1000).toFixed(1) + "k" : executiveSummary.totalEvents}
                  </span>
                  <span className="text-sm text-muted-foreground">Événements corrélés</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
                <span>Flux réseau : <strong className="text-foreground">{executiveSummary.totalFlows.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* CARTE 3 : EXPOSITION DE L'INFRASTRUCTURE */}
            <div className="glass-panel p-6 flex flex-col justify-between border-t-4 border-t-orange-500">
              <div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-orange-500" /> Périmètre de l'Impact
                </span>
                <div className="flex items-baseline gap-2 mt-4">
                  <span className="text-4xl font-black text-orange-500">{executiveSummary.totalImpactedDevices}</span>
                  <span className="text-sm text-muted-foreground">Équipements touchés</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
                <span>Statut général du parc : <strong className="text-orange-500">Sous surveillance</strong></span>
              </div>
            </div>

          </div>

          {/* SYNTHÈSE EXECUTIVE COMPLÈTE */}
          <div className="glass-panel p-6 border-l-4 border-l-primary bg-primary/5">
            <h3 className="text-base font-bold flex items-center gap-2 mb-6 text-foreground">
              <Lightbulb className="w-5 h-5 text-primary" /> Synthèse d'Aide à la Décision (RSSI / COMEX)
            </h3>
            <div className="space-y-4">
              {executiveSummary.insights.map((insight, idx) => (
                <div key={idx} className="flex items-start gap-4 p-4 bg-background rounded-xl border border-border shadow-sm">
                  {insight.level === 'danger' && <AlertOctagon className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
                  {insight.level === 'warning' && <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />}
                  {insight.level === 'success' && <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />}
                  <p className="text-sm md:text-base text-foreground font-medium leading-relaxed">{insight.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}