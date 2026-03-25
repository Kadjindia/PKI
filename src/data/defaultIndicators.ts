import { KpiDefinition, KpiEntry, DataSourceType, KpiDetailRow } from "@/types/kpi";

export const DEFAULT_KPIS: KpiDefinition[] = [
  { id: "msg-total", name: "Messages reçus (boîte SSI)", category: "messagerie", unit: "nombre", description: "Nombre total de messages reçus sur la boîte SSI" },
  { id: "msg-fraude", name: "Messages fraude", category: "messagerie", unit: "nombre", description: "Messages provenant de la fraude" },
  { id: "msg-1212", name: "Messages 1212", category: "messagerie", unit: "nombre", description: "Messages provenant du 1212" },
  { id: "msg-externe", name: "Messages externes", category: "messagerie", unit: "nombre", description: "Messages provenant de l'extérieur" },
  { id: "msg-erreur", name: "Erreurs d'adressage", category: "messagerie", unit: "nombre", description: "Messages en erreur d'adressage", thresholdWarning: 10, thresholdDanger: 25 },
  { id: "gov-pas", name: "Demandes PAS", category: "gouvernance", unit: "nombre", description: "Plans d'Assurance Sécurité demandés" },
  { id: "gov-politiques", name: "Politiques mises à jour", category: "gouvernance", unit: "nombre", description: "Nombre de politiques de sécurité mises à jour" },
  { id: "gov-pentests", name: "Pentests réalisés", category: "gouvernance", unit: "nombre", description: "Tests d'intrusion réalisés" },
  { id: "sens-phishing", name: "Campagnes faux phishing", category: "sensibilisation", unit: "nombre", description: "Campagnes de simulation phishing" },
  { id: "sens-sessions", name: "Sessions de sensibilisation", category: "sensibilisation", unit: "nombre", description: "Nombre de sensibilisations effectuées" },
  { id: "sens-elearning", name: "Taux e-learning", category: "sensibilisation", unit: "pourcentage", description: "Taux de réalisation des e-learnings", target: 90, thresholdWarning: 70, thresholdDanger: 50 },
  { id: "risk-couverture", name: "Couverture analyse de risques", category: "risques", unit: "pourcentage", description: "Taux de couverture des applications par une analyse de risques", target: 100, thresholdWarning: 60, thresholdDanger: 40 },
  { id: "risk-suivis", name: "Risques cybers suivis", category: "risques", unit: "nombre", description: "Nombre de risques cybers en suivi actif" },
  { id: "cont-msg-pca", name: "Messages boîte PCA", category: "continuite", unit: "nombre", description: "Messages reçus sur la boîte PCA" },
  { id: "cont-exercices", name: "Exercices réalisés", category: "continuite", unit: "nombre", description: "Tabletop et simulations réalisés" },
  { id: "cont-couv-exercices", name: "Couverture exercices", category: "continuite", unit: "pourcentage", description: "Taux de couverture des exercices", target: 80 },
  { id: "cont-couv-bia", name: "Couverture BIA", category: "continuite", unit: "pourcentage", description: "Taux de couverture des BIA", target: 100 },
];

const SOURCE_TYPES: DataSourceType[] = ["manual", "excel", "powerbi", "csv", "api"];

function randomSource(kpiId: string, period: string): { source: KpiEntry["source"]; details: KpiDetailRow[] } {
  const typeIndex = Math.abs(hashCode(kpiId + period)) % SOURCE_TYPES.length;
  const type = SOURCE_TYPES[typeIndex];

  const detailsCount = 3 + (Math.abs(hashCode(kpiId)) % 5);
  const details: KpiDetailRow[] = [];

  if (kpiId.startsWith("msg-")) {
    const senders = ["Direction Générale", "DSI", "DRH", "Fournisseur A", "Partenaire B", "CERT-FR", "ANSSI", "Filiale X"];
    for (let i = 0; i < detailsCount; i++) {
      details.push({
        label: senders[i % senders.length],
        value: Math.round(2 + Math.random() * 20),
        metadata: { date: `${period}-${String(5 + i * 3).padStart(2, "0")}`, type: i % 2 === 0 ? "Incident" : "Information" },
      });
    }
  } else if (kpiId.startsWith("gov-")) {
    const items = ["Application CRM", "Portail Web", "SI Comptable", "App Mobile", "Infra Cloud", "VPN Corp"];
    for (let i = 0; i < detailsCount; i++) {
      details.push({
        label: items[i % items.length],
        value: 1,
        metadata: { statut: i % 3 === 0 ? "Terminé" : i % 3 === 1 ? "En cours" : "Planifié" },
      });
    }
  } else if (kpiId.startsWith("sens-")) {
    const depts = ["Marketing", "Finance", "IT", "RH", "Commercial", "Production", "Juridique"];
    for (let i = 0; i < detailsCount; i++) {
      details.push({
        label: depts[i % depts.length],
        value: Math.round(40 + Math.random() * 55),
        metadata: { participants: String(Math.round(10 + Math.random() * 50)) },
      });
    }
  } else {
    for (let i = 0; i < detailsCount; i++) {
      details.push({
        label: `Élément ${i + 1}`,
        value: Math.round(1 + Math.random() * 15),
      });
    }
  }

  const sourceBase = {
    type,
    label: type === "manual" ? "Saisie manuelle"
      : type === "excel" ? "Rapport_SSI.xlsx"
      : type === "csv" ? "export_kpi.csv"
      : type === "powerbi" ? "Dashboard Sécurité"
      : "API SIEM",
    lastSync: new Date().toISOString(),
  };

  const extra: Record<string, unknown> = {};
  if (type === "excel" || type === "csv") {
    extra.fileName = sourceBase.label;
    extra.rawData = details.map((d, i) => ({
      id: i + 1,
      libellé: d.label,
      valeur: d.value,
      ...(d.metadata || {}),
    }));
    extra.columns = ["id", "libellé", "valeur", ...Object.keys(details[0]?.metadata || {})];
  }
  if (type === "powerbi") {
    extra.embedUrl = "https://app.powerbi.com/view?r=eyJrIjoiZXhhbXBsZSJ9";
    extra.fileUrl = "https://app.powerbi.com/groups/example/reports/example";
  }
  if (type === "api") {
    extra.apiEndpoint = "https://siem.corp.local/api/v1/indicators";
  }

  return {
    source: { ...sourceBase, ...extra } as KpiEntry["source"],
    details,
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

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
      const { source, details } = randomSource(kpi.id, period);
      entries.push({
        id: `${kpi.id}-${period}`,
        kpiId: kpi.id,
        value: Math.round(min + Math.random() * (max - min)),
        period,
        createdAt: new Date().toISOString(),
        source,
        details,
      });
    });
  });

  return entries;
}

export const SAMPLE_ENTRIES = generateSampleData();
