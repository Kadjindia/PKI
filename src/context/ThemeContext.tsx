import type { ReactNode } from 'react';

// Le thème est géré par src/lib/theme.ts (appliqué au démarrage dans main.tsx et choisi dans
// Paramètres > Apparence). Ce fournisseur est gardé pour ne pas changer l'arborescence de l'application.
export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => <>{children}</>;
