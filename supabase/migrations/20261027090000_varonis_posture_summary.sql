-- =============================================================================
-- Posture Varonis : résumé compact de chaque photo, pour l'évolution dans le temps
--
-- La colonne results contient tout le détail (listes de dossiers) : trop lourd
-- pour tracer un historique sur des mois. summary ne garde que les chiffres
-- clés ; elle est remplie par varonis-proxy à la fin de chaque calcul (et
-- calculée après coup pour les photos déjà enregistrées).
-- Migration idempotente.
-- =============================================================================

ALTER TABLE public.varonis_posture_snapshots
  ADD COLUMN IF NOT EXISTS summary jsonb;
