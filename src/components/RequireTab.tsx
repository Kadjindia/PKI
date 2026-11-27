import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAccess } from "@/hooks/useAccess";

/** Onglet masqué pour ce profil : retour à la page d'accueil du profil. */
export default function RequireTab({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  const { canSee, home } = useAccess();
  if (canSee(pathname)) return <>{children}</>;
  return <Navigate to={home} replace />;
}
