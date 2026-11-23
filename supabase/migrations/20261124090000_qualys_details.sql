-- =============================================================================
-- Qualys : détail complet de la dernière photo (inventaires et listes détaillées)
--
-- En plus des chiffres agrégés de chaque photo (qualys_snapshots), le calcul de nuit
-- enregistre désormais le détail, pour que l'écran permette de tout parcourir et filtrer :
--   - qualys_assets        : chaque actif VMDR (nom, IP, système, TruRisk, tags, tous les attributs) ;
--   - qualys_asset_vulns   : les vulnérabilités de chaque actif (QID, sévérité, dates, statut, délai) ;
--   - qualys_kb            : la fiche de chaque vulnérabilité (titre, CVE, CVSS, menaces, produits, solution) ;
--   - qualys_csam_assets   : l'inventaire CSAM (agents, Shadow IT, cycle de vie, matériel) ;
--   - qualys_was_apps      : l'inventaire des applications web ;
--   - qualys_was_findings  : les vulnérabilités applicatives.
-- Seul le détail de la dernière photo terminée est conservé (plus celui du calcul en cours) :
-- le ménage est fait par qualys_finalize_details. qualys_kb est un catalogue partagé, mis à jour
-- à chaque calcul.
--
-- Accès : uniquement par la fonction qualys-proxy (clé service_role).
-- Migration idempotente. À appliquer après 20261120090000_qualys_fixed_daily.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qualys_assets (
  snapshot_id   uuid        NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  host_id       bigint      NOT NULL,
  asset_id      bigint,                 -- identifiant CSAM de l'actif
  name          text,
  netbios       text,
  ip            text,
  os            text,
  asset_type    text        NOT NULL,   -- server | workstation | other
  tracking      text,                   -- AGENT, IP, DNS…
  trurisk       integer,
  criticality   smallint,               -- criticité de l'actif (1 à 5)
  last_scan     timestamptz,
  last_activity timestamptz,
  public_ip     boolean     NOT NULL DEFAULT false,
  tags          text[]      NOT NULL DEFAULT '{}',
  attrs         jsonb       NOT NULL DEFAULT '{}'::jsonb, -- tous les attributs simples renvoyés par Qualys
  PRIMARY KEY (snapshot_id, host_id)
);

CREATE TABLE IF NOT EXISTS public.qualys_asset_vulns (
  snapshot_id uuid     NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  host_id     bigint   NOT NULL,
  d5          integer  NOT NULL DEFAULT 0,
  d4          integer  NOT NULL DEFAULT 0,
  d3          integer  NOT NULL DEFAULT 0,
  overdue     integer  NOT NULL DEFAULT 0,
  ignored     integer  NOT NULL DEFAULT 0,
  reopened    integer  NOT NULL DEFAULT 0,
  qds_max     integer  NOT NULL DEFAULT 0,
  -- Calculés en fin de photo d'après qualys_kb
  kev         integer  NOT NULL DEFAULT 0,
  ransomware  integer  NOT NULL DEFAULT 0,
  armed       integer  NOT NULL DEFAULT 0,
  eol         integer  NOT NULL DEFAULT 0,
  qids        bigint[] NOT NULL DEFAULT '{}',     -- vulnérabilités ouvertes (hors dérogations)
  -- [QID, sévérité, 1re détection, dernière détection, statut N/A/R/I, QDS, dérogation, hors délai, port]
  detections  jsonb    NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (snapshot_id, host_id)
);
CREATE INDEX IF NOT EXISTS qualys_asset_vulns_qids_idx ON public.qualys_asset_vulns USING gin (qids);

