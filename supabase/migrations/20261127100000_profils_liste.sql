-- =============================================================================
-- Profils : colonne users.role en type énuméré
--
-- L'éditeur de tables de Supabase propose alors une liste déroulante
-- (rssi, ssi, dsi, audit, ou vide pour « en attente ») au lieu d'un champ libre.
-- Les valeurs et les droits ne changent pas.
--
-- Migration idempotente : elle peut être rejouée sans erreur.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profil_acces' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.profil_acces AS ENUM ('rssi', 'ssi', 'dsi', 'audit');
  END IF;
END $$;

COMMENT ON TYPE public.profil_acces IS
  'rssi : tout voir et modifier, gérer les profils · ssi : tout voir en lecture seule · dsi : outils intégrés et rapports · audit : tout sauf les outils et les rapports';

-- La contrainte de valeurs est remplacée par le type lui-même
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ALTER COLUMN role TYPE public.profil_acces USING role::public.profil_acces;
COMMENT ON COLUMN public.users.role IS 'Profil d''accès ; vide = en attente (aucun accès)';

-- Fonctions : mêmes résultats (texte), le type énuméré est converti
CREATE OR REPLACE FUNCTION public.app_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT role::text FROM public.users WHERE id = (SELECT auth.uid());
$$;

DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE FUNCTION public.admin_list_users()
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
    SELECT a.id, a.email::text, u.first_name, u.last_name, u.role::text, a.created_at, a.last_sign_in_at
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
    SELECT a.id, a.email, new_role::public.profil_acces FROM auth.users a WHERE a.id = target
  ON CONFLICT (id) DO UPDATE SET role = excluded.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_role(), public.admin_list_users(), public.admin_set_role(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.app_role(), public.admin_list_users(), public.admin_set_role(uuid, text) TO authenticated;

COMMIT;
