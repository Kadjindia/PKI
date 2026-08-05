import { supabase } from "@/integrations/supabase/client";

export const fetchCortexExecutiveData = async () => {
  const { data: { session } } = await supabase.auth.getSession();

  // Si l'utilisateur n'est pas connecté, on renvoie les données de démonstration
  if (!session) {
    console.warn("⚠️ Utilisateur non authentifié. Chargement des données de présentation.");
    return getMockCortexData();
  }

  try {
    // 1. Récupération des Incidents via l'Edge Function Supabase
    const { error } = await supabase.functions.invoke('cortex-proxy', {
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

    // Le parsing réel des données interviendra ici lorsque l'API sera pleinement branchée

  } catch (error) {
    console.error("Erreur de connexion à l'API Cortex XSIAM via proxy :", error);
  }

  // Retour temporaire du mock en attendant la finalisation du parsing réel
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