// Profils d'accès : onglets visibles et droit de modification.
// Les mêmes règles sont appliquées par la base (RLS) et par les fonctions serveur :
// l'écran ne fait que masquer ce que le profil ne peut pas utiliser.

export type Profile = "rssi" | "ssi" | "dsi" | "audit";

export const PROFILES: { key: Profile; label: string; description: string }[] = [
  { key: "rssi", label: "RSSI", description: "Tout voir et tout modifier ; gestion des profils des utilisateurs." },
  { key: "ssi", label: "Équipe SSI", description: "Tout voir, en lecture seule." },
  { key: "dsi", label: "DSI", description: "Tableaux de bord des outils intégrés (Monitoring SI) et rapports, en lecture seule." },
  { key: "audit", label: "Audit interne", description: "Tout sauf les tableaux de bord des outils et les rapports, en lecture seule." },
];

export const profileLabel = (p: string | null | undefined) => PROFILES.find((x) => x.key === p)?.label ?? "En attente";

export const isProfile = (p: unknown): p is Profile => PROFILES.some((x) => x.key === p);

/** Onglets des données SSI (saisies, suivis) et des outils intégrés. */
const SSI_TABS = ["/", "/gouvernance", "/security-ops", "/sensibilisation", "/messagerie", "/risques"];
const TOOL_TABS = ["/monitoring", "/reports"];

const TABS: Record<Profile, string[]> = {
  rssi: [...SSI_TABS, ...TOOL_TABS],
  ssi: [...SSI_TABS, ...TOOL_TABS],
  dsi: TOOL_TABS,
  audit: SSI_TABS,
};

/** Onglet visible pour ce profil (Paramètres l'est toujours). */
export function canSee(profile: string | null | undefined, path: string): boolean {
  if (path === "/parametres") return true;
  return isProfile(profile) && TABS[profile].includes(path);
}

/** Premier onglet accessible : page d'accueil du profil. */
export function homeOf(profile: string | null | undefined): string {
  return isProfile(profile) ? TABS[profile][0] : "/parametres";
}

/** Modification des données (saisie, import, suppression) : RSSI seulement. */
export const canEdit = (profile: string | null | undefined) => profile === "rssi";
