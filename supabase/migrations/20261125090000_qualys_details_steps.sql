-- =============================================================================
-- Qualys : finalisation du détail par petits lots
--
-- qualys_finalize_details faisait tout en une requête (indicateurs de menace des
-- ~4 000 actifs, puis suppression du détail de la photo précédente) et dépassait le
-- temps maximal d'une requête. Elle est remplacée par deux fonctions appelées par lots
-- depuis qualys-proxy :
--   - qualys_detail_counts : indicateurs de menace d'une tranche d'actifs ;
--   - qualys_detail_purge  : suppression, par paquets, du détail des autres photos.
--
-- Accès : uniquement par la fonction qualys-proxy (clé service_role).
-- Migration idempotente. À appliquer après 20261124090000_qualys_details.sql.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.qualys_finalize_details(uuid);

CREATE OR REPLACE FUNCTION public.qualys_detail_counts(snap uuid, host_min bigint, host_max bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE qualys_asset_vulns v SET kev = x.kev, ransomware = x.ransomware, armed = x.armed, eol = x.eol
  FROM (
    SELECT v2.host_id,
           count(*) FILTER (WHERE k.flags & 1 > 0)  AS kev,
           count(*) FILTER (WHERE k.flags & 2 > 0)  AS ransomware,
           count(*) FILTER (WHERE k.flags & 27 > 0) AS armed,
           count(*) FILTER (WHERE k.title ~* '^\s*EOL\s*/\s*Obsolete') AS eol
    FROM qualys_asset_vulns v2
    CROSS JOIN LATERAL unnest(v2.qids) AS q(qid)
    JOIN qualys_kb k ON k.qid = q.qid
    WHERE v2.snapshot_id = snap AND v2.host_id BETWEEN host_min AND host_max
    GROUP BY v2.host_id
  ) x
  WHERE v.snapshot_id = snap AND v.host_id = x.host_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Supprime au plus max_rows lignes par table appartenant à une autre photo ; renvoie le nombre supprimé
CREATE OR REPLACE FUNCTION public.qualys_detail_purge(snap uuid, max_rows integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer := 0;
  n integer;
BEGIN
  DELETE FROM qualys_asset_vulns WHERE ctid IN (SELECT ctid FROM qualys_asset_vulns WHERE snapshot_id <> snap LIMIT max_rows);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM qualys_assets WHERE ctid IN (SELECT ctid FROM qualys_assets WHERE snapshot_id <> snap LIMIT max_rows);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM qualys_csam_assets WHERE ctid IN (SELECT ctid FROM qualys_csam_assets WHERE snapshot_id <> snap LIMIT max_rows);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM qualys_was_findings WHERE ctid IN (SELECT ctid FROM qualys_was_findings WHERE snapshot_id <> snap LIMIT max_rows);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM qualys_was_apps WHERE ctid IN (SELECT ctid FROM qualys_was_apps WHERE snapshot_id <> snap LIMIT max_rows);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.qualys_detail_counts(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qualys_detail_purge(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualys_detail_counts(uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.qualys_detail_purge(uuid, integer) TO service_role;

COMMIT;
