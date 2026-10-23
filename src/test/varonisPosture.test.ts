import { describe, it, expect } from "vitest";
import {
  formatCount, formatBytes, privilegedLabel, share, safeUrl, snapshotProgress, formatAge,
  allUnauthorized, shortError, sumCounts, displayPath, formatElapsed,
} from "@/lib/varonisPosture";

describe("posture Varonis : mise en forme", () => {
  it("affiche les nombres et signale le plafond de l'API", () => {
    expect(formatCount(1234)).toBe((1234).toLocaleString("fr-FR"));
    expect(formatCount(10000, true)).toBe(`${(10000).toLocaleString("fr-FR")} ou plus`);
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(0, true)).toBe("0"); // « 0 ou plus » n'a pas de sens
  });

  it("formate les tailles", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(1024)).toBe(`${(1).toLocaleString("fr-FR")} Ko`);
    expect(formatBytes(2 * 1024 ** 3)).toBe(`${(2).toLocaleString("fr-FR")} Go`);
  });

  it("traduit les types de comptes privilégiés", () => {
    expect(privilegedLabel("ADMIN")).toBe("Administrateurs");
    expect(privilegedLabel("SERVICE")).toBe("Comptes de service");
    expect(privilegedLabel("HIGH_VALUE")).toBe("High value");
  });

  it("calcule une part et filtre les liens", () => {
    expect(share(3, 12)).toBe(25);
    expect(share(3, 0)).toBeNull();
    expect(safeUrl("https://tenant.sharepoint.com/x")).toBe("https://tenant.sharepoint.com/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });

  it("compte les indicateurs terminés d'une photo", () => {
    expect(snapshotProgress({
      staleUsers: { status: "done", count: 7 },
      expiredEnabled: { status: "error", code: "timeout" },
      sensitive: { status: "pending" },
      privileged: { status: "queued" },
    })).toBe(2);
  });

  it("détecte un refus de droits général et produit des messages courts", () => {
    const denied = { status: "error" as const, code: "unauthorized" as const };
    expect(allUnauthorized({ sensitive: denied, privileged: { status: "error", code: "filter", field: "isDisabled" } })).toBe(true);
    expect(allUnauthorized({ sensitive: denied, staleUsers: { status: "done", count: 2 } })).toBe(false);
    expect(allUnauthorized({ sensitive: { status: "pending" } })).toBe(false);
    expect(shortError(denied)).toBe("Droits Varonis insuffisants");
    expect(shortError({ code: "filter", field: "isStale" })).toBe("Filtre « isStale » refusé par Varonis");
  });

  it("additionne deux indicateurs et choisit le chemin le plus parlant", () => {
    expect(sumCounts({ status: "done", count: 3 }, { status: "done", count: 4, capped: true })).toEqual({ count: 7, capped: true });
    expect(sumCounts({ status: "done", count: 3 }, { status: "pending" })).toEqual({ count: undefined, capped: false });
    expect(displayPath({ sharePath: "\\\\FS01\\Departments", path: "D:\\Departments" })).toBe("\\\\FS01\\Departments");
    expect(displayPath({ path: "D:\\Users" })).toBe("D:\\Users");
  });

  it("affiche les durées et l'ancienneté d'une photo", () => {
    expect(shortError({ code: "timeout" })).toBe("Varonis n'a pas répondu à temps");
    expect(formatElapsed(45_000)).toBe("45 s");
    expect(formatElapsed(185_000)).toBe("3 min 05 s");
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(formatAge("2026-10-23T11:59:30Z", now)).toBe("à l'instant");
    expect(formatAge("2026-10-23T11:55:00Z", now)).toBe("il y a 5 min");
    expect(formatAge("2026-10-23T08:00:00Z", now)).toBe("il y a 4 h");
    expect(formatAge("2026-10-20T12:00:00Z", now)).toBe("il y a 3 j");
  });
});
