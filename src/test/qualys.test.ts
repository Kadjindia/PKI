import { describe, it, expect } from "vitest";
import {
  tag, qualysError, nextPageUrl, hostsPage, detectionsPage, kbPage, buildResults, summaryOf,
} from "../../supabase/functions/qualys-proxy/parse";

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

const host = (id: number, name: string, dets: string) => `
      <HOST>
        <ID>${id}</ID>
        <IP>10.0.0.${id % 250}</IP>
        <TRACKING_METHOD>Cloud Agent</TRACKING_METHOD>
        <OS><![CDATA[Windows 11 Enterprise]]></OS>
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
    expect(p).toEqual({ total: 3, agent: 1, scanned: 1, neverScanned: 1, trurisk: { critical: 1, high: 1, medium: 0, low: 1 } });
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
    expect(r.kev).toEqual({ detections: 2, vulns: 1 });
    expect(r.ransomware).toEqual({ detections: 1, vulns: 1 });
    // QDS >= 90 et correctif disponible : seule la détection QDS 95 de QID 100 (QID 200 sans correctif)
    expect(r.criticalPatchable).toBe(1);
    expect(r.topVulns[0]).toMatchObject({ qid: "100", title: "Vuln 100", hosts: 2, overdue: 1, kev: true, patchable: true, firstFound: new Date(daysAgo(50)).toISOString() });
    expect(r.topHosts.map((h) => h.name)).toEqual(["pc1.corp.local", "pc2.corp.local"]);
    expect(summaryOf(r)).toMatchObject({ detections: 3, sev5: 2, sev4: 1, overdue: 2, kev: 2, coverage: 75 });
  });
});
