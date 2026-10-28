import { describe, it, expect } from "vitest";
import {
  formatCount, formatBytes, share, snapshotProgress, formatAge,
  allUnauthorized, shortError, inactiveTotal, displayPath, formatElapsed, sourceLabel, zoneTotal, seriesFor, compareSeries, ouFromDn, matchesSearch, toCsv, mergeRunning,
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

  it("calcule une part", () => {
    expect(share(3, 12)).toBe(25);
    expect(share(3, 0)).toBeNull();
  });

  it("compte les indicateurs terminés d'une photo", () => {
    expect(snapshotProgress({
      inactive90: { status: "done", count: 7 },
      expiredEnabled: { status: "error", code: "timeout" },
      zonesStale: { status: "pending" },
      privileged: { status: "queued" },
    })).toEqual({ done: 2, total: 4 });
  });

  it("détecte un refus de droits général et produit des messages courts", () => {
    const denied = { status: "error" as const, code: "unauthorized" as const };
    expect(allUnauthorized({ zonesStale: denied, privileged: { status: "error", code: "filter", field: "isDisabled" } })).toBe(true);
    expect(allUnauthorized({ zonesStale: denied, inactive90: { status: "done", count: 2 } })).toBe(false);
    expect(allUnauthorized({ zonesStale: { status: "pending" } })).toBe(false);
    expect(shortError(denied)).toBe("Droits Varonis insuffisants");
    expect(shortError({ code: "filter", field: "isStale" })).toBe("Filtre « isStale » refusé par Varonis");
  });

  it("additionne les tranches de comptes inactifs et choisit le chemin le plus parlant", () => {
    const done = (count: number, capped = false) => ({ status: "done" as const, count, capped });
    expect(inactiveTotal({
      inactive90: done(3), inactive180: done(4), inactive365: done(5), inactive730: done(6, true),
    })).toEqual({ count: 18, capped: true });
    expect(inactiveTotal({ inactive90: done(3), inactive180: { status: "pending" } })).toEqual({ count: undefined, capped: false });
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

  it("traduit le type de source", () => {
    expect(sourceLabel("SharePoint Online")).toBe("SharePoint");
    expect(sourceLabel("OneDrive")).toBe("OneDrive");
    expect(sourceLabel("Windows")).toBe("Partage de fichiers");
    expect(sourceLabel(null)).toBeNull();
  });

  it("additionne le total des dossiers sensibles par source de données", () => {
    const zone = (name: string, sizeBytes: number) => ({ name, sizeBytes, isStale: false, staleAccess: false, ownerIssue: false });
    expect(zoneTotal({}).status).toBe("queued");
    expect(zoneTotal({ dataSources: { status: "done", expanded: true }, "zonesTotal:1": { status: "pending" } }).status).toBe("pending");
    const t = zoneTotal({
      dataSources: { status: "done", expanded: true },
      "zonesTotal:1": { status: "done", count: 3, sizeBytes: 10, files: 5, top: [zone("A", 10)] },
      "zonesTotal:2": { status: "done", count: 2, sizeBytes: 30, files: 1, capped: true, top: [zone("B", 30)] },
      // partition redécoupée : ignorée au profit de ses moitiés
      "zonesTotal:3": { status: "done", count: 99, capped: true, split: true },
    });
    expect(t).toMatchObject({ status: "done", count: 5, sizeBytes: 40, files: 6, capped: true });
    expect(t.top?.map((z) => z.name)).toEqual(["B", "A"]);
  });

  it("construit l'évolution d'un indicateur et la compare", () => {
    const pts = [
      { date: "2026-10-27T04:00:00Z", values: { zonesStale: 600, exposed: null } },
      { date: "2026-11-10T04:00:00Z", values: { zonesStale: 580 } },
      { date: "2026-11-27T04:00:00Z", values: { zonesStale: 550, exposed: 12 } },
    ];
    expect(seriesFor(pts, "exposed")).toHaveLength(1);
    const s = seriesFor(pts, "zonesStale");
    expect(s.map((p) => p.value)).toEqual([600, 580, 550]);
    // il y a 30 jours : photo du 27/10
    expect(compareSeries(s, 30)).toMatchObject({ delta: -50, sinceStart: false, ref: { value: 600 } });
    // il y a 7 jours : photo du 10/11
    expect(compareSeries(s, 7)?.ref.value).toBe(580);
    // historique trop court pour 90 jours : comparaison avec la première photo
    expect(compareSeries(s, 90)).toMatchObject({ sinceStart: true, ref: { value: 600 } });
    expect(compareSeries(seriesFor(pts, "exposed"), 30)).toBeNull();
  });

  it("outille l'inventaire : OU, recherche et CSV", () => {
    expect(ouFromDn("CN=Jean Dupont,OU=Utilisateurs,OU=Paris,DC=corp,DC=local")).toBe("Paris / Utilisateurs");
    expect(ouFromDn(undefined)).toBe("");
    expect(matchesSearch({ name: "Jean Dupont", department: "Finance" }, "finan")).toBe(true);
    expect(matchesSearch({ name: "Jean", privileged: ["ADMIN"] }, "admin")).toBe(true);
    expect(matchesSearch({ name: "Jean" }, "paul")).toBe(false);
    const csv = toCsv([{ name: 'A;B', n: 2 }, { name: 'C"D' }], [{ key: "name", label: "Nom" }, { key: "n", label: "N" }]);
    expect(csv).toBe('\uFEFFNom;N\r\n"A;B";2\r\n"C""D";');
  });

  it("met à jour au fil de l'eau sans mélanger deux calculs du total", () => {
    const latest = {
      zonesStale: { status: "done" as const, count: 600 },
      privileged: { status: "done" as const, count: 10, admins: 235 },
      dataSources: { status: "done" as const, expanded: true },
      "zonesTotal:1": { status: "done" as const, count: 100 },
    };
    const running = {
      zonesStale: { status: "pending" as const },
      privileged: { status: "done" as const, count: 11, admins: 236, doneAt: "2026-10-27T15:00:00Z" },
      zonesStaleOwner: { status: "done" as const, count: 1, carriedFrom: "2026-10-27T04:00:00Z" },
      dataSources: { status: "done" as const, expanded: true },
      "zonesTotal:1": { status: "done" as const, count: 90 },
      "zonesTotal:2": { status: "pending" as const },
    };
    const m = mergeRunning(latest, running);
    expect(m.zonesStale?.count).toBe(600); // pas encore recalculé
    expect(m.privileged).toMatchObject({ admins: 236, fresh: true });
    expect(m.zonesStaleOwner).toBeUndefined(); // valeur reprise : pas une mise à jour
    expect(m["zonesTotal:1"]?.count).toBe(100); // total incomplet : on garde l'ancien
    const done = mergeRunning(latest, { ...running, "zonesTotal:2": { status: "done" as const, count: 5 } });
    expect(done["zonesTotal:1"]).toMatchObject({ count: 90, fresh: true });
    expect(mergeRunning(undefined, undefined)).toEqual({});
  });
});
