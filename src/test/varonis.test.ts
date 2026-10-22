import { describe, it, expect } from "vitest";
import {
  normalizeSeverity, isOpen, formatStatus, summarizeAlerts, type VaronisAlert,
  computeRange, previousRange, filterByRange, dataCoverage, variation,
  granularityFor, buildTimeline, hourlyDistribution, isOffHours, buildInsights,
  threatFamily, threatTracking, openAgeBuckets, handlingSplit, escalationRate, eventSpikes, policyNoise,
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
    expect(normalizeSeverity("Informational")).toBe("info");
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
    expect(s.bySeverity).toEqual({ high: 1, medium: 1, low: 1, info: 0, unknown: 1 });
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

describe("période", () => {
  const now = new Date(2026, 9, 21, 15, 0); // 21/10/2026 15:00 (heure locale)

  it("calcule les N derniers jours / mois (depuis minuit) et les périodes calendaires", () => {
    const r = computeRange("last", 7, "days", now);
    expect(new Date(r.from)).toEqual(new Date(2026, 9, 14));
    expect(r.to).toBe(now.getTime());
    expect(new Date(computeRange("this", 1, "months", now).from)).toEqual(new Date(2026, 9, 1));
    expect(new Date(computeRange("this", 1, "years", now).from)).toEqual(new Date(2026, 0, 1));
    expect(new Date(computeRange("last", 0, "days", now).from)).toEqual(new Date(2026, 9, 20)); // min 1
    expect(new Date(computeRange("last", 1, "months", now).from)).toEqual(new Date(2026, 8, 21));
  });

  it("donne la période précédente de même durée", () => {
    const r = { from: 1000, to: 3000 };
    expect(previousRange(r)).toEqual({ from: -1000, to: 1000 });
  });

  it("filtre les alertes sur la période et ignore celles sans date", () => {
    const at = (iso: string | null) => alert(iso ?? "x", { generationTime: iso ? { dateTimeUtc: iso } : null });
    const list = [at("2026-10-10T00:00:00Z"), at("2026-10-20T00:00:00Z"), at(null)];
    const r = { from: Date.parse("2026-10-15T00:00:00Z"), to: Date.parse("2026-10-21T00:00:00Z") };
    expect(filterByRange(list, r).map((a) => a.id)).toEqual(["2026-10-20T00:00:00Z"]);
    expect(dataCoverage(list)?.oldest.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(dataCoverage([])).toBeNull();
  });

  it("calcule l'évolution en %", () => {
    expect(variation(15, 10)).toBe(50);
    expect(variation(5, 10)).toBe(-50);
    expect(variation(3, 0)).toBeNull();
    expect(variation(0, 0)).toBe(0);
  });

});

describe("chronologie et répartition horaire", () => {
  it("choisit la granularité selon la durée", () => {
    const day = 24 * 3600 * 1000;
    expect(granularityFor({ from: 0, to: day })).toBe("hour");
    expect(granularityFor({ from: 0, to: 30 * day })).toBe("day");
    expect(granularityFor({ from: 0, to: 90 * day })).toBe("week");
    expect(granularityFor({ from: 0, to: 365 * day })).toBe("month");
  });

  it("ventile les alertes par jour et par sévérité, jours vides compris", () => {
    const r = { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 3, 23).getTime() };
    const list = [
      alert("1", { generationTime: { dateTimeUtc: new Date(2026, 9, 1, 10).toISOString() } }),
      alert("2", { generationTime: { dateTimeUtc: new Date(2026, 9, 1, 11).toISOString() }, policy: { severity: "Low" } }),
      alert("3", { generationTime: { dateTimeUtc: new Date(2026, 9, 3, 9).toISOString() } }),
    ];
    const t = buildTimeline(list, r, "day");
    expect(t).toHaveLength(3);
    expect(t.map((p) => p.total)).toEqual([2, 0, 1]);
    expect(t[0].high).toBe(1);
    expect(t[0].low).toBe(1);
  });

  it("compte par heure locale et repère les heures non ouvrées", () => {
    const h = hourlyDistribution([alert("1", { generationTime: { dateTimeUtc: new Date(2026, 9, 21, 23, 30).toISOString() } })]);
    expect(h[23].count).toBe(1);
    expect(isOffHours(new Date(2026, 9, 21, 23))).toBe(true);  // mercredi 23 h
    expect(isOffHours(new Date(2026, 9, 21, 10))).toBe(false); // mercredi 10 h
    expect(isOffHours(new Date(2026, 9, 25, 10))).toBe(true);  // dimanche
  });
});

describe("points d'attention", () => {
  it("signale les alertes élevées ouvertes, les données sensibles et la hausse", () => {
    const current = [
      alert("1", { hasSensitiveResource: true }),
      alert("2"),
      alert("3", { status: "CLOSED" }),
    ];
    const previous = [alert("p1")];
    const texts = buildInsights(current, previous).map((i) => i.text);
    expect(texts.some((t) => t.startsWith("2 alertes de sévérité élevée"))).toBe(true);
    expect(texts.some((t) => t.startsWith("1 alerte ouverte concerne des données sensibles"))).toBe(true);
    expect(texts.some((t) => t.includes("Taux de traitement : 33 %"))).toBe(true);
  });

  it("ne signale une hausse de volume que sur une base d'au moins 10 alertes", () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => alert(p + i, { status: "CLOSED" }));
    const hausse = (prev: number) => buildInsights(many(15, "c"), many(prev, "p")).some((i) => i.text.includes("hausse"));
    expect(hausse(10)).toBe(true);  // 10 -> 15 : +50 %
    expect(hausse(2)).toBe(false);  // base trop petite
  });

  it("ne produit rien sans alerte", () => {
    expect(buildInsights([], [])).toEqual([]);
  });
});

