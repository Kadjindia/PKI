// Générer un token CSRF aléatoire
export const generateCSRFToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array); // 🔒 Cryptographically secure
  return Array.from(array, (byte) => byte.toString(36)).join('');
};

// Stocker et récupérer le token CSRF
export const getCSRFToken = (): string => {
  const storedToken = sessionStorage.getItem('csrf_token');

  if (storedToken) {
    return storedToken;
  }

  const newToken = generateCSRFToken();
  sessionStorage.setItem('csrf_token', newToken);
  return newToken;
};

// Valider le token CSRF
export const validateCSRFToken = (receivedToken: string): boolean => {
  const storedToken = sessionStorage.getItem('csrf_token');
  return storedToken === receivedToken;
};