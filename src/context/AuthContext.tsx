import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCSRFToken } from '@/utils/csrf';

interface AuthContextType {
  user: User | null;
  role: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<boolean>(false);

  // Profil (users.role) : relu à chaque changement d'utilisateur (ouverture, connexion, déconnexion)
  // Utilisateur dont le profil est chargé : tant qu'il diffère de l'utilisateur courant, on attend
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const userId = user?.id ?? null;

  useEffect(() => {
    getCSRFToken();

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
      } catch (err) {
        console.error("Erreur lors de la récupération de la session:", err);
      } finally {
        setSessionLoading(false);
      }
    };

    void checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setSessionLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setRole(null);
      setRoleFor(null);
      return;
    }
    const loadRole = async () => {
      try {
        const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
        // Sans profil attribué : aucun accès aux données (profil en attente)
        if (!cancelled) setRole(data?.role ?? null);
      } catch (err) {
        console.error("Erreur lors de la récupération du profil:", err);
        if (!cancelled) setRole(null);
      } finally {
        if (!cancelled) setRoleFor(userId);
      }
    };
    void loadRole();
    return () => { cancelled = true; };
  }, [userId]);

  const loading = sessionLoading || signingIn || (userId !== null && roleFor !== userId);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setSigningIn(true);
      const csrfToken = getCSRFToken();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      }, {
        headers: {
          'X-CSRF-Token': csrfToken,
        } as any, // Cast nécessaire car le SDK attend un objet standard
      });
      if (error) throw error;
      setSigningIn(false);
    } catch (err: any) {
      setSigningIn(false);
      throw new Error('Erreur de connexion: ' + err.message);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const csrfToken = getCSRFToken();
      const { error } = await supabase.auth.signOut({
        headers: {
          'X-CSRF-Token': csrfToken,
        } as any,
      });
      if (error) throw error;
      setUser(null);
      setRole(null);
    } catch (err: any) {
      throw new Error('Erreur lors de la déconnexion: ' + err.message);
    }
  }, []);

  const contextValue = useMemo(() => ({
    user,
    role,
    loading,
    signIn,
    signOut,
  }), [user, role, loading, signIn, signOut]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
};