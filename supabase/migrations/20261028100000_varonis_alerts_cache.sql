-- =============================================================================
-- Alertes Varonis : cache côté serveur
--
-- La préparation des alertes par Varonis prend une à plusieurs minutes. La
-- fonction varonis-proxy garde ici le dernier résultat (une seule ligne) et le
-- renouvelle en arrière-plan : l'onglet Alertes s'affiche tout de suite.
--
-- Accès : uniquement par la fonction varonis-proxy (clé service_role).
-- Migration idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.varonis_alerts_cache (
  id             smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  alerts         jsonb,                 -- dernier résultat complet
  fetched_at     timestamptz,           -- date de ce résultat
  partial        boolean     NOT NULL DEFAULT false,
  job_id         text,                  -- job Varonis en cours de préparation
  job_started_at timestamptz,
  job_progress   numeric,
  last_error     text                   -- échec du dernier renouvellement
);

ALTER TABLE public.varonis_alerts_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.varonis_alerts_cache FROM anon, authenticated;

COMMIT;
