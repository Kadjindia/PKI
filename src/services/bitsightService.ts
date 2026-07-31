// On utilise le VRAI chemin de votre projet pour le client Supabase
import { supabase } from "@/integrations/supabase/client";

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
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    console.warn("⚠️ Utilisateur non authentifié. Chargement des données fictives.");
    await new Promise(resolve => setTimeout(resolve, 800));
    return MOCK_DATA;
  }

  // Utilisation de la méthode native Invoke au lieu de fetch
  const { data, error } = await supabase.functions.invoke('bitsight-proxy', {
    method: 'GET',
  });

  if (error) {
    throw new Error(`Erreur appel Edge Function : ${error.message}`);
  }

  return {
    score: data.rating,
    trend: "À calculer",
    status: `${data.finding_count || 0} vulnérabilités`,
    alert: "Données en direct",
    history: []
  };
}