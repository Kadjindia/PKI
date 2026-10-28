-- =============================================================================
-- Planification du calcul de la posture Varonis (à exécuter une fois, dans
-- l'éditeur SQL de Supabase, APRÈS la migration varonis_posture_snapshots et
-- le déploiement de la fonction varonis-proxy).
--
-- Deux tâches pg_cron appellent la fonction via pg_net :
--   * chaque nuit à 4 h 00 UTC : démarre une nouvelle photo ;
--   * toutes les 2 minutes : fait avancer la photo en cours, et renouvelle le
--     cache des alertes quand il a plus de 15 minutes (sinon, simple accès à la
--     base, aucun appel à Varonis).
--
-- Prérequis :
--   1. Extensions pg_cron et pg_net activées (Database > Extensions) ;
--   2. Secret POSTURE_CRON_SECRET ajouté aux secrets des Edge Functions
--      (valeur aléatoire longue, ex. : openssl rand -hex 32), puis fonction
--      redémarrée / redéployée ;
--   3. Remplacer les trois valeurs <...> ci-dessous. Elles sont rangées dans le
--      coffre (Vault) de Supabase, pas en clair dans les tâches.
--
-- URL de la fonction :
--   * Supabase Cloud     : https://<ref-du-projet>.supabase.co/functions/v1/varonis-proxy
--   * Supabase auto-hébergé (docker) : http://kong:8000/functions/v1/varonis-proxy
--     (adresse vue depuis le conteneur de la base ; à confirmer par la DSI)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Secrets (à exécuter une seule fois ; pour changer une valeur : vault.update_secret)
SELECT vault.create_secret('<URL de la fonction varonis-proxy>', 'varonis_posture_url');
SELECT vault.create_secret('<clé anon du projet>', 'varonis_posture_anon_key');
SELECT vault.create_secret('<même valeur que POSTURE_CRON_SECRET>', 'varonis_posture_cron_secret');

-- Appel de la fonction avec les secrets du coffre
CREATE OR REPLACE FUNCTION public.call_varonis_posture(start_new boolean)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'varonis_posture_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'varonis_posture_anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'varonis_posture_cron_secret')
    ),
    body    := jsonb_build_object('action', 'posture-cron', 'start', start_new),
    timeout_milliseconds := 120000
  );
$$;
REVOKE ALL ON FUNCTION public.call_varonis_posture(boolean) FROM PUBLIC, anon, authenticated;

-- Tâches planifiées (cron.schedule remplace une tâche existante du même nom)
SELECT cron.schedule('varonis-posture-nuit',   '0 4 * * *',   $$ SELECT public.call_varonis_posture(true) $$);
SELECT cron.schedule('varonis-posture-avance', '*/2 * * * *', $$ SELECT public.call_varonis_posture(false) $$);

-- Vérifications utiles :
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT id, status, code, content FROM net._http_response ORDER BY created DESC LIMIT 10;
--   SELECT status, trigger, started_at, finished_at, last_error FROM public.varonis_posture_snapshots ORDER BY started_at DESC LIMIT 5;
-- Lancer un calcul tout de suite : SELECT public.call_varonis_posture(true);
