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
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    getCSRFToken();

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          try {
            const { data } = await supabase
              .from('users')
              .select('role')
              .eq('id', currentUser.id)
              .maybeSingle();

            setRole(data?.role || 'saisisseur');
          } catch (err) {
            console.error("Erreur lors de la récupération du rôle:", err);
            setRole('saisisseur');
          }
        } else {
          setRole(null);
        }
      } catch (err) {
        console.error("Erreur lors de la récupération de la session:", err);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
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
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
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