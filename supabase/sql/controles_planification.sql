-- =============================================================================
-- Contrôles des calculs de nuit (lecture seule) : à lancer à la main dans l'éditeur
-- SQL de Supabase, requête par requête.
-- =============================================================================

-- Dernières exécutions des tâches planifiées
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- Dernières réponses des appels aux fonctions
SELECT id, status, code, content FROM net._http_response ORDER BY created DESC LIMIT 10;

-- Qualys : derniers calculs et leur avancement
SELECT status, started_at, finished_at, state->>'phase' AS etape, state->>'pages' AS pages, last_error
  FROM public.qualys_snapshots ORDER BY started_at DESC LIMIT 5;

-- Varonis : derniers calculs de la posture
SELECT status, trigger, started_at, finished_at, last_error
  FROM public.varonis_posture_snapshots ORDER BY started_at DESC LIMIT 5;
