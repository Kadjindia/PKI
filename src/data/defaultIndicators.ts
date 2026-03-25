import { KpiDefinition, KpiEntry } from "@/types/kpi";

export const DEFAULT_KPIS: KpiDefinition[] = [
  // Messagerie SSI
  { id: "msg-total", name: "Messages reçus (boîte SSI)", category: "messagerie", unit: "nombre", description: "Nombre total de messages reçus sur la boîte SSI" },
  { id: "msg-fraude", name: "Messages fraude", category: "messagerie", unit: "nombre", description: "Messages provenant de la fraude" },
  { id: "msg-1212", name: "Messages 1212", category: "messagerie", unit: "nombre", description: "Messages provenant du 1212" },
  { id: "msg-externe", name: "Messages externes", category: "messagerie", unit: "nombre", description: "Messages provenant de l'extérieur" },
  { id: "msg-erreur", name: "Erreurs d'adressage", category: "messagerie", unit: "nombre", description: "Messages en erreur d'adressage", thresholdWarning: 10, thresholdDanger: 25 },
  // Gouvernance
  { id: "gov-pas", name: "Demandes PAS", category: "gouvernance", unit: "nombre", description: "Plans d'Assurance Sécurité demandés" },
  { id: "gov-politiques", name: "Politiques mises à jour", category: "gouvernance", unit: "nombre", description: "Nombre de politiques de sécurité mises à jour" },
  { id: "gov-pentests", name: "Pentests réalisés", category: "gouvernance", unit: "nombre", description: "Tests d'intrusion réalisés" },
  // Sensibilisation
  { id: "sens-phishing", name: "Campagnes faux phishing", category: "sensibilisation", unit: "nombre", description: "Campagnes de simulation phishing" },
  { id: "sens-sessions", name: "Sessions de sensibilisation", category: "sensibilisation", unit: "nombre", description: "Nombre de sensibilisations effectuées" },
  { id: "sens-elearning", name: "Taux e-learning", category: "sensibilisation", unit: "pourcentage", description: "Taux de réalisation des e-learnings", target: 90, thresholdWarning: 70, thresholdDanger: 50 },
  // Risques
  { id: "risk-couverture", name: "Couverture analyse de risques", category: "risques", unit: "pourcentage", description: "Taux de couverture des applications par une analyse de risques", target: 100, thresholdWarning: 60, thresholdDanger: 40 },
  { id: "risk-suivis", name: "Risques cybers suivis", category: "risques", unit: "nombre", description: "Nombre de risques cybers en suivi actif" },
  // Continuité
  { id: "cont-msg-pca", name: "Messages boîte PCA", category: "continuite", unit: "nombre", description: "Messages reçus sur la boîte PCA" },
  { id: "cont-exercices", name: "Exercices réalisés", category: "continuite", unit: "nombre", description: "Tabletop et simulations réalisés" },
  { id: "cont-couv-exercices", name: "Couverture exercices", category: "continuite", unit: "pourcentage", description: "Taux de couverture des exercices", target: 80 },
  { id: "cont-couv-bia", name: "Couverture BIA", category: "continuite", unit: "pourcentage", description: "Taux de couverture des BIA", target: 100 },
];

function generateSampleData(): KpiEntry[] {
  const entries: KpiEntry[] = [];
  const months = ["2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"];

  const ranges: Record<string, [number, number]> = {
    "msg-total": [80, 150], "msg-fraude": [10, 40], "msg-1212": [5, 20],
    "msg-externe": [20, 60], "msg-erreur": [2, 15], "gov-pas": [3, 12],
    "gov-politiques": [1, 5], "gov-pentests": [0, 3], "sens-phishing": [0, 2],
    "sens-sessions": [1, 6], "sens-elearning": [55, 88], "risk-couverture": [40, 72],
    "risk-suivis": [15, 35], "cont-msg-pca": [5, 25], "cont-exercices": [0, 3],
    "cont-couv-exercices": [30, 65], "cont-couv-bia": [50, 80],
  };

  months.forEach((period) => {
    DEFAULT_KPIS.forEach((kpi) => {
      const [min, max] = ranges[kpi.id] || [0, 50];
      entries.push({
        id: `${kpi.id}-${period}`,
        kpiId: kpi.id,
        value: Math.round(min + Math.random() * (max - min)),
        period,
        createdAt: new Date().toISOString(),
      });
    });
  });

  return entries;
}

export const SAMPLE_ENTRIES = generateSampleData();
