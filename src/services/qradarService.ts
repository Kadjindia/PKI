import { supabase } from "@/integrations/supabase/client";

/**
 * Fonction générique pour appeler l'API QRadar via l'Edge Function Supabase
 * @param path Le chemin de l'API QRadar (ex: '/siem/offenses')
 * @param method 'GET' | 'POST' | 'PUT' | 'DELETE'
 * @param queryParams Paramètres de recherche optionnels (ex: { range: '0-9' })
 * @param payload Corps de la requête pour les POST/PUT
 */
export async function callQradarApi(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', queryParams?: Record<string, any>, payload?: any) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    console.warn("⚠️ Utilisateur non authentifié pour QRadar.");
    throw new Error("Non authentifié");
  }

  const { data, error } = await supabase.functions.invoke('qradar-proxy', {
    method: 'POST',
    body: {
      path,
      method,
      queryParams,
      payload
    }
  });

  if (error) {
    console.error("Erreur QRadar Proxy:", error.message);
    throw new Error(`Erreur appel QRadar : ${error.message}`);
  }

  return data;
}