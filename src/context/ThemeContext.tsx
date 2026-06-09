import { createContext, useState, useEffect, useMemo, ReactNode } from 'react';

// Définition des types pour le thème
type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

// Création du contexte avec une valeur par défaut undefined
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Vérification que nous sommes bien côté client avant d'accéder à localStorage/document
    const savedTheme = (localStorage.getItem('theme') as Theme) || 'light';
    setTheme(savedTheme);
    document.body.classList.toggle('dark-mode', savedTheme === 'dark');
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.body.classList.toggle('dark-mode', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  const contextValue = useMemo(() => ({
    theme,
    toggleTheme,
  }), [theme]);

  return (
    <>
      <div className="theme-variables" />
      <ThemeContext.Provider value={contextValue}>
        {children}
      </ThemeContext.Provider>
    </>
  );
};