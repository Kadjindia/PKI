import { describe, it, expect } from "vitest";
import {
  formatCount, formatBytes, privilegedLabel, share, safeUrl, mergePosture, pendingJobs,
} from "@/lib/varonisPosture";

describe("posture Varonis : mise en forme", () => {
  it("affiche les nombres et signale le plafond de l'API", () => {
    expect(formatCount(1234)).toBe((1234).toLocaleString("fr-FR"));
    expect(formatCount(10000, true)).toBe(`${(10000).toLocaleString("fr-FR")} ou plus`);
    expect(formatCount(undefined)).toBe("—");
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

  it("garde les résultats terminés et liste les jobs encore en cours", () => {
    const first = {
      staleUsers: { status: "pending" as const, jobId: "j1" },
      expiredEnabled: { status: "done" as const, count: 3 },
    };
    expect(pendingJobs(first)).toEqual({ staleUsers: "j1" });
    const merged = mergePosture(first, { staleUsers: { status: "done", count: 7 } });
    expect(merged.expiredEnabled?.count).toBe(3);
    expect(merged.staleUsers?.count).toBe(7);
    expect(pendingJobs(merged)).toEqual({});
  });
});
