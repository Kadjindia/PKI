import { describe, it, expect } from "vitest";
import { canSee, canEdit, homeOf, profileLabel, isProfile } from "@/lib/access";

const SSI = ["/", "/gouvernance", "/security-ops", "/sensibilisation", "/messagerie", "/risques"];
const TOOLS = ["/monitoring", "/reports"];

describe("profils d'accès", () => {
  it("RSSI et équipe SSI voient tout", () => {
    for (const p of ["rssi", "ssi"]) for (const path of [...SSI, ...TOOLS, "/parametres"]) expect(canSee(p, path)).toBe(true);
  });
  it("DSI : seulement les outils intégrés et les rapports", () => {
    for (const path of TOOLS) expect(canSee("dsi", path)).toBe(true);
    for (const path of SSI) expect(canSee("dsi", path)).toBe(false);
    expect(homeOf("dsi")).toBe("/monitoring");
  });
  it("audit interne : l'inverse de la DSI", () => {
    for (const path of SSI) expect(canSee("audit", path)).toBe(true);
    for (const path of TOOLS) expect(canSee("audit", path)).toBe(false);
    expect(homeOf("audit")).toBe("/");
  });
  it("sans profil : rien d'autre que les paramètres", () => {
    for (const p of [null, undefined, "saisisseur", ""]) {
      for (const path of [...SSI, ...TOOLS]) expect(canSee(p, path)).toBe(false);
      expect(canSee(p, "/parametres")).toBe(true);
      expect(homeOf(p)).toBe("/parametres");
      expect(profileLabel(p)).toBe("En attente");
      expect(isProfile(p)).toBe(false);
    }
  });
  it("seul le RSSI modifie", () => {
    expect(canEdit("rssi")).toBe(true);
    for (const p of ["ssi", "dsi", "audit", null]) expect(canEdit(p)).toBe(false);
  });
});
