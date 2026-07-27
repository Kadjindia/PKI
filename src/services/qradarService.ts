// src/services/qradarService.ts

export const fetchQradarExecutiveData = async () => {
  const apiUrl = import.meta.env.VITE_QRADAR_API_URL;
  const token = import.meta.env.VITE_QRADAR_SEC_TOKEN;

  // Structure de base alignée sur les besoins de ton tableau de bord
  const executiveData = {
    kpis: {
      mttd: "N/A", mttr: "N/A", mttrTrend: "0m",
      falsePositiveRate: 0, epsAvg: "0", epsPeak: "0",
      logsVolume: "0 TB", activeCriticalOffenses: 0, totalOffenses30d: 0
    },
    trends: {
      offensesOverTime: [],
      resolutionFunnel: []
    },
    priorityOffenses: [],
    mitreHeatmap: [],
    logSources: [],
    topRules: [],
    segments: []
  };

  if (!apiUrl || !token) {
    console.warn("⚠️ Configuration QRadar manquante. Retour des données par défaut.");
    // Ici, on pourrait retourner tes données mockées actuelles le temps du dev
    return getMockQradarData();
  }

  const headers = {
    'SEC': token,
    'Accept': 'application/json',
    'Version': '19.0' // À adapter selon la version de ton QRadar
  };

  try {
    // Exemple d'appel 1 : Récupérer les offenses critiques actives
    /*
    const offensesResponse = await fetch(`${apiUrl}/siem/offenses?filter=severity>=8 and status="OPEN"`, { headers });
    if (offensesResponse.ok) {
      const offenses = await offensesResponse.json();
      executiveData.kpis.activeCriticalOffenses = offenses.length;
      // Parsing des offenses pour remplir executiveData.priorityOffenses...
    }
    */

    // Exemple d'appel 2 : Lancer une requête AQL pour récupérer l'EPS moyen ou les stats MITRE
    /*
    const aqlQuery = "SELECT INCIDENT_COUNT(), CATEGORYNAME(category) FROM events LAST 30 DAYS";
    // ... Logique d'exécution AQL ...
    */

  } catch (error) {
    console.error("Erreur lors de la communication avec l'API QRadar :", error);
  }

  return executiveData;
};

// Fonction temporaire pour garder ton visuel intact pendant qu'on câble l'API
function getMockQradarData() {
  return {
    kpis: {
      mttd: "14m", mttr: "2.5h", mttrTrend: "-15m",
      falsePositiveRate: 18, epsAvg: "14 500", epsPeak: "22 400",
      logsVolume: "4.5 TB / jour", activeCriticalOffenses: 34, totalOffenses30d: 1749
    },
    trends: {
      offensesOverTime: [
        { day: '01', alerts: 120, critical: 1 }, { day: '05', alerts: 250, critical: 5 },
        { day: '10', alerts: 180, critical: 2 }, { day: '15', alerts: 450, critical: 12 },
        { day: '20', alerts: 200, critical: 3 }, { day: '25', alerts: 300, critical: 8 },
        { day: '30', alerts: 150, critical: 3 }
      ],
      resolutionFunnel: [
        { step: 'Alertes Brutes', value: 850000 },
        { step: 'Événements Corrélés', value: 45000 },
        { step: 'Offenses Générées', value: 1749 },
        { step: 'Escalades N2/N3', value: 145 },
        { step: 'Incidents Majeurs', value: 34 }
      ]
    },
    priorityOffenses: [
      { id: "OFF-10452", description: "Mouvement Latéral Improbable (AD)", magnitude: 8, source: "10.50.2.14", target: "10.10.1.5 (SRV-DB)", status: "Assigné (SOC N2)", time: "Il y a 2h" },
      { id: "OFF-10453", description: "Exfiltration massive suspectée vers IP Tor", magnitude: 9, source: "10.50.3.88", target: "185.20.3.4", status: "Investigation", time: "Il y a 4h" },
      { id: "OFF-10454", description: "Multiples échecs d'auth. VPN (Brute Force)", magnitude: 7, source: "89.123.45.6", target: "VPN Gateway", status: "Nouveau", time: "Il y a 30m" }
    ],
    mitreHeatmap: [
      { tactic: "Initial Access", score: 85, color: "bg-destructive" },
      { tactic: "Execution", score: 40, color: "bg-orange-500" },
      { tactic: "Persistence", score: 20, color: "bg-yellow-500" },
      { tactic: "Privilege Esc.", score: 60, color: "bg-orange-500" },
      { tactic: "Defense Evasion", score: 30, color: "bg-yellow-500" },
      { tactic: "Credential Access", score: 95, color: "bg-destructive" },
      { tactic: "Discovery", score: 50, color: "bg-orange-500" },
      { tactic: "Lateral Movement", score: 75, color: "bg-destructive" },
      { tactic: "Collection", score: 15, color: "bg-emerald-500" },
      { tactic: "Exfiltration", score: 25, color: "bg-yellow-500" }
    ],
    logSources: [
      { type: "Firewalls (Palo Alto)", count: 12, eps: "8 500", volume: "2.1 TB", status: "100% (Sain)" },
      { type: "Active Directory (DCs)", count: 4, eps: "3 200", volume: "850 GB", status: "100% (Sain)" },
      { type: "EDR (Trend Micro)", count: 4000, eps: "1 500", volume: "450 GB", status: "100% (Sain)" },
      { type: "Serveurs Linux (DMZ)", count: 145, eps: "300", volume: "85 GB", status: "Angle mort (60%)" },
      { type: "Applications Métier", count: 8, eps: "1000", volume: "1.0 TB", status: "Erreurs de parsing" }
    ],
    topRules: [
      { name: "Multiples échecs d'authentification suivis d'un succès", category: "Credential Access", count: 450, fpRate: "25%" },
      { name: "Connexion VPN depuis une IP géolocalisée à risque", category: "Initial Access", count: 320, fpRate: "5%" },
      { name: "Exécution de PowerShell encodé", category: "Execution", count: 145, fpRate: "12%" },
      { name: "Découverte de réseau / Scan de ports", category: "Discovery", count: 85, fpRate: "45%" }
    ],
    segments: [
      { name: "LAN Utilisateurs (VLAN 10-50)", alerts: 1050, critical: 12, risk: "Moyen", trend: "Stable" },
      { name: "DMZ Web (VLAN 100)", alerts: 420, critical: 18, risk: "Élevé", trend: "En hausse" },
      { name: "Datacenter Core (VLAN 200)", alerts: 145, critical: 4, risk: "Moyen", trend: "En baisse" },
      { name: "Réseau Invités", alerts: 134, critical: 0, risk: "Faible", trend: "Stable" }
    ]
  };
}