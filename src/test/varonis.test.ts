import { describe, it, expect } from "vitest";
import {
  normalizeSeverity, isOpen, formatStatus, summarizeAlerts, type VaronisAlert,
} from "@/lib/varonis";

const alert = (id: string, over: Partial<VaronisAlert> = {}): VaronisAlert => ({
  id,
  status: "NEW",
  hasSensitiveResource: false,
  generationTime: { dateTimeUtc: "2026-10-01T10:00:00Z" },
  policy: { name: "Politique A", severity: "High", category: "Exfiltration" },
  ...over,
});

describe("normalizeSeverity", () => {
  it("reconnaît les libellés anglais et français", () => {
    expect(normalizeSeverity("High")).toBe("high");
    expect(normalizeSeverity("CRITICAL")).toBe("high");
    expect(normalizeSeverity("Medium")).toBe("medium");
    expect(normalizeSeverity("faible")).toBe("low");
    expect(normalizeSeverity(null)).toBe("unknown");
    expect(normalizeSeverity("???")).toBe("unknown");
  });
});

describe("isOpen / formatStatus", () => {
  it("considère les alertes fermées ou résolues comme non ouvertes", () => {
    expect(isOpen(alert("1", { status: "NEW" }))).toBe(true);
    expect(isOpen(alert("2", { status: "UNDER_INVESTIGATION" }))).toBe(true);
    expect(isOpen(alert("3", { status: "CLOSED" }))).toBe(false);
    expect(isOpen(alert("4", { status: "Resolved" }))).toBe(false);
  });

  it("rend les statuts lisibles", () => {
    expect(formatStatus("UNDER_INVESTIGATION")).toBe("Under investigation");
    expect(formatStatus(undefined)).toBe("Non renseigné");
  });
});

describe("summarizeAlerts", () => {
  const alerts = [
    alert("1", { hasSensitiveResource: true }),
    alert("2", { policy: { name: "Politique B", severity: "Medium", category: "Accès" } }),
    alert("3", { status: "CLOSED", hasSensitiveResource: true }),
    alert("4", { policy: { name: "Politique A", severity: "Low" }, generationTime: { dateTimeUtc: "2026-10-05T08:00:00Z" } }),
    alert("5", { policy: null, generationTime: null }),
  ];
  const s = summarizeAlerts(alerts);

  it("compte les alertes ouvertes, élevées et sensibles", () => {
    expect(s.total).toBe(5);
    expect(s.open).toBe(4);
    expect(s.openHigh).toBe(1);
    expect(s.sensitive).toBe(1); // l'alerte 3 est fermée
    expect(s.distinctPolicies).toBe(3); // A, B, inconnue
    expect(s.bySeverity).toEqual({ high: 1, medium: 1, low: 1, unknown: 1 });
  });

  it("classe les politiques et catégories des alertes ouvertes", () => {
    expect(s.topPolicies[0]).toEqual({ name: "Politique A", count: 2 });
    expect(s.topPolicies.map((p) => p.name)).toContain("Politique inconnue");
    expect(s.byCategory.find((c) => c.name === "Non catégorisée")?.count).toBe(2);
  });

  it("trie les dernières alertes de la plus récente à la plus ancienne", () => {
    expect(s.latest[0].id).toBe("4");
    expect(s.latest.at(-1)?.id).toBe("5"); // sans date : en dernier
  });

  it("gère une liste vide", () => {
    const empty = summarizeAlerts([]);
    expect(empty.total).toBe(0);
    expect(empty.topPolicies).toEqual([]);
  });
});
