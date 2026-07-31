import { supabase } from "@/integrations/supabase/client";

export const fetchCortexExecutiveData = async () => {
  // Structure exécutive orientée gestion des risques et automatisation
  const executiveData = {
    kpis: {
      totalIncidents: 0,
      criticalIncidents: 0,
      mttd: "N/A", // Mean Time To Detect
      mttr: "N/A", // Mean Time To Respond
      automationRate: 0, // Pourcentage d'incidents gérés par le SOAR
      endpointsMonitored: 0
    },
    incidentsList: [] as any[],
    playbooksStats: [] as any[],
    endpointHealth: {
      connected: 0,
      disconnected: 0,
      vulnerable: 0
    }
  };

  const { data: { session } } = await supabase.auth.getSession();

  // Si l'utilisateur n'est pas connecté, on renvoie les données de démonstration
  if (!session) {
    console.warn("⚠️ Utilisateur non authentifié. Chargement des données de présentation.");
    return getMockCortexData();
  }

  try {
    // 1. Récupération des Incidents via l'Edge Function Supabase (endpoint et payload dans le body)
    const { data, error } = await supabase.functions.invoke('cortex-proxy', {
      method: 'POST',
      body: {
        path: '/public_api/v1/incidents/get_incidents/',
        payload: {
          request_data: {
            search_from: 0,
            search_to: 50,
            sort: { field: "creation_time", keyword: "desc" }
          }
        }
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    // Ici interviendra le parsing réel pour alimenter executiveData.incidentsList
    // if (data?.reply?.incidents) { ... }

    // 2. (Futur) Récupération via XQL pour des métriques avancées
    // const { data: xqlData } = await supabase.functions.invoke('cortex-proxy', { body: { path: '/public_api/v1/xql/start_xql_query/', payload: {...} } });

  } catch (error) {
    console.error("Erreur de connexion à l'API Cortex XSIAM via proxy :", error);
  }

  // Retour temporaire du mock si le parsing réel n'est pas encore finalisé
  return getMockCortexData();
};

// Données mockées pour structurer visuellement le dashboard d'aide à la décision
function getMockCortexData() {
  return {
    kpis: {
      totalIncidents: 142,
      criticalIncidents: 6,
      mttd: "8m",
      mttr: "1.2h",
      automationRate: 68,
      endpointsMonitored: 3850
    },
    incidentsList: [
      {
        id: "INC-9042",
        description: "Exécution de code suspecte (Mimikatz) sur un serveur critique",
        severity: "High",
        status: "Under Investigation",
        assignedTo: "SOC T2",
        creationTime: "Il y a 30 min",
        assets: ["SRV-PROD-01"]
      },
      {
        id: "INC-9041",
        description: "Tentative d'accès par vol d'identifiants (Pass-the-Hash)",
        severity: "High",
        status: "New",
        assignedTo: "Unassigned",
        creationTime: "Il y a 1h",
        assets: ["WKST-FIN-04"]
      },
      {
        id: "INC-9038",
        description: "Comportement anormal détecté (SOAR Auto-containment)",
        severity: "Medium",
        status: "Resolved",
        assignedTo: "Cortex SOAR",
        creationTime: "Il y a 4h",
        assets: ["WKST-HR-12"]
      }
    ],
    playbooksStats: [
      { name: "Phishing Auto-Triage", executions: 340, successRate: 95 },
      { name: "Endpoint Isolation", executions: 12, successRate: 100 },
      { name: "Malware Remediation", executions: 45, successRate: 88 }
    ],
    endpointHealth: {
      connected: 3700,
      disconnected: 120,
      vulnerable: 30
    }
  };
}