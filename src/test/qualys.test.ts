import { describe, it, expect } from "vitest";
import {
  tag, qualysError, nextPageUrl, hostsPage, detectionsPage, fixedPage, kbPage, buildResults, summaryOf, vulnIndex, assetType, medianOf,
  policiesPage, posturePage, mergePosture, isEol, isEolOs, deadline, isPublicIp, csamPage, wasPage, splitHosts, mergeFixedRows, fixedRowsOfPages, qualysDate, leaves, kbDetails, wasAppsPage, trimJson,
} from "../../supabase/functions/qualys-proxy/parse";
import { classify, gatewayUrl } from "../../supabase/functions/qualys-proxy/diagnostic";
import { remediationProgress, trendOver } from "../lib/qualys";

// Extraits au format renvoyé par l'abonnement (API 5.0, plateforme EU 2)
const NOW = Date.parse("2026-11-16T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
const BASE = "https://qualysapi.qg2.apps.qualys.eu";

const detection = (qid: number, sev: number, firstDays: number, extra = "") => `
            <DETECTION>
              <UNIQUE_VULN_ID>${qid}0</UNIQUE_VULN_ID>
              <QID>${qid}</QID>
              <TYPE>Confirmed</TYPE>
              <SEVERITY>${sev}</SEVERITY>
              <SSL>0</SSL>
              <STATUS>Active</STATUS>
              <FIRST_FOUND_DATETIME>${daysAgo(firstDays)}</FIRST_FOUND_DATETIME>
              <LAST_FOUND_DATETIME>${daysAgo(1)}</LAST_FOUND_DATETIME>
              <TIMES_FOUND>12</TIMES_FOUND>
              <IS_IGNORED>0</IS_IGNORED>
              <IS_DISABLED>0</IS_DISABLED>
              ${extra}
            </DETECTION>`;

const detectionsXml = (hosts: string, next = true) => `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE HOST_LIST_VM_DETECTION_OUTPUT SYSTEM "${BASE}/api/5.0/fo/asset/host/vm/detection/host_list_vm_detection_output.dtd">
<HOST_LIST_VM_DETECTION_OUTPUT>
  <RESPONSE>
    <DATETIME>2026-11-16T12:00:00Z</DATETIME>
    <HOST_LIST>${hosts}
    </HOST_LIST>
    ${next ? `<WARNING>
      <CODE>1980</CODE>
      <TEXT>150 record limit exceeded. Use URL to get next batch of results.</TEXT>
      <URL><![CDATA[${BASE}/api/5.0/fo/asset/host/vm/detection/?action=list&severities=4-5&truncation_limit=150&id_min=12346]]></URL>
    </WARNING>` : ""}
  </RESPONSE>
</HOST_LIST_VM_DETECTION_OUTPUT>`;

const host = (id: number, name: string, dets: string, os = "Windows 11 Enterprise") => `
      <HOST>
        <ID>${id}</ID>
        <IP>10.0.0.${id % 250}</IP>
        <TRACKING_METHOD>Cloud Agent</TRACKING_METHOD>
        <OS><![CDATA[${os}]]></OS>
        <DNS><![CDATA[${name}.corp.local]]></DNS>
        <DNS_DATA><HOSTNAME><![CDATA[${name}]]></HOSTNAME><DOMAIN><![CDATA[corp.local]]></DOMAIN><FQDN><![CDATA[${name}.corp.local]]></FQDN></DNS_DATA>
        <NETBIOS><![CDATA[${name.toUpperCase()}]]></NETBIOS>
        <QG_HOSTID><![CDATA[abc-${id}]]></QG_HOSTID>
        <LAST_SCAN_DATETIME>${daysAgo(1)}</LAST_SCAN_DATETIME>
        <DETECTION_LIST>${dets}
        </DETECTION_LIST>
      </HOST>`;

describe("Qualys : lecture du XML", () => {
  it("lit une balise, avec ou sans CDATA", () => {
    expect(tag("<OS><![CDATA[Windows 11]]></OS>", "OS")).toBe("Windows 11");
    expect(tag("<QDS severity=\"CRITICAL\">95</QDS>", "QDS")).toBe("95");
    // <DNS> ne doit pas être confondu avec <DNS_DATA>
    expect(tag("<DNS_DATA><HOSTNAME>x</HOSTNAME></DNS_DATA><DNS>pc1</DNS>", "DNS")).toBe("pc1");
    expect(tag("<A>1</A>", "B")).toBeNull();
  });

  it("reconnaît une erreur Qualys", () => {
    const xml = `<SIMPLE_RETURN><RESPONSE><DATETIME>x</DATETIME><CODE>2000</CODE><TEXT>Bad Login/Password</TEXT></RESPONSE></SIMPLE_RETURN>`;
    expect(qualysError(xml)).toBe("Bad Login/Password (code 2000)");
    expect(qualysError(detectionsXml(""))).toBeNull();
  });

  it("suit la page suivante, seulement sur le serveur Qualys configuré", () => {
    expect(nextPageUrl(detectionsXml(""), BASE)).toContain("id_min=12346");
    expect(nextPageUrl(detectionsXml("", false), BASE)).toBeNull();
    expect(nextPageUrl(detectionsXml("").split(BASE).join("https://evil.example"), BASE)).toBeNull();
  });
});

describe("Qualys : chiffres d'une page", () => {
  it("compte les vulnérabilités par sévérité, ancienneté et délai", () => {
    const xml = detectionsXml(
      host(1, "pc1", detection(100, 5, 10, `<QDS severity="CRITICAL">95</QDS>`) + detection(100, 5, 10) /* même QID */ + detection(200, 4, 200) + detection(300, 3, 5))
      + host(2, "pc2", detection(100, 5, 40) + detection(400, 4, 5).replace("<IS_IGNORED>0", "<IS_IGNORED>1"))
      + host(3, "pc3", ""),
    );
    const p = detectionsPage(xml, NOW);
    expect(p.hosts).toBe(3);
    expect(p.hostsWithVulns).toBe(2); // pc3 n'a rien
    expect(p.bySev[5]).toMatchObject({ total: 3, overdue: 3, ages: [2, 1, 0, 0] }); // 10 j et 40 j > 7 jours
    expect(p.bySev[4]).toMatchObject({ total: 1, overdue: 1, ages: [0, 0, 0, 1] }); // ignorée exclue
    // Sévérité 3 (modérée) : 5 jours, délai de 3 mois non atteint
    expect(p.bySev[3]).toMatchObject({ total: 1, overdue: 0, ages: [1, 0, 0, 0] });
    expect(p.qdsCritical).toBe(1);
    expect(p.qids["100"][0]).toBe(3);
    expect(p.qids["100"][3]).toBe(Date.parse(daysAgo(40))); // plus ancienne détection
    expect(p.topHosts[0]).toMatchObject({ name: "pc1.corp.local", d5: 2, d4: 1, qdsCritical: 1 });
    // Aucune valeur que le JSON ne sait pas stocker
    expect(JSON.parse(JSON.stringify(p)).qids["200"]).toEqual(p.qids["200"]);
  });

  it("mesure la couverture à partir de la liste des actifs", () => {
    const h = (method: string, scan: string | null, trurisk: number) => `<HOST><ID>1</ID><TRACKING_METHOD>${method}</TRACKING_METHOD>${scan ? `<LAST_VULN_SCAN_DATETIME>${scan}</LAST_VULN_SCAN_DATETIME>` : ""}<TRURISK_SCORE>${trurisk}</TRURISK_SCORE></HOST>`;
    const p = hostsPage(`<HOST_LIST_OUTPUT><RESPONSE><HOST_LIST>${h("Cloud Agent", daysAgo(2), 900)}${h("IP", daysAgo(60), 720)}${h("IP", null, 100)}</HOST_LIST></RESPONSE></HOST_LIST_OUTPUT>`, NOW);
    expect(p).toMatchObject({ total: 3, agent: 1, scanned: 1, neverScanned: 1, trurisk: { critical: 1, high: 1, medium: 0, low: 1 }, truriskSum: 1720, truriskCount: 3 });
    expect(p.topRisk.map((x) => x.trurisk)).toEqual([900, 720, 100]);
  });

  it("classe les actifs serveurs / postes d'après le système d'exploitation", () => {
    expect(assetType("Windows Server 2019 Standard")).toBe("server");
    expect(assetType("Red Hat Enterprise Linux 8.6")).toBe("server");
    expect(assetType("Windows 11 Enterprise 64 bit Edition Version 23H2")).toBe("workstation");
    expect(assetType("macOS 14.2")).toBe("workstation");
    expect(assetType("Cisco IOS XE")).toBe("other");
    expect(assetType(null)).toBe("other");
  });

  it("compte les dérogations à part et suit les actifs les plus risqués", () => {
    const xml = detectionsXml(
      host(1, "srv1", detection(100, 5, 40) + detection(200, 4, 200).replace("<IS_IGNORED>0", "<IS_IGNORED>1"), "Windows Server 2019")
      + host(2, "pc2", detection(100, 5, 5)),
    );
    const p = detectionsPage(xml, NOW, ["1"]);
    expect(p.ignored).toEqual({ total: 1, sev5: 0, ages: [0, 0, 0, 1] });
    expect(p.byType.server).toEqual({ total: 1, overdue: 1, sev5: 1 });
    expect(p.byType.workstation).toEqual({ total: 1, overdue: 0, sev5: 1 });
    expect(p.watched["1"]).toEqual({ d5: 1, d4: 0, d3: 0, overdue: 1, qids: ["100"] });
    expect(p.watched["2"]).toBeUndefined();
    expect(p.qids["100"][6]).toBe(1); // une détection sur serveur
    expect(p.bySev[5].ageSum).toBeCloseTo(45);
  });

  it("applique les délais de la politique : 7 jours, 1 mois et 3 mois calendaires", () => {
    const t = (iso: string) => Date.parse(iso);
    expect(new Date(deadline(t("2026-11-02T10:00:00Z"), 5)).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(new Date(deadline(t("2026-01-15T08:00:00Z"), 4)).toISOString()).toBe("2026-02-15T08:00:00.000Z");
    // Fin de mois : 31 janvier + 1 mois -> 28 février
    expect(new Date(deadline(t("2026-01-31T08:00:00Z"), 4)).toISOString()).toBe("2026-02-28T08:00:00.000Z");
    expect(new Date(deadline(t("2026-11-30T08:00:00Z"), 3)).toISOString()).toBe("2027-02-28T08:00:00.000Z");
    expect(deadline(t("2026-11-30T08:00:00Z"), 2)).toBe(Infinity);
  });

  it("mesure les délais réels de correction (vulnérabilités corrigées)", () => {
    const fixed = (qid: number, sev: number, firstDays: number, fixedDays: number) => `
            <DETECTION><QID>${qid}</QID><TYPE>Confirmed</TYPE><SEVERITY>${sev}</SEVERITY><STATUS>Fixed</STATUS>
              <FIRST_FOUND_DATETIME>${daysAgo(firstDays)}</FIRST_FOUND_DATETIME><LAST_FIXED_DATETIME>${daysAgo(fixedDays)}</LAST_FIXED_DATETIME></DETECTION>`;
    const xml = detectionsXml(
      host(1, "srv1", fixed(1, 5, 25, 20) /* 5 j : dans le délai */ + fixed(2, 5, 60, 30) /* 30 j : hors délai */, "Ubuntu 22.04")
      + host(2, "pc2", fixed(3, 4, 50, 30) /* 20 j : dans le délai */ + fixed(4, 4, 300, 200) /* corrigée avant la période */),
    );
    const p = fixedPage(xml, NOW - 90 * 86400000);
    const rows = Object.values(p.cells);
    const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((t, r) => ({ n: t.n + r.n, in_sla: t.in_sla + r.in_sla, days_sum: t.days_sum + r.days_sum }), { n: 0, in_sla: 0, days_sum: 0 });
    expect(sum((r) => r.severity === 5)).toEqual({ n: 2, in_sla: 1, days_sum: 35 });
    expect(sum((r) => r.severity === 4)).toEqual({ n: 1, in_sla: 1, days_sum: 20 });
    expect(sum((r) => r.asset_type === "server")).toMatchObject({ n: 2, in_sla: 1 });
    expect(sum((r) => r.asset_type === "workstation")).toMatchObject({ n: 1, in_sla: 1 });
    // Borne haute : une correction lue après la fin de la période n'est pas comptée (elle le sera au calcul suivant)
    const late = fixedPage(xml, NOW - 90 * 86400000, NOW - 25 * 86400000);
    // Fin de période il y a 25 jours : les deux corrections d'il y a 30 jours comptent, celle d'il y a 20 jours attendra
    expect(Object.values(late.cells).reduce((t, r) => t + r.n, 0)).toBe(2);
    expect(medianOf({ 10: 1, 30: 1, 20: 1 })).toBe(20);
    expect(medianOf({})).toBeNull();
  });

  it("lit la base de connaissances : titre, CVE, CISA KEV, ransomware, corrigeable", () => {
    const vuln = (qid: number, intel: string[], patchable: number) => `<VULN><QID>${qid}</QID><VULN_TYPE>Vulnerability</VULN_TYPE><SEVERITY_LEVEL>5</SEVERITY_LEVEL><TITLE><![CDATA[Vuln ${qid}]]></TITLE><PATCHABLE>${patchable}</PATCHABLE><CVE_LIST><CVE><ID><![CDATA[CVE-2024-${qid}]]></ID><URL><![CDATA[https://nvd]]></URL></CVE></CVE_LIST><THREAT_INTELLIGENCE>${intel.map((t, i) => `<THREAT_INTEL id="${i}"><![CDATA[${t}]]></THREAT_INTEL>`).join("")}</THREAT_INTELLIGENCE></VULN>`;
    const kb = kbPage(`<KNOWLEDGE_BASE_VULN_LIST_OUTPUT><RESPONSE><VULN_LIST>${vuln(100, ["Cisa_Known_Exploited_Vulns", "Active_Attacks"], 1)}${vuln(200, ["Ransomware"], 0)}</VULN_LIST></RESPONSE></KNOWLEDGE_BASE_VULN_LIST_OUTPUT>`);
    expect(kb["100"]).toEqual(["Vuln 100", 1 | 4 | 8, "CVE-2024-100"]);
    expect(kb["200"]).toEqual(["Vuln 200", 2, "CVE-2024-200"]);
  });
});

describe("Qualys : photo", () => {
  it("réunit les pages et croise avec la base de connaissances", () => {
    const page1 = detectionsPage(detectionsXml(host(1, "pc1", detection(100, 5, 10, `<QDS severity="CRITICAL">95</QDS>`) + detection(200, 4, 100, `<QDS severity="CRITICAL">92</QDS>`))), NOW);
    const page2 = detectionsPage(detectionsXml(host(2, "pc2", detection(100, 5, 50)), false), NOW);
    const r = buildResults([
      { kind: "hosts", agg: { total: 4, agent: 3, scanned: 3, neverScanned: 1, trurisk: { critical: 0, high: 1, medium: 1, low: 2 } } },
      { kind: "detections", agg: JSON.parse(JSON.stringify(page1)) },
      { kind: "detections", agg: JSON.parse(JSON.stringify(page2)) },
      { kind: "kb", agg: { 100: ["Vuln 100", 1 | 4, "CVE-1"], 200: ["Vuln 200", 2, ""] } },
    ], NOW);
    expect(r.detections).toMatchObject({ total: 3, vulns: 2 });
    expect(r.severities.find((s) => s.severity === 5)).toMatchObject({ total: 2, overdue: 2, slaDays: 7, slaLabel: "7 jours" });
    // Sévérités 4 et 5, et part de sévérité 5 (« dont »), comme les filtres de la console
    expect(r.kev).toEqual({ detections: 2, vulns: 1, sev5: 2, servers: 0 });
    expect(r.ransomware).toEqual({ detections: 1, vulns: 1, sev5: 0, servers: 0 });
    expect(r.detections).toMatchObject({ qdsCritical: 2, qdsCriticalSev5: 1 });
    expect(r.criticalPatchableSev5).toBe(1);
    expect(r.hostsWithSev5).toBe(2);
    // QDS >= 90 et correctif disponible : seule la détection QDS 95 de QID 100 (QID 200 sans correctif)
    expect(r.criticalPatchable).toBe(1);
    expect(r.topVulns[0]).toMatchObject({ qid: "100", title: "Vuln 100", hosts: 2, overdue: 2, kev: true, patchable: true, firstFound: new Date(daysAgo(50)).toISOString() });
    expect(r.topHosts.map((h) => h.name)).toEqual(["pc1.corp.local", "pc2.corp.local"]);
    expect(summaryOf(r)).toMatchObject({ detections: 3, sev5: 2, sev4: 1, overdue: 3, kev: 2, coverage: 75, slaRate: null });
    // Vulnérabilités armées : KEV (100) et ransomware (200)
    expect(r.exposure.armed).toMatchObject({ detections: 3, vulns: 2, sev5: 2 });
    expect(r.exposure.topArmed.map((v) => v.qid)).toEqual(["100", "200"]);
    expect(r.operations.fixedCollected).toBe(false);
    // Index de recherche : une ligne par QID, sans nom de machine
    const idx = vulnIndex([
      { kind: "detections", agg: JSON.parse(JSON.stringify(page1)) },
      { kind: "detections", agg: JSON.parse(JSON.stringify(page2)) },
      { kind: "kb", agg: { 100: ["Vuln 100", 1 | 4, "CVE-1"] } },
    ]);
    expect(idx.find((v) => v.qid === 100)).toMatchObject({ hosts: 2, severity: 5, cves: "CVE-1", flags: 5 });
    expect(JSON.stringify(idx)).not.toContain("pc1");
  });

  it("réunit les délais de correction et les actifs les plus risqués", () => {
    const risk = { id: "1", name: "srv1", ip: null, os: "Windows Server 2019", type: "server", trurisk: 910, criticality: null, lastScan: null };
    const r = buildResults([
      { kind: "hosts", agg: { total: 1, agent: 1, scanned: 1, neverScanned: 0, trurisk: { critical: 1, high: 0, medium: 0, low: 0 }, truriskSum: 910, truriskCount: 1, topRisk: [risk] } },
      { kind: "detections", agg: { bySev: {}, qids: { 100: [2, 5, 1, 0, 0, 0, 1] }, watched: { 1: { d5: 2, d4: 0, overdue: 1, qids: ["100", "100"] } } } },
      { kind: "fixed", agg: { cells: { "2026-10-20|5|server": { day: "2026-10-20", severity: 5, asset_type: "server", n: 2, in_sla: 1, days_sum: 40, hist: { 10: 1, 30: 1 } } } } },
      { kind: "fixed", agg: { cells: { "2026-11-10|5|server": { day: "2026-11-10", severity: 5, asset_type: "server", n: 2, in_sla: 2, days_sum: 20, hist: { 10: 2 } } } } },
      { kind: "kb", agg: { 100: ["Vuln 100", 1, ""] } },
    ], NOW);
    expect(r.exposure.truriskAvg).toBe(910);
    expect(r.exposure.topRisk[0]).toMatchObject({ name: "srv1", d5: 2, overdue: 1, armed: 2 });
    expect(r.operations.fixed.bySev[5]).toEqual({ fixed: 4, inSla: 3, slaRate: 75, mttr: 15, median: 10 });
    // Octobre : premier mois des données, commencé le 20 (partiel) ; novembre est le mois en cours
    expect(r.operations.fixed.monthly).toEqual([
      { month: "2026-10", fixed: 2, slaRate: 50, mttr5: 20, mttr4: null, mttr3: null, partial: "start" },
      { month: "2026-11", fixed: 2, slaRate: 100, mttr5: 10, mttr4: null, mttr3: null, partial: "current" },
    ]);
    expect(summaryOf(r)).toMatchObject({ truriskAvg: 910, slaRate: 75, mttr5: 15 });
  });

  it("cumule les corrections jour par jour et se limite à 90 jours pour les délais", () => {
    const row = (day: string, n: number, inSla: number) => ({ day, severity: 5, asset_type: "server" as const, n, in_sla: inSla, days_sum: n * 10, hist: { 10: n } });
    expect(mergeFixedRows([row("2026-11-01", 2, 1), row("2026-11-01", 3, 3)])).toEqual([{ day: "2026-11-01", severity: 5, asset_type: "server", n: 5, in_sla: 4, days_sum: 50, hist: { 10: 5 } }]);
    // Table cumulée : une correction vieille de 6 mois compte pour l'évolution mensuelle, pas pour les 90 derniers jours
    const r = buildResults([], NOW, { fixedDaily: [row("2026-05-10", 4, 0), row("2026-11-01", 2, 2)] });
    expect(r.operations.fixed.all).toMatchObject({ fixed: 2, slaRate: 100 });
    expect(r.operations.fixed.monthly.map((m) => m.month)).toEqual(["2026-05", "2026-11"]);
    expect(r.operations.fixedCollected).toBe(true);
    expect(fixedRowsOfPages([{ kind: "fixed", agg: { cells: { a: row("2026-11-01", 1, 1) } } }])).toHaveLength(1);
  });

  it("formate les dates comme Qualys les attend (le curseur en base est en « +00:00 »)", () => {
    expect(qualysDate("2026-11-19T20:22:06.358+00:00")).toBe("2026-11-19T20%3A22%3A06Z");
    expect(decodeURIComponent(qualysDate("2026-11-19T20:22:06.358Z"))).toBe("2026-11-19T20:22:06Z");
    expect(qualysDate("2026-11-19T20:22:06.358+00:00")).not.toContain("+");
  });

  it("signale une lecture des corrigées en échec sans bloquer la photo", () => {
    const r = buildResults([{ kind: "fixederror", agg: { message: "parameter detection_updated_since has invalid value (code 1905)" } }], NOW,
      { fixedDaily: [{ day: "2026-11-01", severity: 5, asset_type: "server", n: 2, in_sla: 1, days_sum: 20, hist: { 10: 2 } }] });
    expect(r.operations.fixedError).toContain("code 1905");
    expect(r.operations.fixed.all).toMatchObject({ fixed: 2 }); // historique déjà en base
  });

  it("partage le parc en deux moitiés pour lire les vulnérabilités en parallèle", () => {
    expect(splitHosts([5, 1, 3])).toEqual([{}]); // petit parc : une seule lecture
    const ids = Array.from({ length: 1000 }, (_, i) => 1000 + i);
    expect(splitHosts(ids)).toEqual([{ max: 1499 }, { min: 1500 }]);
  });
});

describe("Qualys : obsolescence et conformité", () => {
  it("reconnaît les produits en fin de vie et compte les actifs concernés", () => {
    expect(isEol("EOL/Obsolete Operating System: Microsoft Windows Server 2012 R2 Detected")).toBe(true);
    expect(isEolOs("EOL/Obsolete Operating System: Microsoft Windows Server 2012 R2 Detected")).toBe(true);
    expect(isEol("EOL/Obsolete Software: Microsoft .NET Framework 4.5.2 Detected")).toBe(true);
    expect(isEolOs("EOL/Obsolete Software: Microsoft .NET Framework 4.5.2 Detected")).toBe(false);
    expect(isEol("Microsoft Windows Security Update")).toBe(false);
    const xml = detectionsXml(
      host(1, "srv1", detection(900, 5, 400) + detection(901, 4, 400), "Windows Server 2012 R2")
      + host(2, "pc2", detection(100, 5, 5)),
    );
    const p = detectionsPage(xml, NOW, [], ["900", "901"]);
    expect(p.eol).toEqual({ server: 1, workstation: 0, other: 0 }); // un actif, même avec deux produits
    const r = buildResults([
      { kind: "detections", agg: JSON.parse(JSON.stringify(p)) },
      { kind: "kb", agg: { 900: ["EOL/Obsolete Operating System: Windows Server 2012 R2 Detected", 0, ""], 901: ["EOL/Obsolete Software: .NET 4.5 Detected", 0, ""], 100: ["Autre", 0, ""] } },
    ], NOW);
    expect(r.obsolescence).toMatchObject({ hostsTracked: true, hosts: 1, products: 2, osProducts: 1, detections: 2 });
    expect(r.obsolescence.top[0]).toMatchObject({ title: "Windows Server 2012 R2 Detected", os: true, servers: 1 });
    expect(summaryOf(r).eolHosts).toBe(1);
  });

  it("regroupe les QID d'un même produit en fin de vie sans additionner les actifs", () => {
    const xml = detectionsXml(host(1, "pc1", detection(5003893, 5, 400) + detection(106247, 5, 400)) + host(2, "pc2", detection(106247, 5, 400)));
    const r = buildResults([
      { kind: "detections", agg: JSON.parse(JSON.stringify(detectionsPage(xml, NOW))) },
      { kind: "kb", agg: { 5003893: ["EOL/Obsolete Software: Microsoft .Net Version 6 Detected", 0, ""], 106247: ["EOL/Obsolete Software: Microsoft .Net Version 6 Detected", 0, ""] } },
    ], NOW);
    expect(r.obsolescence.products).toBe(1);
    expect(r.obsolescence.top).toHaveLength(1);
    expect(r.obsolescence.top[0]).toMatchObject({ title: "Microsoft .Net Version 6 Detected", hosts: 2, qid: "106247, 5003893" });
  });

  it("lit les politiques et l'état de conformité (Policy Audit)", () => {
    expect(policiesPage(`<POLICY_LIST_OUTPUT><RESPONSE><POLICY_LIST><POLICY><ID>11</ID><TITLE><![CDATA[CIS Windows Server 2019]]></TITLE></POLICY><POLICY><ID>12</ID><TITLE><![CDATA[ANSSI Linux]]></TITLE></POLICY></POLICY_LIST></RESPONSE></POLICY_LIST_OUTPUT>`))
      .toEqual([{ id: "11", title: "CIS Windows Server 2019" }, { id: "12", title: "ANSSI Linux" }]);
    const info = (h: number, c: number, st: string) => `<INFO><ID>${h}${c}</ID><HOST_ID>${h}</HOST_ID><CONTROL_ID>${c}</CONTROL_ID><TECHNOLOGY_ID>1</TECHNOLOGY_ID><STATUS>${st}</STATUS></INFO>`;
    const xml = `<COMPLIANCE_POSTURE_INFO_LIST_OUTPUT><RESPONSE><INFO_LIST>${info(1, 1001, "Passed")}${info(1, 1002, "Failed")}${info(2, 1001, "Passed")}${info(2, 1002, "Passed")}${info(2, 1003, "Error")}</INFO_LIST>
      <GLOSSARY><CONTROL_LIST><CONTROL><CID>1002</CID><STATEMENT><![CDATA[Status of the 'Minimum password length' setting]]></STATEMENT><CRITICALITY><LABEL>SERIOUS</LABEL><VALUE>3</VALUE></CRITICALITY></CONTROL></CONTROL_LIST></GLOSSARY></RESPONSE></COMPLIANCE_POSTURE_INFO_LIST_OUTPUT>`;
    const p = posturePage(xml, "11");
    expect(p).toMatchObject({ policyId: "11", hosts: 2, compliantHosts: 1, passed: 3, failed: 1, errors: 1 });
    expect(p).toMatchObject({ records: 5, raw: 5, root: "COMPLIANCE_POSTURE_INFO_LIST_OUTPUT" });
    expect(p.controls["1002"]).toEqual([1, 1, 0]);
    const r = buildResults([
      { kind: "policies", agg: { list: [{ id: "11", title: "CIS Windows Server 2019" }] } },
      { kind: "posture", agg: JSON.parse(JSON.stringify(p)) },
    ], NOW);
    expect(r.compliance).toMatchObject({ collected: true, error: null, rate: 75, passed: 3, failed: 1 });
    expect(r.compliance.policies[0]).toMatchObject({ title: "CIS Windows Server 2019", rate: 75, compliantHosts: 1 });
    expect(r.compliance.topFailed[0]).toMatchObject({ cid: "1002", statement: "Status of the 'Minimum password length' setting", criticality: "SERIOUS", failed: 1, rate: 50 });
    expect(summaryOf(r).complianceRate).toBe(75);
  });

  it("ne compte que les politiques entièrement lues et reprend les autres avec leur date", () => {
    const pos = (policyId: string, passed: number, failed: number) => ({ policyId, hosts: 1, compliantHosts: failed ? 0 : 1, passed, failed, errors: 0, controls: {}, glossary: {} });
    const r = buildResults([
      { kind: "policies", agg: { list: [{ id: "1", title: "CIS A" }, { id: "2", title: "CIS B" }, { id: "3", title: "CIS C" }] } },
      { kind: "posture", agg: pos("1", 8, 2) },
      { kind: "posture", agg: pos("2", 1, 9) }, // lecture interrompue : ignorée
      { kind: "pcmeta", agg: { done: ["1"], total: 3, stopped: true } },
    ], NOW, { previousPolicies: [
      { id: "2", title: "CIS B", hosts: 4, compliantHosts: 1, passed: 50, failed: 50, errors: 0, rate: 50, evaluatedAt: "2026-11-15T03:00:00Z" },
      { id: "1", title: "CIS A", hosts: 1, compliantHosts: 0, passed: 1, failed: 1, errors: 0, rate: 50, evaluatedAt: "2026-11-15T03:00:00Z" },
    ] });
    expect(r.compliance).toMatchObject({ evaluated: 1, total: 3, stopped: true });
    const byId = Object.fromEntries(r.compliance.policies.map((p) => [p.id, p]));
    expect(byId["1"]).toMatchObject({ rate: 80, stale: false }); // réévaluée cette nuit
    expect(byId["2"]).toMatchObject({ rate: 50, stale: true, evaluatedAt: "2026-11-15T03:00:00Z" }); // dernier résultat connu
    expect(byId["3"]).toBeUndefined(); // jamais évaluée
    expect(r.compliance.rate).toBe(52.7); // (8 + 50) / (10 + 100)
  });

  it("signale une conformité indisponible sans bloquer la photo", () => {
    const r = buildResults([{ kind: "pcerror", agg: { message: "User is not authorized (code 2002)" } }], NOW);
    expect(r.compliance).toMatchObject({ collected: true, error: "User is not authorized (code 2002)", rate: null, policies: [] });
    expect(buildResults([], NOW).compliance.collected).toBe(false);
  });
});

describe("Qualys : inventaire (CSAM), exposition Internet et applications web (WAS)", () => {
  it("reconnaît une adresse IP publique", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("185.12.40.3")).toBe(true);
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "999.1.1.1", "", null]) expect(isPublicIp(ip)).toBe(false);
    expect(isPublicIp("172.32.0.1")).toBe(true);
  });

  it("lit une page d'actifs CSAM : agents, Shadow IT, systèmes hors support", () => {
    const day = 86400000;
    const iso = (d: number) => new Date(NOW - d * day).toISOString();
    const json = {
      responseCode: "SUCCESS", hasMore: 1, lastSeenAssetId: 3003,
      assetListData: { asset: [
        { assetId: 1, assetName: "srv1", address: "10.0.0.1", operatingSystem: { osName: "Windows Server 2012 R2", lifecycle: { stage: "EOS", eosDate: "2023-10-10T00:00:00Z" } },
          sensor: { hasAgent: true }, agent: { lastCheckedIn: { dateTime: iso(10) } } },
        { assetId: 2, assetName: "pc2", address: "10.0.0.2", operatingSystem: { osName: "Windows 11 Enterprise", lifecycle: { stage: "GA" } },
          sensor: { hasAgent: true }, agent: { lastCheckedIn: { dateTime: iso(1) } } },
        { assetId: 3003, assetName: "inconnu", address: "185.1.2.3", operatingSystem: { osName: "Linux 3.x" },
          sensor: { hasAgent: false, hasNetworkScanner: false, hasPassiveSensor: true }, inventory: { source: "PASSIVE_SENSOR", created: iso(3) } },
      ] },
    };
    const { agg, next } = csamPage(json, NOW);
    expect(next).toBe("3003");
    expect(agg).toMatchObject({ total: 3, withAgent: 2, agentStale: 1, unmanaged: 1, unmanagedNew: 1, publicIp: 1, osEos: 1 });
    expect(agg.os["Windows Server 2012 R2"][0]).toBe(1);
    expect(agg.recentUnmanaged[0]).toMatchObject({ name: "inconnu", source: "PASSIVE_SENSOR" });
    expect(csamPage({ hasMore: 0, assetListData: { asset: [] } }, NOW).next).toBeNull();
    const r = buildResults([{ kind: "csam", agg: JSON.parse(JSON.stringify(agg)) }], NOW);
    expect(r.inventory).toMatchObject({ collected: true, total: 3, unmanaged: 1, osEos: 1 });
    expect(r.inventory.osOutdated[0]).toMatchObject({ os: "Windows Server 2012 R2", assets: 1, endOfSupport: "2023-10-10" });
    expect(summaryOf(r).unmanaged).toBe(1);
  });

  it("lit les vulnérabilités des applications web (WAS)", () => {
    const f = (id: number, sev: number, status: string, app: string, firstDays: number, extra = "") => `<Finding><id>${id}</id><qid>150001</qid><type>VULNERABILITY</type><severity>${sev}</severity><status>${status}</status>
      <webApp><id>${app}</id><name><![CDATA[Appli ${app}]]></name></webApp><firstDetectedDate>${daysAgo(firstDays)}</firstDetectedDate>${extra}</Finding>`;
    const xml = `<ServiceResponse><responseCode>SUCCESS</responseCode><count>4</count><hasMoreRecords>true</hasMoreRecords><lastId>14</lastId><data>
      ${f(11, 5, "ACTIVE", "1", 20, "<owasp><list><OWASP><name>A03 Injection</name></OWASP></list></owasp>")}
      ${f(12, 3, "NEW", "1", 2)}
      ${f(13, 4, "ACTIVE", "2", 5)}
      ${f(14, 5, "FIXED", "2", 30, `<lastTestedDate>${daysAgo(25)}</lastTestedDate>`)}
    </data></ServiceResponse>`;
    const { agg, next } = wasPage(xml, NOW, NOW - 90 * 86400000);
    expect(next).toBe("14");
    expect(agg.open).toBe(3);
    expect(agg.apps["1"]).toEqual(["Appli 1", 1, 0, 1, 1]); // critique ouverte depuis 20 j > 7 j
    expect(agg.apps["2"]).toEqual(["Appli 2", 0, 1, 0, 0]);
    expect(agg.owasp).toEqual({ "A03 Injection": 1 });
    expect(agg.fix).toMatchObject({ n: 1, inSla: 1, daysSum: 5 });
    const r = buildResults([{ kind: "was", agg: JSON.parse(JSON.stringify(agg)) }], NOW);
    expect(r.webApps.apps[0]).toMatchObject({ name: "Appli 1", sev5: 1 });
    expect(r.webApps.fixed).toMatchObject({ fixed: 1, mttr: 5, slaRate: 100 });
    expect(summaryOf(r).webAppsCritical).toBe(1);
  });

  it("signale CSAM ou WAS indisponibles sans bloquer la photo", () => {
    const r = buildResults([{ kind: "csamerror", agg: { message: "CSAM : HTTP 403" } }, { kind: "waserror", agg: { message: "WAS : UNAUTHORIZED" } }], NOW);
    expect(r.inventory).toMatchObject({ collected: true, error: "CSAM : HTTP 403" });
    expect(r.webApps).toMatchObject({ collected: true, error: "WAS : UNAUTHORIZED" });
    expect(summaryOf(r)).toMatchObject({ unmanaged: null, webAppsCritical: null });
  });
});