CREATE TABLE IF NOT EXISTS public.qualys_kb (
  qid             bigint      PRIMARY KEY,
  severity        smallint,
  title           text        NOT NULL DEFAULT '',
  category        text,
  vuln_type       text,
  cvss3           numeric(3, 1),
  cvss            numeric(3, 1),
  cves            text[]      NOT NULL DEFAULT '{}',
  flags           integer     NOT NULL DEFAULT 0, -- 1 CISA KEV, 2 ransomware, 4 correctif, 8 attaques actives, 16 exploit public
  threats         text[]      NOT NULL DEFAULT '{}',
  products        jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [[éditeur, produit], …]
  solution        text,
  consequence     text,
  diagnosis       text,
  published       timestamptz,
  patch_published timestamptz,
  vendor_refs     text[]      NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qualys_csam_assets (
  snapshot_id        uuid        NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  asset_id           bigint      NOT NULL,
  host_id            bigint,
  name               text,
  ip                 text,
  os                 text,
  asset_type         text        NOT NULL,
  has_agent          boolean     NOT NULL DEFAULT false,
  has_scanner        boolean     NOT NULL DEFAULT false,
  agent_last_checkin timestamptz,
  lifecycle_stage    text,
  eos                timestamptz,
  eol                timestamptz,
  created            timestamptz,
  last_seen          timestamptz,
  sources            text,
  hardware           text,
  criticality        smallint,
  tags               text[]      NOT NULL DEFAULT '{}',
  attrs              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, asset_id)
);

CREATE TABLE IF NOT EXISTS public.qualys_was_apps (
  snapshot_id uuid        NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  app_id      bigint      NOT NULL,
  name        text,
  url         text,
  tags        text[]      NOT NULL DEFAULT '{}',
  created     timestamptz,
  last_scan   timestamptz,
  attrs       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, app_id)
);

CREATE TABLE IF NOT EXISTS public.qualys_was_findings (
  snapshot_id    uuid        NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  finding_id     bigint      NOT NULL,
  app_id         bigint,
  app_name       text,
  qid            bigint,
  title          text,
  severity       smallint,
  status         text,
  owasp          text,
  url            text,
  first_detected timestamptz,
  last_detected  timestamptz,
  last_tested    timestamptz,
  fixed_date     timestamptz,
  times_detected integer,
  potential      boolean     NOT NULL DEFAULT false,
  ignored        boolean     NOT NULL DEFAULT false,
  overdue        boolean     NOT NULL DEFAULT false,
  attrs          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, finding_id)
);

ALTER TABLE public.qualys_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_asset_vulns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_kb           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_csam_assets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_was_apps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualys_was_findings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qualys_assets, public.qualys_asset_vulns, public.qualys_kb, public.qualys_csam_assets,
              public.qualys_was_apps, public.qualys_was_findings FROM anon, authenticated;

-- Fin de photo : indicateurs de menace par actif (d'après la base de connaissances), puis
-- ménage du détail des photos précédentes.
CREATE OR REPLACE FUNCTION public.qualys_finalize_details(snap uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE v2.snapshot_id = snap
    GROUP BY v2.host_id
  ) x
  WHERE v.snapshot_id = snap AND v.host_id = x.host_id;

  DELETE FROM qualys_assets       WHERE snapshot_id <> snap;
  DELETE FROM qualys_asset_vulns  WHERE snapshot_id <> snap;
  DELETE FROM qualys_csam_assets  WHERE snapshot_id <> snap;
  DELETE FROM qualys_was_apps     WHERE snapshot_id <> snap;
  DELETE FROM qualys_was_findings WHERE snapshot_id <> snap;
END;
$$;

REVOKE ALL ON FUNCTION public.qualys_finalize_details(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualys_finalize_details(uuid) TO service_role;

-- Actifs touchés par une vulnérabilité, avec le détail de la détection (écran : fiche vulnérabilité)
CREATE OR REPLACE FUNCTION public.qualys_vuln_hosts(snap uuid, vuln bigint)
RETURNS TABLE (host_id bigint, detection jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.host_id, d
  FROM qualys_asset_vulns v
  CROSS JOIN LATERAL jsonb_array_elements(v.detections) AS d
  WHERE v.snapshot_id = snap
    AND (v.qids @> ARRAY[vuln] OR (v.ignored > 0 AND v.detections @> jsonb_build_array(jsonb_build_array(vuln))))
    AND (d->>0)::bigint = vuln;
$$;

REVOKE ALL ON FUNCTION public.qualys_vuln_hosts(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualys_vuln_hosts(uuid, bigint) TO service_role;

COMMIT;
