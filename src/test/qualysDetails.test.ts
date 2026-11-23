import { describe, it, expect } from "vitest";
import {
  indexCatalog, filterAssets, summarize, productKey, productGroups, eolProducts, osFamily, toggle, chips, removeChip, isFiltered,
  type DAsset, type DCatalog,
} from "../lib/qualysDetails";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const cat = (qid: number, title: string, flags = 0, products: [string, string][] = [], severity = 4): DCatalog =>
  ({ qid, severity, title, category: null, cvss3: 7.5, cves: [], flags, products, published: null, hosts: 0, servers: 0, overdue: 0, first_found: null });
const catalog = [
  cat(1, "Java (Maven) Security Update for jackson-databind (GHSA-aaaa)", 1 | 16, [["fasterxml", "jackson-databind"]], 5),
  cat(2, "Java (Maven) Security Update for jackson-databind (GHSA-bbbb)", 16, [["fasterxml", "jackson-databind"]]),
  cat(3, "EOL/Obsolete Software: Microsoft Silverlight 5 Detected"),
  cat(4, "Allowed Null Session (CVE-2000-1200)", 0, [], 3),
];
const asset = (id: number, o: Partial<DAsset>): DAsset => ({
  host_id: id, asset_id: null, name: `srv${id}`, ip: "10.0.0.1", os: "Windows Server 2019 Standard", asset_type: "server", tracking: "QAGENT", trurisk: 500, criticality: null,
  last_scan: "2026-11-20T00:00:00Z", last_activity: null, public_ip: false, tags: [], d5: 0, d4: 0, d3: 0, overdue: 0, ignored: 0, reopened: 0, qds_max: 0,
  kev: 0, ransomware: 0, armed: 0, eol: 0, qids: [], ...o,
});
const assets = [
  asset(1, { qids: [1, 2], kev: 1, armed: 2, d5: 1, d4: 1, trurisk: 900, tags: ["Prod"] }),
  asset(2, { qids: [2, 3], armed: 1, eol: 1, d4: 2, asset_type: "workstation", os: "Windows 10 Pro 22H2", tracking: "IP", last_scan: null, public_ip: true }),
  asset(3, { qids: [4], d3: 1, trurisk: 100 }),
];
const idx = indexCatalog(catalog);

describe("détail Qualys : filtres et regroupements", () => {
  it("regroupe les vulnérabilités d'un même produit", () => {
    expect(productKey(catalog[0])).toBe("Fasterxml Jackson-Databind");
    expect(productKey(catalog[3])).toBe("Allowed Null Session");
    const g = productGroups(assets, idx).find((x) => x.key === "Fasterxml Jackson-Databind")!;
    expect(g).toMatchObject({ hosts: 2, servers: 1, publicHosts: 1, maxSeverity: 5, kevQids: 1, detections: 3 });
    expect(g.qids.sort()).toEqual([1, 2]);
  });

  it("filtre les actifs et recalcule les chiffres", () => {
    expect(filterAssets(assets, { threat: "kev" }, idx).map((a) => a.host_id)).toEqual([1]);
    expect(filterAssets(assets, { product: "Fasterxml Jackson-Databind" }, idx).map((a) => a.host_id)).toEqual([1, 2]);
    expect(filterAssets(assets, { scan: "never" }, idx, NOW).map((a) => a.host_id)).toEqual([2]);
    expect(filterAssets(assets, { agent: false }, idx).map((a) => a.host_id)).toEqual([2]);
    expect(filterAssets(assets, { tier: ["critical"] }, idx).map((a) => a.host_id)).toEqual([1]);
    expect(filterAssets(assets, { tag: ["Prod"], qid: 2 }, idx).map((a) => a.host_id)).toEqual([1]);
    expect(filterAssets(assets, { os: ["Windows 10"] }, idx).map((a) => a.host_id)).toEqual([2]);
    const s = summarize(assets, NOW);
    expect(s).toMatchObject({ total: 3, agent: 2, never: 1, publicIp: 1, kevAssets: 1, armedAssets: 2, eolAssets: 1, d5: 1, truriskAvg: 500 });
  });

  it("liste les produits en fin de support de la sélection", () => {
    expect(eolProducts(assets, idx)).toEqual([{ qid: 3, title: "Microsoft Silverlight 5 Detected", os: false, hosts: 1, servers: 0 }]);
  });

  it("famille de système, bascule de filtres et pastilles", () => {
    expect(osFamily("Windows Server 2019 Standard 64 bit Edition Version 1809")).toBe("Windows Server 2019");
    expect(osFamily("Debian Linux 13.7")).toBe("Debian Linux 13");
    let f = toggle({}, "type", "server");
    f = toggle(f, "type", "workstation");
    expect(f.type).toEqual(["server", "workstation"]);
    f = toggle(f, "type", "server");
    expect(f.type).toEqual(["workstation"]);
    f = { ...f, threat: "kev" };
    const c = chips(f, { server: "Serveurs", workstation: "Postes de travail", other: "Autres" });
    expect(c.map((x) => x.label)).toEqual(["Postes de travail", "Exploitées activement (CISA KEV)"]);
    f = c.reduce(removeChip, f);
    expect(isFiltered(f)).toBe(false);
  });
});
