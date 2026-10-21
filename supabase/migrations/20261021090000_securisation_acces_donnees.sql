-- =============================================================================
-- Sécurisation de l'accès aux données
--
-- Avant : les policies RLS étaient en USING (true) sans rôle cible, donc
-- applicables au rôle "anon". Avec la clé publique Supabase (présente dans le
-- bundle JS), n'importe qui pouvait lire, modifier et supprimer les données
-- sans être connecté.
--
-- Après :
--   * "anon" (visiteur non connecté) n'a plus aucun accès aux tables ;
--   * les tables métier sont réservées aux utilisateurs connectés ;
--   * la table "users" reste limitée à son propre profil, et la colonne "role"
--     n'est plus modifiable par l'utilisateur (anti auto-promotion) ;
--   * le bucket "kpi-files" n'accepte plus d'envoi/suppression anonyme.
--
-- Migration idempotente : elle peut être rejouée sans erreur.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Retrait de tous les droits du rôle anon sur le schéma public
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Et pour les objets créés à l'avenir
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- -----------------------------------------------------------------------------
-- 2. Tables métier : accès réservé aux utilisateurs connectés
--    On supprime toutes les policies existantes (quels que soient leurs noms,
--    la base réelle pouvant différer de schema.sql) puis on en recrée une seule.
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

    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Accès réservé aux utilisateurs connectés" ON public.%I '
      'FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Table users : chacun ne voit et ne modifie que son propre profil
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.users', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture de son propre profil" ON public.users
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "Création de son propre profil" ON public.users
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY "Modification de son propre profil" ON public.users
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

-- Droits par colonne : "role" et "email" ne sont plus modifiables depuis
-- l'application (sinon un utilisateur pourrait s'attribuer un rôle supérieur).
-- Les colonnes autorisées correspondent au formulaire de profil (ProfileModal).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT INSERT (id, first_name, last_name, initials, title) ON public.users TO authenticated;
GRANT UPDATE (id, first_name, last_name, initials, title) ON public.users TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Fonctions trigger : search_path figé (SECURITY DEFINER) et non appelables
--    directement via l'API
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Stockage des fichiers KPI (bucket "kpi-files")
--    Les envois passent par l'Edge Function process-file (clé service), donc
--    aucun envoi/suppression anonyme n'est nécessaire.
--    Le bucket reste public : les liens déjà enregistrés continuent de marcher,
--    mais la liste des fichiers n'est plus consultable sans être connecté.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "KPI files are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload KPI files"       ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete KPI files"       ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : lecture (connectés)"     ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : envoi (connectés)"       ON storage.objects;
DROP POLICY IF EXISTS "Fichiers KPI : suppression (connectés)" ON storage.objects;

CREATE POLICY "Fichiers KPI : lecture (connectés)" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'kpi-files');
CREATE POLICY "Fichiers KPI : envoi (connectés)" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kpi-files');
CREATE POLICY "Fichiers KPI : suppression (connectés)" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'kpi-files');

COMMIT;
