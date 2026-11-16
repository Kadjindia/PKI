-- =============================================================================
-- Qualys VMDR : photos des vulnérabilités, calculées chaque nuit
--
-- Qualys met environ 1 min 30 à préparer chaque page de résultats (100 actifs,
-- ~10 Mo), au-delà de ce qu'une fonction Supabase peut attendre sereinement.
-- La base fait donc elle-même l'appel (pg_net, sans limite de 150 s) ; la
-- fonction qualys-proxy lit la réponse, en extrait les chiffres de la page
-- (qualys_pages) et, à la fin, enregistre une photo (qualys_snapshots).
-- Les détections brutes ne sont jamais conservées.
--
-- Accès : uniquement par la fonction qualys-proxy (clé service_role).
-- Migration idempotente.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.qualys_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  state           jsonb       NOT NULL DEFAULT '{}'::jsonb, -- avancement du calcul
  results         jsonb,                                     -- photo terminée
  summary         jsonb,                                     -- chiffres clés, pour l'évolution
  last_error      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  step_lock_until timestamptz NOT NULL DEFAULT 'epoch'      -- une seule étape à la fois
);

CREATE INDEX IF NOT EXISTS qualys_snapshots_started_at_idx ON public.qualys_snapshots (status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS qualys_snapshots_one_running_idx ON public.qualys_snapshots ((true)) WHERE status = 'running';

-- Chiffres extraits de chaque page de résultats, le temps du calcul
CREATE TABLE IF NOT EXISTS public.qualys_pages (
  snapshot_id uuid    NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  kind        text    NOT NULL, -- hosts | detections | kb
  page        integer NOT NULL,
  agg         jsonb   NOT NULL,
  PRIMARY KEY (snapshot_id, kind, page)
);

ALTER TABLE public.qualys_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qualys_snapshots FROM anon, authenticated;
REVOKE ALL ON public.qualys_pages FROM anon, authenticated;

-- Appel à Qualys par la base (pg_net) : la réponse arrive dans net._http_response
CREATE OR REPLACE FUNCTION public.qualys_http_get(url text, auth text, timeout_ms integer)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT net.http_get(
    url := url,
    headers := jsonb_build_object('Authorization', auth, 'X-Requested-With', 'pki-dashboard'),
    timeout_milliseconds := timeout_ms
  );
$$;

-- Réponse reçue (aucune ligne tant que Qualys n'a pas répondu)
CREATE OR REPLACE FUNCTION public.qualys_http_response(request_id bigint)
RETURNS TABLE (status_code integer, content text, timed_out boolean, error_msg text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT r.status_code, r.content, r.timed_out, r.error_msg FROM net._http_response r WHERE r.id = request_id;
$$;

-- Réponse traitée : supprimée aussitôt (jusqu'à 15 Mo par page)
CREATE OR REPLACE FUNCTION public.qualys_http_forget(request_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM net._http_response WHERE id = request_id;
$$;

REVOKE ALL ON FUNCTION public.qualys_http_get(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qualys_http_response(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qualys_http_forget(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualys_http_get(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.qualys_http_response(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.qualys_http_forget(bigint) TO service_role;

COMMIT;
