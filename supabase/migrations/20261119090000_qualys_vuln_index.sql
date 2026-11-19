-- =============================================================================
-- Qualys VMDR : index des vulnérabilités ouvertes de chaque photo
--
-- Une ligne par vulnérabilité (QID) et par photo : nombre d'actifs touchés, dont
-- serveurs, hors délai, titre, CVE et indicateurs de menace. Sert à la recherche
-- d'exposition (« sommes-nous touchés par telle CVE ? ») et à suivre, photo après
-- photo, l'avancement de sa correction. Aucun nom de machine n'y est stocké.
-- Les index des 60 dernières photos sont conservés (ménage fait par qualys-proxy).
--
-- Accès : uniquement par la fonction qualys-proxy (clé service_role).
-- Migration idempotente. À appliquer après 20261116090000_qualys_snapshots.sql.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qualys_vulns (
  snapshot_id uuid        NOT NULL REFERENCES public.qualys_snapshots (id) ON DELETE CASCADE,
  qid         bigint      NOT NULL,
  severity    smallint    NOT NULL,
  hosts       integer     NOT NULL, -- actifs touchés
  servers     integer     NOT NULL DEFAULT 0, -- dont serveurs
  overdue     integer     NOT NULL DEFAULT 0, -- détections hors délai
  first_found timestamptz,
  title       text,
  cves        text,
  flags       integer     NOT NULL DEFAULT 0, -- 1 CISA KEV, 2 ransomware, 4 correctif, 8 attaques actives, 16 exploit public
  PRIMARY KEY (snapshot_id, qid)
);

CREATE INDEX IF NOT EXISTS qualys_vulns_qid_idx ON public.qualys_vulns (qid);

ALTER TABLE public.qualys_vulns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qualys_vulns FROM anon, authenticated;

COMMIT;
