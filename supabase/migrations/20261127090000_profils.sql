-- =============================================================================
-- Profils d'accès
--
--   rssi  : tout voir, tout modifier, gérer les profils des utilisateurs
--   ssi   : tout voir, en lecture seule (équipe SSI)
--   dsi   : tableaux de bord des outils intégrés (Monitoring SI) et rapports,
--           en lecture seule
--   audit : tout sauf les tableaux de bord des outils et les rapports,
--           en lecture seule (audit interne)
--   NULL  : profil en attente d'attribution, aucun accès aux données
--
-- Le profil est la colonne users.role, modifiable seulement par un RSSI (fonction
-- admin_set_role). Les droits sont vérifiés par la base (RLS) et par les fonctions
-- serveur (app_role), pas seulement par l'écran.
--
-- Les comptes existants gardent l'accès complet qu'ils avaient (profil rssi) :
-- le RSSI ajuste ensuite chaque profil depuis Paramètres > Utilisateurs.
--
-- Migration idempotente : elle peut être rejouée sans erreur.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Colonne role : valeurs autorisées, comptes existants, nouveaux comptes
-- -----------------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- Comptes existants (valeur par défaut « saisisseur » jusqu'ici, sans effet) : accès complet conservé
UPDATE public.users SET role = 'rssi' WHERE role IS NULL OR role NOT IN ('rssi', 'ssi', 'dsi', 'audit');

ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IS NULL OR role IN ('rssi', 'ssi', 'dsi', 'audit'));

-- -----------------------------------------------------------------------------
-- 2. Profil de l'utilisateur connecté et droits qui en découlent
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT role FROM public.users WHERE id = (SELECT auth.uid());
$$;

-- Données SSI (indicateurs, politiques, risques, sensibilisation…)
CREATE OR REPLACE FUNCTION public.can_read_ssi()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(public.app_role() IN ('rssi', 'ssi', 'audit'), false); $$;

-- Tableaux de bord des outils intégrés et rapports
CREATE OR REPLACE FUNCTION public.can_read_tools()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(public.app_role() IN ('rssi', 'ssi', 'dsi'), false); $$;

-- Modifications et gestion des profils
CREATE OR REPLACE FUNCTION public.can_edit()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(public.app_role() = 'rssi', false); $$;

REVOKE EXECUTE ON FUNCTION public.app_role(), public.can_read_ssi(), public.can_read_tools(), public.can_edit() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.app_role(), public.can_read_ssi(), public.can_read_tools(), public.can_edit() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Tables métier : lecture selon le profil, modification par le RSSI seulement
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t   text;
  pol record;
  tables_metier CONSTANT text[] := ARRAY[
    'applications', 'elearning_modules', 'kpi_definitions', 'kpi_entries',
    'phishing_campaigns', 'phishing_profiles', 'policies', 'policy_gaps',
    'projects', 'risk_dashboards', 'vulnerabilities'
  ];
BEGIN
  FOREACH t IN ARRAY tables_metier LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Table public.% absente, ignorée', t;
      CONTINUE;
    END IF;
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Lecture selon le profil" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.can_read_ssi()))', t);
    EXECUTE format('CREATE POLICY "Ajout par le RSSI" ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_edit()))', t);
    EXECUTE format('CREATE POLICY "Modification par le RSSI" ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_edit())) WITH CHECK ((SELECT public.can_edit()))', t);
    EXECUTE format('CREATE POLICY "Suppression par le RSSI" ON public.%I FOR DELETE TO authenticated USING ((SELECT public.can_edit()))', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Fichiers des indicateurs (bucket kpi-files)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Fichiers KPI : lecture (connectés)"     ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : envoi (connectés)"       ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : suppression (connectés)" ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : lecture selon le profil" ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : envoi par le RSSI"       ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : suppression par le RSSI" ON storage.objects;

CREATE POLICY "Fichiers KPI : lecture selon le profil" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'kpi-files' AND (SELECT public.can_read_ssi()));
CREATE POLICY "Fichiers KPI : envoi par le RSSI" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kpi-files' AND (SELECT public.can_edit()));
CREATE POLICY "Fichiers KPI : suppression par le RSSI" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'kpi-files' AND (SELECT public.can_edit()));

-- -----------------------------------------------------------------------------
-- 5. Gestion des profils (écran Paramètres > Utilisateurs, RSSI seulement)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
  RETURNS TABLE (id uuid, email text, first_name text, last_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_edit() THEN
    RAISE EXCEPTION 'Réservé au profil RSSI' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.email::text, u.first_name, u.last_name, u.role, a.created_at, a.last_sign_in_at
    FROM auth.users a
    LEFT JOIN public.users u ON u.id = a.id
    ORDER BY lower(coalesce(u.last_name, a.email::text)), lower(coalesce(u.first_name, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_role(target uuid, new_role text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_edit() THEN
    RAISE EXCEPTION 'Réservé au profil RSSI' USING ERRCODE = '42501';
  END IF;
  IF new_role IS NOT NULL AND new_role NOT IN ('rssi', 'ssi', 'dsi', 'audit') THEN
    RAISE EXCEPTION 'Profil inconnu : %', new_role USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target) THEN
    RAISE EXCEPTION 'Utilisateur inconnu' USING ERRCODE = '22023';
  END IF;
  -- Au moins un RSSI doit rester : sinon plus personne ne peut gérer les profils
  IF coalesce(new_role, '') <> 'rssi'
     AND EXISTS (SELECT 1 FROM public.users WHERE id = target AND role = 'rssi')
     AND (SELECT count(*) FROM public.users WHERE role = 'rssi') <= 1 THEN
    RAISE EXCEPTION 'Il doit rester au moins un RSSI' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.users (id, email, role)
    SELECT a.id, a.email, new_role FROM auth.users a WHERE a.id = target
  ON CONFLICT (id) DO UPDATE SET role = excluded.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users(), public.admin_set_role(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users(), public.admin_set_role(uuid, text) TO authenticated;

COMMIT;
