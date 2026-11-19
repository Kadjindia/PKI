import { describe, it, expect } from "vitest";
import {
  tag, qualysError, nextPageUrl, hostsPage, detectionsPage, fixedPage, kbPage, buildResults, summaryOf, vulnIndex, assetType, medianOf,
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
    expect(p.bySev[5]).toMatchObject({ total: 3, overdue: 1, ages: [2, 1, 0, 0] }); // 40 j > 15 j
    expect(p.bySev[4]).toMatchObject({ total: 1, overdue: 1, ages: [0, 0, 0, 1] }); // ignorée exclue, sévérité 3 ignorée
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
    expect(p.watched["1"]).toEqual({ d5: 1, d4: 0, overdue: 1, qids: ["100"] });
    expect(p.watched["2"]).toBeUndefined();
    expect(p.qids["100"][6]).toBe(1); // une détection sur serveur
    expect(p.bySev[5].ageSum).toBeCloseTo(45);
  });

  it("mesure les délais réels de correction (vulnérabilités corrigées)", () => {
    const fixed = (qid: number, sev: number, firstDays: number, fixedDays: number) => `
            <DETECTION><QID>${qid}</QID><TYPE>Confirmed</TYPE><SEVERITY>${sev}</SEVERITY><STATUS>Fixed</STATUS>
              <FIRST_FOUND_DATETIME>${daysAgo(firstDays)}</FIRST_FOUND_DATETIME><LAST_FIXED_DATETIME>${daysAgo(fixedDays)}</LAST_FIXED_DATETIME></DETECTION>`;
    const xml = detectionsXml(
      host(1, "srv1", fixed(1, 5, 30, 20) /* 10 j : dans le délai */ + fixed(2, 5, 60, 30) /* 30 j : hors délai */, "Ubuntu 22.04")
      + host(2, "pc2", fixed(3, 4, 50, 30) /* 20 j : dans le délai */ + fixed(4, 4, 300, 200) /* corrigée avant la période */),
    );
    const p = fixedPage(xml, NOW - 90 * 86400000);
    expect(p.bySev[5]).toMatchObject({ n: 2, inSla: 1, daysSum: 40 });
    expect(p.bySev[4]).toMatchObject({ n: 1, inSla: 1, daysSum: 20 });
    expect(p.byType.server).toMatchObject({ n: 2, inSla: 1 });
    expect(p.byType.workstation).toMatchObject({ n: 1, inSla: 1 });
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
    expect(r.severities.find((s) => s.severity === 5)).toMatchObject({ total: 2, overdue: 1, slaDays: 15 });
    // Sévérités 4 et 5, et part de sévérité 5 (« dont »), comme les filtres de la console
    expect(r.kev).toEqual({ detections: 2, vulns: 1, sev5: 2, servers: 0 });
    expect(r.ransomware).toEqual({ detections: 1, vulns: 1, sev5: 0, servers: 0 });
    expect(r.detections).toMatchObject({ qdsCritical: 2, qdsCriticalSev5: 1 });
    expect(r.criticalPatchableSev5).toBe(1);
    expect(r.hostsWithSev5).toBe(2);
    // QDS >= 90 et correctif disponible : seule la détection QDS 95 de QID 100 (QID 200 sans correctif)
    expect(r.criticalPatchable).toBe(1);
    expect(r.topVulns[0]).toMatchObject({ qid: "100", title: "Vuln 100", hosts: 2, overdue: 1, kev: true, patchable: true, firstFound: new Date(daysAgo(50)).toISOString() });
    expect(r.topHosts.map((h) => h.name)).toEqual(["pc1.corp.local", "pc2.corp.local"]);
    expect(summaryOf(r)).toMatchObject({ detections: 3, sev5: 2, sev4: 1, overdue: 2, kev: 2, coverage: 75, slaRate: null });
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
      { kind: "fixed", agg: { bySev: { 5: { n: 2, inSla: 1, daysSum: 40, hist: { 10: 1, 30: 1 } } }, byType: {}, months: { "2026-10": { 5: [2, 1, 40] } } } },
      { kind: "fixed", agg: { bySev: { 5: { n: 2, inSla: 2, daysSum: 20, hist: { 10: 2 } } }, byType: {}, months: { "2026-11": { 5: [2, 2, 20] } } } },
      { kind: "kb", agg: { 100: ["Vuln 100", 1, ""] } },
    ], NOW);
    expect(r.exposure.truriskAvg).toBe(910);
    expect(r.exposure.topRisk[0]).toMatchObject({ name: "srv1", d5: 2, overdue: 1, armed: 2 });
    expect(r.operations.fixed.bySev[5]).toEqual({ fixed: 4, inSla: 3, slaRate: 75, mttr: 15, median: 10 });
    expect(r.operations.fixed.monthly).toEqual([
      { month: "2026-10", fixed: 2, slaRate: 50, mttr5: 20, mttr4: null },
      { month: "2026-11", fixed: 2, slaRate: 100, mttr5: 10, mttr4: null },
    ]);
    expect(summaryOf(r)).toMatchObject({ truriskAvg: 910, slaRate: 75, mttr5: 15 });
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
