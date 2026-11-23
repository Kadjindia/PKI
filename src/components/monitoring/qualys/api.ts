import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Appel de la fonction qualys-proxy (utilisateur connecté). */
export async function callQualys<T>(body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("qualys-proxy", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as T;
}
