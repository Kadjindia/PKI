import { supabase } from '@/integrations/supabase/client';
import { getCSRFToken } from '@/utils/csrf';

/**
 * Exécute une fonction distante (RPC) sur Supabase avec un token CSRF
 * @param rpcName Le nom de la fonction stockée (RPC)
 * @param params Les paramètres à envoyer à la fonction
 * @returns Les données retournées par la fonction
 */
export const secureFetch = async <T = any>(
  rpcName: string, 
  params: Record<string, any> = {}
): Promise<T> => {
  const csrfToken = getCSRFToken();

  const { data, error } = await supabase.rpc(rpcName, {
    ...params,
    p_csrf_token: csrfToken
  });

  if (error) throw error;

  return data as T;
};