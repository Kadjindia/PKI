-- =============================================================================
-- Posture Varonis : listes de l'inventaire rangées à part
--
-- Les listes détaillées (comptes, propriétaires, groupes des administrateurs)
-- pesaient plusieurs Mo dans la photo (colonne results), relue et réécrite à
-- chaque étape du calcul. Elles sont désormais stockées ici, une ligne par
-- recherche et par liste ; la photo n'en garde qu'une référence.
--
-- Accès : uniquement par la fonction varonis-proxy (clé service_role).
-- Les lignes disparaissent avec leur photo (ON DELETE CASCADE).
-- Migration idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.varonis_posture_lists (
  snapshot_id uuid        NOT NULL REFERENCES public.varonis_posture_snapshots (id) ON DELETE CASCADE,
  key         text        NOT NULL, -- recherche (ex. privileged)
  field       text        NOT NULL, -- liste (ex. items, serviceItems, owners)
  items       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, key, field)
);

ALTER TABLE public.varonis_posture_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.varonis_posture_lists FROM anon, authenticated;

COMMIT;
