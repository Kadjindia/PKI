-- =============================================================================
-- Qualys VMDR : vulnérabilités corrigées, cumulées jour par jour
--
-- Au lieu de relire chaque nuit 90 jours de vulnérabilités corrigées (~40 pages,
-- plusieurs heures), le calcul ne lit que celles corrigées depuis le calcul
-- précédent (curseur) et les ajoute ici, agrégées par jour de correction,
-- sévérité et type d'actif. Respect des délais et MTTR sont calculés à partir de
-- cette table (90 derniers jours, et 12 mois pour l'évolution mensuelle).
-- Aucune donnée nominative : uniquement des compteurs.
--
-- Accès : uniquement par la fonction qualys-proxy (clé service_role).
-- Migration idempotente. À appliquer après 20261119090000_qualys_vuln_index.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qualys_fixed_daily (
  day        date     NOT NULL,             -- jour de la correction constatée par Qualys
  severity   smallint NOT NULL,             -- 3, 4 ou 5
  asset_type text     NOT NULL,             -- server | workstation | other
  n          integer  NOT NULL DEFAULT 0,   -- vulnérabilités corrigées
  in_sla     integer  NOT NULL DEFAULT 0,   -- dont dans le délai de la politique
  days_sum   bigint   NOT NULL DEFAULT 0,   -- somme des délais de correction (jours)
  hist       jsonb    NOT NULL DEFAULT '{}'::jsonb, -- délai (jours, plafonné à 365) -> nombre
  PRIMARY KEY (day, severity, asset_type)
);

-- Curseur de lecture et garde contre une double prise en compte
CREATE TABLE IF NOT EXISTS public.qualys_meta (
  key   text  PRIMARY KEY,
  value jsonb NOT NULL
);

ALTER TABLE public.qualys_fixed_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qualys_fixed_daily FROM anon, authenticated;
REVOKE ALL ON public.qualys_meta FROM anon, authenticated;

-- Ajout des corrections d'une photo et avancement du curseur, en une seule transaction.
-- Idempotent par photo : rejouer l'étape finale d'une même photo ne compte rien deux fois.
CREATE OR REPLACE FUNCTION public.qualys_merge_fixed(snapshot uuid, rows jsonb, new_cursor timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
BEGIN
  IF (SELECT value #>> '{}' FROM qualys_meta WHERE key = 'fixed_merged_snapshot') = snapshot::text THEN
    RETURN;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(rows, '[]'::jsonb)) LOOP
    INSERT INTO qualys_fixed_daily AS t (day, severity, asset_type, n, in_sla, days_sum, hist)
    VALUES ((r->>'day')::date, (r->>'severity')::smallint, r->>'asset_type',
            (r->>'n')::integer, (r->>'in_sla')::integer, (r->>'days_sum')::bigint, coalesce(r->'hist', '{}'::jsonb))
    ON CONFLICT (day, severity, asset_type) DO UPDATE SET
      n        = t.n + excluded.n,
      in_sla   = t.in_sla + excluded.in_sla,
      days_sum = t.days_sum + excluded.days_sum,
      hist     = (
        SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
        FROM (
          SELECT k, sum(v::bigint) AS v
          FROM (
            SELECT key AS k, value AS v FROM jsonb_each_text(t.hist)
            UNION ALL
            SELECT key, value FROM jsonb_each_text(excluded.hist)
          ) x
          GROUP BY k
        ) y
      );
  END LOOP;
  INSERT INTO qualys_meta (key, value) VALUES ('fixed_cursor', to_jsonb(new_cursor))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  INSERT INTO qualys_meta (key, value) VALUES ('fixed_merged_snapshot', to_jsonb(snapshot::text))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  -- Un peu plus d'un an d'historique suffit (évolution sur 12 mois)
  DELETE FROM qualys_fixed_daily WHERE day < current_date - 400;
END;
$$;

REVOKE ALL ON FUNCTION public.qualys_merge_fixed(uuid, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualys_merge_fixed(uuid, jsonb, timestamptz) TO service_role;

COMMIT;