describe("pilotage SOC", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const daysAgo = (n: number) => ({ dateTimeUtc: new Date(now.getTime() - n * 86400e3).toISOString() });

  it("classe les alertes par famille de menace (catégorie puis nom)", () => {
    expect(threatFamily(alert("1", { policy: { category: "Ransomware", name: "x" } }))).toBe("ransomware");
    expect(threatFamily(alert("2", { policy: { category: "Autre", name: "Activité de chiffrement suspecte" } }))).toBe("ransomware");
    expect(threatFamily(alert("3", { policy: { category: "Exfiltration" } }))).toBe("exfiltration");
    expect(threatFamily(alert("4", { policy: { name: "Ajout à un groupe Domain Admins" } }))).toBe("privileges");
    expect(threatFamily(alert("5", { policy: { name: "Suppression massive de fichiers" } }))).toBe("destruction");
    expect(threatFamily(alert("6", { policy: { name: "Connexion inhabituelle", category: "Accès" } }))).toBeNull();
  });

  it("compte les menaces critiques sur la période et la précédente", () => {
    const cur = [
      alert("1", { policy: { category: "Ransomware" } }),
      alert("2", { policy: { category: "Ransomware" }, status: "CLOSED" }),
    ];
    const prev = [alert("p", { policy: { category: "Ransomware" } })];
    const r = threatTracking(cur, prev).find((t) => t.key === "ransomware");
    expect(r).toMatchObject({ total: 2, open: 1, previous: 1 });
  });

  it("répartit l'arriéré par ancienneté (alertes ouvertes uniquement)", () => {
    const list = [
      alert("1", { generationTime: daysAgo(2) }),
      alert("2", { generationTime: daysAgo(10) }),                       // élevée, > 7 j
      alert("3", { generationTime: daysAgo(45), policy: { severity: "Low" } }),
      alert("4", { generationTime: daysAgo(90), status: "CLOSED" }),     // fermée : ignorée
    ];
    expect(openAgeBuckets(list, now)).toEqual({ lt7: 1, d7to30: 1, gt30: 1, oldestDays: 45, highGt7: 1 });
  });

  it("répartit la prise en charge et calcule le taux d'escalade", () => {
    const list = [
      alert("1", { isAssignedToVaronis: true }),
      alert("2"),
      alert("3", { status: "ESCALATED" }),
      alert("4", { status: "CLOSED", isAssignedToVaronis: true }),
    ];
    expect(handlingSplit(list)).toEqual({ varonis: 1, internal: 2 });
    expect(escalationRate(list)).toBe(25);
    expect(escalationRate([])).toBe(0);
  });

  it("repère les pics d'événements (≥ 5 × la médiane, minimum 50)", () => {
    const list = [10, 12, 8, 11, 400, 9, 60].map((n, i) => alert(String(i), { eventsCount: n }));
    const { threshold, spikes } = eventSpikes(list);
    expect(threshold).toBe(55); // médiane 11 × 5
    expect(spikes.map((a) => a.eventsCount)).toEqual([400, 60]);
  });

  it("signale les politiques bruyantes peu graves", () => {
    const list = [
      ...Array.from({ length: 6 }, (_, i) => alert("l" + i, { policy: { name: "Bruit", severity: "Low" } })),
      ...Array.from({ length: 4 }, (_, i) => alert("h" + i, { policy: { name: "Grave", severity: "High" } })),
    ];
    const rows = policyNoise(list);
    expect(rows[0]).toMatchObject({ name: "Bruit", total: 6, share: 60, noisy: true });
    expect(rows[1]).toMatchObject({ name: "Grave", noisy: false });
  });

  it("ajoute l'arriéré et les ressources taguées aux points d'attention", () => {
    const all = [
      alert("1", { generationTime: daysAgo(40), hasTaggedResource: true }),
      alert("2", { generationTime: daysAgo(1) }),
    ];
    const texts = buildInsights(all, [], all, now).map((i) => i.text);
    expect(texts).toContain("1 alerte élevée est ouverte depuis plus de 7 jours (toutes périodes confondues).");
    expect(texts).toContain("Arriéré (toutes périodes) : 1 alerte ouverte depuis plus de 30 jours.");
    expect(texts).toContain("1 alerte ouverte touche des ressources taguées (données critiques).");
  });
});
