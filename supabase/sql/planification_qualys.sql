-- =============================================================================
-- Planification du calcul Qualys (à exécuter une fois, dans l'éditeur SQL de
-- Supabase, APRÈS la migration qualys_snapshots et le déploiement de la
-- fonction qualys-proxy).
--
-- Deux tâches pg_cron appellent la fonction via pg_net :
--   * chaque nuit à 1 h 00 UTC : démarre une nouvelle photo ;
--   * toutes les 2 minutes : fait avancer la photo en cours (rien à faire = un
--     simple accès à la base, aucun appel à Qualys).
--
-- Réutilise la clé anon et le secret POSTURE_CRON_SECRET déjà rangés dans le
-- coffre pour Varonis (planification_posture_varonis.sql). Seule l'URL de la
-- fonction est à renseigner ci-dessous :
--   * Supabase Cloud     : https://<ref-du-projet>.supabase.co/functions/v1/qualys-proxy
--   * Supabase auto-hébergé (docker) : http://kong:8000/functions/v1/qualys-proxy
-- =============================================================================

SELECT vault.create_secret('<URL de la fonction qualys-proxy>', 'qualys_proxy_url');

CREATE OR REPLACE FUNCTION public.call_qualys(start_new boolean)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'qualys_proxy_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'varonis_posture_anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'varonis_posture_cron_secret')
    ),
    body    := jsonb_build_object('action', 'cron', 'start', start_new),
    timeout_milliseconds := 120000
  );
$$;
REVOKE ALL ON FUNCTION public.call_qualys(boolean) FROM PUBLIC, anon, authenticated;

-- Calcul complet en 4 à 5 h : démarré à 20 h UTC (21 h à Paris l'hiver), fini avant l'arrivée des équipes
SELECT cron.schedule('qualys-nuit',   '0 20 * * *',  $$ SELECT public.call_qualys(true) $$);
SELECT cron.schedule('qualys-avance', '*/2 * * * *', $$ SELECT public.call_qualys(false) $$);

-- Vérifications : voir controles_planification.sql.
-- Lancer un calcul tout de suite : appeler la fonction public.call_qualys avec le paramètre true.
