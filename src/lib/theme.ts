// Thème de l'interface : clair, sombre, ou celui de l'ordinateur. Choix mémorisé sur le poste.

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "theme";
const darkQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "system") return v;
  } catch {
    // stockage indisponible : thème clair
  }
  return "light";
}

/** Thème réellement affiché pour un choix donné. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return darkQuery()?.matches ? "dark" : "light";
}

/** Applique le thème à la page (classe light-theme sur <html>). */
export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  document.documentElement.classList.toggle("light-theme", resolveTheme(choice) === "light");
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // stockage indisponible : le choix vaut pour la session
  }
  applyTheme(choice);
}

/** Suit les changements de réglage de l'ordinateur quand le choix est « Système ». */
export function watchSystemTheme() {
  darkQuery()?.addEventListener("change", () => {
    if (getThemeChoice() === "system") applyTheme("system");
  });
}
