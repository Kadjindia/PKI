-- =============================================================================
-- Photos de la posture des données Varonis
--
-- Le calcul de la posture (10 recherches Varonis sur des millions d'objets)
-- prend plusieurs minutes et est soumis à une limite de requêtes. Il est donc
-- fait côté serveur par la fonction varonis-proxy, par petites étapes, et le
-- résultat est enregistré ici. L'écran affiche la dernière photo terminée.
-- Les photos sont conservées : elles serviront à suivre l'évolution dans le temps.
--
-- Écriture : uniquement par la fonction (clé service_role, qui ignore la RLS).
-- Lecture : utilisateurs connectés. Aucun accès pour anon.
-- Migration idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.varonis_posture_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  trigger         text        NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  requested_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  results         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  -- Verrou entre deux étapes de calcul (évite deux étapes simultanées)
  step_lock_until timestamptz NOT NULL DEFAULT 'epoch'
);

CREATE INDEX IF NOT EXISTS varonis_posture_snapshots_started_at_idx
  ON public.varonis_posture_snapshots (status, started_at DESC);

-- Un seul calcul en cours à la fois
CREATE UNIQUE INDEX IF NOT EXISTS varonis_posture_snapshots_one_running_idx
  ON public.varonis_posture_snapshots ((true)) WHERE status = 'running';

ALTER TABLE public.varonis_posture_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.varonis_posture_snapshots FROM anon, authenticated;
GRANT SELECT ON public.varonis_posture_snapshots TO authenticated;

DROP POLICY IF EXISTS "Posture Varonis : lecture (connectés)" ON public.varonis_posture_snapshots;
CREATE POLICY "Posture Varonis : lecture (connectés)" ON public.varonis_posture_snapshots
  FOR SELECT TO authenticated USING (true);

COMMIT;
