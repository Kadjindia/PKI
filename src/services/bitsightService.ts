// src/services/bitsightService.ts

// Les données fictives qu'on garde sous le coude
const MOCK_DATA = {
  score: 740,
  trend: "+15 pts",
  status: "19 Tiers à risque",
  alert: "Audit fournisseurs requis",
  history: [
    { date: "Jan", score: 710 },
    { date: "Fév", score: 725 },
    { date: "Mar", score: 740 }
  ]
};

export async function fetchBitsightData() {
  const token = import.meta.env.VITE_BITSIGHT_TOKEN;
  const guid = import.meta.env.VITE_BITSIGHT_COMPANY_GUID;

  // S'il n'y a pas de clés API, on renvoie silencieusement la maquette
  if (!token || !guid) {
    console.warn("⚠️ API BitSight non configurée (.env). Chargement des données fictives.");
    // On simule un temps de chargement réseau de 800ms pour l'UX
    await new Promise(resolve => setTimeout(resolve, 800));
    return MOCK_DATA;
  }

  // Si on a les clés, on lance la vraie requête via notre Proxy
  const credentials = btoa(`${token}:`); // Encodage Basic Auth

  const response = await fetch(`/api/bitsight/ratings/v1/companies/${guid}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Erreur API BitSight : ${response.status}`);
  }

  const data = await response.json();

  // On mappe les vraies données de BitSight pour qu'elles collent à ton design
  return {
    score: data.rating,
    trend: "À calculer", // Nécessitera un 2ème appel API pour l'historique plus tard
    status: `${data.finding_count || 0} vulnérabilités`,
    alert: "Données en direct",
    history: []
  };
}