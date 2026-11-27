import { useAuth } from "@/context/AuthContext";
import { canEdit, canSee, homeOf, profileLabel } from "@/lib/access";

/** Profil de l'utilisateur connecté et ce qu'il permet. */
export function useAccess() {
  const { role } = useAuth();
  return {
    role,
    label: profileLabel(role),
    /** Modification des données : RSSI seulement. */
    canEdit: canEdit(role),
    canSee: (path: string) => canSee(role, path),
    home: homeOf(role),
  };
}
