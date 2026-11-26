import type { KeyboardEvent } from "react";

/**
 * Rend utilisable au clavier un bloc cliquable qui ne peut pas être un vrai bouton (il contient déjà
 * des boutons, ou une mise en page de carte) : rôle « bouton », accessible par Tab, activé par Entrée
 * ou Espace. Préférer un élément <button> natif quand c'est possible.
 */
export function pressable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
