import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { getCSRFToken } from './utils/csrf';
import { AuthProvider } from './context/AuthContext';
import { applyTheme, watchSystemTheme } from './lib/theme';

// 1. Appliquer le thème mémorisé (clair, sombre ou celui de l'ordinateur)
applyTheme();
watchSystemTheme();

// 2. Initialiser le token CSRF
getCSRFToken();

// 3. Rendu de l'application
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);