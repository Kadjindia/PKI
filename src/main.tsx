import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { getCSRFToken } from './utils/csrf';
import { AuthProvider } from './context/AuthContext';

// 1. Appliquer le thème sauvegardé
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme !== 'light') {
  document.documentElement.classList.remove('light-theme');
} else {
  document.documentElement.classList.add('light-theme');
}

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