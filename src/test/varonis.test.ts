import { describe, it, expect } from "vitest";
import {
  normalizeSeverity, isOpen, formatStatus, summarizeAlerts, type VaronisAlert,
  computeRange, previousRange, filterByRange, dataCoverage, variation,
  granularityFor, buildTimeline, hourlyDistribution, isOffHours, buildInsights,
  threatFamily, threatTracking, openAgeBuckets, handlingSplit, escalationRate, policyNoise,
  closeVerdict, verdictStats, dataSourceLabel, dataSourceStats, closedByStats, openEscalations, safeAlertUrl,
  applyFilters, toggleFilter, applyFilterPatch, filterChips, removeChip, isFiltered,
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

describe("étape 2 : verdicts, sources, clôture, escalades", () => {
  const closed = (id: string, reason: string | null, over: Partial<VaronisAlert> = {}) =>
    alert(id, { status: "CLOSED", closeReason: reason ? { name: reason } : null, ...over });

  it("classe les motifs de clôture", () => {
    expect(closeVerdict(closed("1", "True Positive"))).toBe("truePositive");
    expect(closeVerdict(closed("2", "False Positive"))).toBe("falsePositive");
    expect(closeVerdict(closed("3", "Benign Activity"))).toBe("falsePositive");
    expect(closeVerdict(closed("4", "Not Relevant"))).toBe("falsePositive");
    expect(closeVerdict(closed("5", "Resolved"))).toBe("other");
    expect(closeVerdict(closed("6", null))).toBeNull();
  });

  it("calcule les verdicts des alertes clôturées uniquement", () => {
    const list = [closed("1", "True Positive"), closed("2", "Benign Activity"), closed("3", "Benign Activity"), closed("4", null), alert("5")];
    const v = verdictStats(list);
    expect(v).toMatchObject({ closed: 4, classified: 3, truePositive: 1, falsePositive: 2, other: 0 });
    expect(v.reasons[0]).toEqual({ name: "Benign Activity", count: 2, verdict: "falsePositive" });
  });

  it("signale comme bruit une politique majoritairement en faux positifs", () => {
    const list = Array.from({ length: 6 }, (_, i) => closed("f" + i, i < 4 ? "False Positive" : "True Positive", { policy: { name: "P", severity: "High" } }));
    const extra = Array.from({ length: 40 }, (_, i) => alert("x" + i, { policy: { name: "Autre", severity: "High" } }));
    const p = policyNoise([...list, ...extra]).find((r) => r.name === "P");
    expect(p).toMatchObject({ falsePositivePct: 67, noisy: true });
  });

  it("libelle et compte les sources de données (une fois par type et par alerte)", () => {
    expect(dataSourceLabel("SharePointOnline")).toBe("SharePoint Online");
    expect(dataSourceLabel("Windows")).toBe("Serveurs de fichiers Windows");
    expect(dataSourceLabel("NouveauType")).toBe("NouveauType");
    expect(dataSourceLabel(null, "FS01")).toBe("FS01");
    const list = [
      alert("1", { dataSource: [{ type: "Windows", name: "FS01" }, { type: "Windows", name: "FS02" }] }),
      alert("2", { dataSource: [{ type: "ExchangeOnline" }], status: "CLOSED" }),
      alert("3", { dataSource: null }),
    ];
    expect(dataSourceStats(list)).toEqual([
      { label: "Exchange Online", total: 1, open: 0 },
      { label: "Serveurs de fichiers Windows", total: 1, open: 1 },
      { label: "Source inconnue", total: 1, open: 1 },
    ]);
  });

  it("répartit les clôtures entre Varonis et les analystes internes", () => {
    const list = [
      closed("1", "x", { closedBy: { name: "Varonis" } }),
      closed("2", "x", { closedBy: { name: "j.dupont" } }),
      closed("3", "x", { closedBy: { name: "j.dupont" } }),
      closed("4", "x", { closedBy: null }),
      alert("5", { closedBy: { name: "ignoré car ouverte" } }),
    ];
    expect(closedByStats(list)).toEqual({ varonis: 1, internal: 2, unknown: 1, analysts: [{ name: "j.dupont", count: 2 }] });
  });

  it("compte les escalades ouvertes par type", () => {
    const list = [
      alert("1", { escalationType: "MITIGATION" }),
      alert("2", { escalationType: "VALIDATION" }),
      alert("3", { escalationType: "MITIGATION", status: "CLOSED" }),
      alert("4", { escalationType: null }),
    ];
    expect(openEscalations(list)).toEqual({ MITIGATION: 1, VALIDATION: 1, INFORMATION: 0 });
  });

  it("n'accepte que des liens http(s) vers Varonis", () => {
    expect(safeAlertUrl(alert("1", { url: "https://tenant.varonis.io/alert/1" }))).toBe("https://tenant.varonis.io/alert/1");
    expect(safeAlertUrl(alert("2", { url: "javascript:alert(1)" }))).toBeNull();
    expect(safeAlertUrl(alert("3"))).toBeNull();
  });

  it("signale les remédiations attendues", () => {
    const list = [alert("1", { escalationType: "MITIGATION" })];
    const texts = buildInsights(list, [], list).map((i) => i.text);
    expect(texts).toContain("1 alerte escaladée par Varonis attend une action de remédiation de votre part.");
  });
});

describe("filtres croisés", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const mk = (o: Partial<VaronisAlert>): VaronisAlert => ({ id: Math.random().toString(), status: "Open", ...o } as VaronisAlert);
  const alerts = [
    mk({ policy: { name: "P1", severity: "High", category: "Ransomware" }, generationTime: { dateTimeUtc: "2026-10-25T10:00:00Z" }, hasSensitiveResource: true }),
    mk({ status: "Closed", policy: { name: "P2", severity: "Low" }, closeReason: { name: "False positive" }, closedBy: { name: "Varonis" }, generationTime: { dateTimeUtc: "2026-09-01T10:00:00Z" } }),
    mk({ policy: { name: "P2", severity: "Medium" }, escalationType: "MITIGATION", isAssignedToVaronis: true, generationTime: { dateTimeUtc: "2026-09-01T22:00:00Z" } }),
  ];

  it("combine les filtres", () => {
    expect(applyFilters(alerts, {}, now)).toHaveLength(3);
    expect(applyFilters(alerts, { state: "open" }, now)).toHaveLength(2);
    expect(applyFilters(alerts, { state: "open", severity: ["high"] }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { policy: "P2", state: "closed" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { verdict: "falsePositive" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { closer: "varonis" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { escalation: "MITIGATION" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { handling: "varonis" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { age: "gt30" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { age: "lt7" }, now)).toHaveLength(1);
    expect(applyFilters(alerts, { threat: "ransomware", sensitive: true }, now)).toHaveLength(1);
    const from = Date.parse("2026-10-25T00:00:00Z");
    expect(applyFilters(alerts, { bucket: { from, to: from + 86400000, label: "25/10" } }, now)).toHaveLength(1);
  });

  it("bascule au clic et décrit les filtres actifs", () => {
    let f = toggleFilter({}, "severity", "high");
    f = toggleFilter(f, "severity", "medium");
    expect(f.severity).toEqual(["high", "medium"]);
    f = toggleFilter(f, "severity", "high");
    expect(f.severity).toEqual(["medium"]);
    f = toggleFilter(f, "policy", "P2");
    expect(toggleFilter(f, "policy", "P2").policy).toBeUndefined();
    expect(filterChips(f).map((c) => c.label)).toEqual(["Sévérité : Moyenne", "Politique : P2"]);
    expect(removeChip(f, filterChips(f)[0]).severity).toBeUndefined();
    const patched = applyFilterPatch({}, { state: "open", severity: ["high"] });
    expect(patched).toEqual({ state: "open", severity: ["high"] });
    expect(isFiltered(applyFilterPatch(patched, { state: "open", severity: ["high"] }))).toBe(false);
  });
});