describe("Qualys : diagnostic des accès et écran", () => {
  it("distingue autorisé, refusé et à vérifier", () => {
    expect(classify(200, "<HOST_LIST_OUTPUT><RESPONSE></RESPONSE></HOST_LIST_OUTPUT>").status).toBe("ok");
    expect(classify(200, "<ServiceResponse><responseCode>SUCCESS</responseCode><count>42</count></ServiceResponse>")).toEqual({ status: "ok", detail: "Autorisé", count: 42 });
    expect(classify(200, "<ServiceResponse><responseCode>UNAUTHORIZED</responseCode></ServiceResponse>").status).toBe("refused");
    expect(classify(401, "").status).toBe("refused");
    expect(classify(200, "<SIMPLE_RETURN><RESPONSE><CODE>2002</CODE><TEXT>User is not authorized to access this module</TEXT></RESPONSE></SIMPLE_RETURN>").status).toBe("refused");
    expect(classify(404, "").status).toBe("unknown");
    expect(classify(409, "").status).toBe("error");
    expect(classify(200, `{"responseCode":"SUCCESS","count":7}`)).toEqual({ status: "ok", detail: "Autorisé", count: 7 });
  });

  it("trouve une politique quel que soit le format de la liste", () => {
    const xml = `<POLICY_LIST_OUTPUT><RESPONSE><POLICY_LIST><POLICY>
      <ID><![CDATA[4521]]></ID><TITLE><![CDATA[CIS Windows]]></TITLE><CREATED><DATETIME>x</DATETIME></CREATED></POLICY></POLICY_LIST></RESPONSE></POLICY_LIST_OUTPUT>`;
    expect(policiesPage(xml)[0]?.id).toBe("4521");
  });

  it("déduit l'adresse de la Gateway", () => {
    expect(gatewayUrl("https://qualysapi.qg2.apps.qualys.eu")).toBe("https://gateway.qg2.apps.qualys.eu");
    expect(gatewayUrl("https://qualysapi.qg2.apps.qualys.eu", "https://gw.example/")).toBe("https://gw.example");
  });

  it("mesure l'avancement de la correction et la tendance", () => {
    expect(remediationProgress([{ hosts: 100 }, { hosts: 120 }, { hosts: 30 }])).toEqual({ peak: 120, now: 30, pct: 75 });
    expect(remediationProgress([]).pct).toBeNull();
    const now = Date.parse("2026-11-19T00:00:00Z");
    const pts = [{ date: "2026-10-01T00:00:00Z", truriskAvg: 900 }, { date: "2026-11-01T00:00:00Z", truriskAvg: 650 }, { date: "2026-11-18T00:00:00Z", truriskAvg: 600 }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(trendOver(pts as any, "truriskAvg", 30, now)).toBe(-50); // le point d'octobre est hors fenêtre
  });
});

describe("mergePosture", () => {
  it("cumule les pages d'une politique interrompue", () => {
    const a = { policyId: "11", hosts: 2, compliantHosts: 1, passed: 5, failed: 1, errors: 0, controls: { "100": [3, 1, 0] }, glossary: { "100": ["Mot de passe", "HIGH"] } };
    const b = { policyId: "11", hosts: 3, compliantHosts: 3, passed: 4, failed: 0, errors: 1, controls: { "100": [2, 0, 0], "200": [2, 0, 1] }, glossary: { "200": ["Pare-feu", null] } };
    const m = mergePosture([a, b])!;
    expect(m).toMatchObject({ policyId: "11", hosts: 5, compliantHosts: 4, passed: 9, failed: 1, errors: 1 });
    expect(m.controls).toEqual({ "100": [5, 1, 0], "200": [2, 0, 1] });
    expect(Object.keys(m.glossary)).toEqual(["100", "200"]);
    expect(m).toMatchObject({ records: 0, raw: 0 });
    expect(mergePosture([])).toBeNull();
  });
});

describe("détail de la photo", () => {
  it("garde les attributs simples d'un bloc, hors listes ignorées", () => {
    const x = `<ID>12</ID><DNS><![CDATA[srv01.als.lan]]></DNS><TAGS><TAG><NAME>Prod</NAME></TAG></TAGS><OS>Windows</OS><EMPTY></EMPTY>`;
    expect(leaves(x, ["TAGS"])).toEqual({ ID: "12", DNS: "srv01.als.lan", OS: "Windows" });
  });

  it("fiche actif et vulnérabilités par actif", () => {
    const hosts = `<HOST_LIST><HOST><ID>7</ID><ASSET_ID>99</ASSET_ID><IP>10.0.0.7</IP><TRACKING_METHOD>QAGENT</TRACKING_METHOD><DNS>srv07</DNS><OS>Windows Server 2019</OS>
      <TRURISK_SCORE>880</TRURISK_SCORE><ASSET_CRITICALITY_SCORE>4</ASSET_CRITICALITY_SCORE><LAST_VULN_SCAN_DATETIME>${daysAgo(2)}</LAST_VULN_SCAN_DATETIME>
      <TAGS><TAG><TAG_ID>1</TAG_ID><NAME>Production</NAME></TAG></TAGS></HOST></HOST_LIST>`;
    const h = hostsPage(hosts, NOW);
    expect(h.rows[0]).toMatchObject({ host_id: 7, asset_id: 99, name: "srv07", asset_type: "server", trurisk: 880, criticality: 4, tags: ["Production"], public_ip: false });
    expect(h.rows[0].attrs.TRACKING_METHOD).toBe("QAGENT");
    const det = `<HOST_LIST><HOST><ID>7</ID><IP>10.0.0.7</IP><OS>Windows Server 2019</OS><DETECTION_LIST>
      ${detection(101, 5, 20)}${detection(102, 4, 3, "<PORT>443</PORT>")}${detection(103, 3, 1, "").replace("<IS_IGNORED>0</IS_IGNORED>", "<IS_IGNORED>1</IS_IGNORED>")}
      </DETECTION_LIST></HOST></HOST_LIST>`;
    const d = detectionsPage(det, NOW);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ host_id: 7, d5: 1, d4: 1, d3: 0, overdue: 1, ignored: 1, qids: [101, 102] });
    expect(d.rows[0].detections[1]).toEqual([102, 4, daysAgo(3).slice(0, 10), daysAgo(1).slice(0, 10), "A", 0, 0, 0, 443]);
    expect(d.rows[0].detections[2][4]).toBe("I");
  });

  it("fiche de vulnérabilité de la base de connaissances", () => {
    const xml = `<VULN><QID>101</QID><VULN_TYPE>Vulnerability</VULN_TYPE><SEVERITY_LEVEL>5</SEVERITY_LEVEL><TITLE><![CDATA[Apache Log4j RCE]]></TITLE>
      <CATEGORY>Local</CATEGORY><PUBLISHED_DATETIME>2021-12-10T00:00:00Z</PUBLISHED_DATETIME><PATCHABLE>1</PATCHABLE>
      <SOFTWARE_LIST><SOFTWARE><PRODUCT><![CDATA[log4j]]></PRODUCT><VENDOR><![CDATA[apache]]></VENDOR></SOFTWARE></SOFTWARE_LIST>
      <SOLUTION><![CDATA[Mettre à jour vers <b>2.17</b>.<br/>Voir l'éditeur &amp; co.]]></SOLUTION>
      <CVE_LIST><CVE><ID><![CDATA[CVE-2021-44228]]></ID></CVE></CVE_LIST><CVSS_V3><BASE>10.0</BASE></CVSS_V3>
      <THREAT_INTELLIGENCE><THREAT_INTEL id="3"><![CDATA[Cisa_Known_Exploited_Vulns]]></THREAT_INTEL></THREAT_INTELLIGENCE></VULN>`;
    const [k] = kbDetails(xml);
    expect(k).toMatchObject({ qid: 101, severity: 5, title: "Apache Log4j RCE", cvss3: 10, cves: ["CVE-2021-44228"], products: [["apache", "log4j"]], category: "Local" });
    expect(k.flags & 1).toBe(1);
    expect(k.solution).toBe("Mettre à jour vers 2.17.\nVoir l'éditeur & co.");
  });

  it("inventaire des applications web", () => {
    const xml = `<ServiceResponse><responseCode>SUCCESS</responseCode><count>1</count><hasMoreRecords>true</hasMoreRecords><lastId>55</lastId><data>
      <WebApp><id>55</id><name><![CDATA[Portail]]></name><url><![CDATA[https://portail.example]]></url><tags><count>1</count><list><Tag><id>1</id><name>Internet</name></Tag></list></tags>
      <createdDate>2025-01-02T00:00:00Z</createdDate></WebApp></data></ServiceResponse>`;
    const r = wasAppsPage(xml);
    expect(r.next).toBe("55");
    expect(r.rows[0]).toMatchObject({ app_id: 55, name: "Portail", url: "https://portail.example", tags: ["Internet"] });
  });

  it("inventaire CSAM et copie allégée", () => {
    const json = { responseCode: "SUCCESS", hasMore: 0, assetListData: { asset: [{
      assetId: 5, hostId: 7, assetName: "pc01", address: "10.1.1.1", operatingSystem: { osName: "Windows 10 Pro", lifecycle: { stage: "EOL/EOS", eosDate: "2025-10-14T00:00:00Z" } },
      sensor: { hasAgent: true }, agent: { lastCheckedIn: { dateTime: daysAgo(1) } }, softwareListData: { software: [{ name: "x" }] },
    }] } };
    const { rows } = csamPage(json, NOW);
    expect(rows[0]).toMatchObject({ asset_id: 5, host_id: 7, name: "pc01", asset_type: "workstation", has_agent: true, lifecycle_stage: "EOL/EOS" });
    expect(rows[0].attrs.softwareListData).toBeUndefined();
    expect(trimJson({ a: Array.from({ length: 30 }, (_, i) => i) })).toEqual({ a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  });
});

describe("conformité paginée par enregistrement", () => {
  it("compte une seule fois un actif réparti sur deux pages", () => {
    const info = (h: number, c: number, st: string) => `<INFO><ID>${h}${c}</ID><HOST_ID>${h}</HOST_ID><CONTROL_ID>${c}</CONTROL_ID><STATUS>${st}</STATUS></INFO>`;
    const page = (items: string) => `<POSTURE_INFO_LIST_OUTPUT><RESPONSE><INFO_LIST>${items}</INFO_LIST></RESPONSE></POSTURE_INFO_LIST_OUTPUT>`;
    const p1 = posturePage(page(info(1, 10, "Passed") + info(1, 11, "Passed") + info(2, 10, "Passed")), "7");
    const p2 = posturePage(page(info(2, 11, "Failed") + info(3, 10, "Passed")), "7");
    expect(p1).toMatchObject({ hosts: 2, compliantHosts: 2 });
    expect(mergePosture([p1, p2])).toMatchObject({ hosts: 3, compliantHosts: 2, passed: 4, failed: 1 });
    const r = buildResults([
      { kind: "policies", agg: { list: [{ id: "7", title: "CIS Windows" }] } },
      { kind: "posture", agg: p1 }, { kind: "posture", agg: p2 },
      { kind: "pcmeta", agg: { done: ["7"], total: 1, stopped: false } },
    ], Date.parse("2026-11-24T00:00:00Z"));
    expect(r.compliance.policies[0]).toMatchObject({ id: "7", hosts: 3, compliantHosts: 2, passed: 4, failed: 1 });
  });
});
