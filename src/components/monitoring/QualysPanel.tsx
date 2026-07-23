import React from "react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  ServerCrash, ShieldCheck, Activity, TrendingDown,
  FileWarning, ShieldAlert, Clock, AlertTriangle,
  CheckCircle2, Target // <-- Target a été ajouté ici !
} from "lucide-react";

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, Cell
} from "recharts";

export default function QualysPanel() {
  // --- MOCK DATA ENTERPRISE (Scale : 4000 utilisateurs / 4850 actifs) ---
  const data = {
    // 1. KPI Globaux
    kpis: {
      totalAssets: 4850,
      scanCoverage: 94,
      criticalVulns: 3450,
      highVulns: 12400,
      compliancePCI: 88,
      complianceCIS: 75
    },

    // 2. Tendances & Aging
    trends: {
      agingData: [
        { range: "0-15j", vulns: 1200 },
        { range: "16-30j", vulns: 950 },
        { range: "31-60j", vulns: 600 },
        { range: "61-90j", vulns: 400 },
        { range: ">90j", vulns: 300 }
      ],
      vulnEvolution: [
        { month: 'Jan', critical: 3800, high: 14000 },
        { month: 'Fév', critical: 3650, high: 13500 },
        { month: 'Mar', critical: 3500, high: 13000 },
        { month: 'Avr', critical: 3550, high: 12800 },
        { month: 'Mai', critical: 3400, high: 12500 },
        { month: 'Juin', critical: 3450, high: 12400 }
      ]
    },

    // 3. Dérive des SLA (MTTR)
    slaBreaches: [
      { severity: "Critique (CVSS 9.0-10)", mttrReal: "18 jours", slaTarget: "14 jours", diff: "+4j", status: "Hors SLA" },
      { severity: "Élevé (CVSS 7.0-8.9)", mttrReal: "35 jours", slaTarget: "30 jours", diff: "+5j", status: "Hors SLA" },
      { severity: "Moyen (CVSS 4.0-6.9)", mttrReal: "65 jours", slaTarget: "60 jours", diff: "+5j", status: "Hors SLA" },
      { severity: "Faible (CVSS 0-3.9)", mttrReal: "110 jours", slaTarget: "120 jours", diff: "-10j", status: "Conforme" }
    ],

    // 4. Score de Risque par Groupe d'actifs
    assetRiskGroups: [
      { group: "Serveurs Web Externes (DMZ)", score: 9.2, activeCritical: 450, desc: "Exposition directe sur Internet." },
      { group: "Active Directory / Core IT", score: 8.5, activeCritical: 25, desc: "Cœur de réseau, risque de mouvement latéral." },
      { group: "Postes Utilisateurs (LAN)", score: 6.8, activeCritical: 1800, desc: "Vecteur principal d'hameçonnage." },
      { group: "Serveurs Bases de Données", score: 4.1, activeCritical: 15, desc: "Ségrégation réseau forte, non exposé." },
      { group: "Systèmes Industriels (OT)", score: 9.5, activeCritical: 110, desc: "Systèmes non patchables (Legacy)." }
    ],

    // 5. Dette Technique (Top Récurrentes)
    topRecurringDette: [
      { cve: "CVE-2017-0144 (MS17-010 / EternalBlue)", age: 3150, affectedAssets: 12, reason: "OS Legacy Windows 7/2008" },
      { cve: "CVE-2021-44228 (Log4Shell)", age: 950, affectedAssets: 45, reason: "Application métier propriétaire (non maintenue)" },
      { cve: "CVE-2022-26809 (RabbitMQ)", age: 800, affectedAssets: 3, reason: "Défaut de responsabilité (Pas de propriétaire de l'actif)" }
    ],

    // 6. Vulnérabilités Critiques Actionnables
    actionableVulns: [
      { cve: "CVE-2024-21412", title: "Windows Defender SmartScreen Bypass", cvss: 9.8, affected: 850, cisaKev: true, exploitStatus: "Exploité in the wild" },
      { cve: "CVE-2023-46805", title: "Ivanti Connect Secure Authentication Bypass", cvss: 9.1, affected: 4, cisaKev: true, exploitStatus: "Exploité in the wild" },
      { cve: "CVE-2024-27198", title: "JetBrains TeamCity Auth Bypass", cvss: 9.8, affected: 12, cisaKev: true, exploitStatus: "PoC Public Disponible" },
      { cve: "CVE-2024-3094", title: "XZ Utils Backdoor", cvss: 10.0, affected: 0, cisaKev: false, exploitStatus: "Corrigé préventivement" },
      { cve: "CVE-2023-3519", title: "Citrix NetScaler ADC RCE", cvss: 9.8, affected: 2, cisaKev: true, exploitStatus: "Exploité in the wild" }
    ]
  };

  return (
    <div className="space-y-6">

      {/* ==============================================================================
          1. BANDEAU SUPÉRIEUR PERMANENT (EXECUTIVE SUMMARY QUALYS)
          ============================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        <Card className="border-l-4 border-l-emerald-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Couverture Scan</CardTitle>
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-foreground">{data.kpis.scanCoverage}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Basé sur {data.kpis.totalAssets} actifs connus</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Conformité Régalienne</CardTitle>
            <CheckCircle2 className="w-5 h-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 mt-1 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">PCI-DSS:</span>
                <span className="font-black text-foreground">{data.kpis.compliancePCI}%</span>
              </div>
              <div className="flex justify-between items-center border-t border-border pt-2">
                <span className="text-muted-foreground font-medium">CIS Benchmarks:</span>
                <span className="font-black text-orange-500">{data.kpis.complianceCIS}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-orange-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">MTTR (Critiques)</CardTitle>
            <Clock className="w-5 h-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-orange-500">18 j</span>
              <span className="text-xs text-muted-foreground font-medium">Temps moyen</span>
            </div>
            <p className="text-[11px] text-destructive font-medium flex items-center mt-2"><AlertTriangle className="w-3.5 h-3.5 mr-1"/> Hors SLA (Cible: 14j)</p>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-destructive bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Dette Critique</CardTitle>
            <ServerCrash className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.criticalVulns.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground font-medium">CVEs ouvertes</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Plus {data.kpis.highVulns.toLocaleString()} vulnérabilités hautes</p>
          </CardContent>
        </Card>

      </div>

      {/* ==============================================================================
          2. SECTION : TENDANCES ET AGING (OUVERTE PAR DÉFAUT)
          ============================================================================== */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" /> 2. Évolution de la Dette & Vieillissement (Aging)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Graphique d'évolution des vulnérabilités */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4 text-center">Tendance des Vulnérabilités Actives (6 Mois)</h4>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trends.vulnEvolution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.1} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend verticalAlign="top" height={36}/>
                    <Line type="monotone" dataKey="critical" name="Critiques" stroke="#ef4444" strokeWidth={3} dot={{r: 4, fill: '#ef4444'}} />
                    <Line type="monotone" dataKey="high" name="Hautes" stroke="#f97316" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar Chart Aging */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4 text-center">Vieillissement des Vulnérabilités Critiques (Aging)</h4>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trends.agingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.2} />
                    <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="vulns" name="Nb de Vulnérabilités" fill="#ef4444" radius={[4, 4, 0, 0]}>
                      {data.trends.agingData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index > 3 ? '#7f1d1d' : index > 2 ? '#b91c1c' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ==============================================================================
          3. SECTION : DÉRIVE DES SLA (OUVERTE PAR DÉFAUT)
          ============================================================================== */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-destructive" /> 3. Dérive des SLA de Remédiation (Patch Management)
          </CardTitle>
          <Badge variant="destructive">Retard Global Constaté</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/5">
                <TableHead className="pl-6">Niveau de Criticité</TableHead>
                <TableHead>MTTR Réel (Moyenne)</TableHead>
                <TableHead>SLA Interne (Objectif)</TableHead>
                <TableHead>Écart / Dérive</TableHead>
                <TableHead>Statut de Conformité</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.slaBreaches.map((sla, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6 font-bold text-sm">{sla.severity}</TableCell>
                  <TableCell className={`font-bold ${sla.status === 'Hors SLA' ? 'text-destructive' : 'text-emerald-500'}`}>{sla.mttrReal}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{sla.slaTarget}</TableCell>
                  <TableCell className="font-mono text-xs">{sla.diff}</TableCell>
                  <TableCell>
                    <Badge variant={sla.status === 'Hors SLA' ? 'destructive' : 'outline'} className={sla.status !== 'Hors SLA' ? 'border-emerald-500 text-emerald-500' : ''}>
                      {sla.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ==============================================================================
          ACCORDÉONS TECHNIQUES (4 À 6)
          ============================================================================== */}
      <Accordion type="multiple" className="w-full space-y-4">

        {/* SECTION 4 : SCORE DE RISQUE PAR GROUPE */}
        <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <ShieldAlert className="w-5 h-5 text-blue-500" /> 4. Exposition au Risque par Groupe d'Actifs
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Groupe d'Actifs (Asset Group)</TableHead>
                  <TableHead>Justification de l'Exposition</TableHead>
                  <TableHead>Score de Risque Pondéré (0-10)</TableHead>
                  <TableHead>Vulnérabilités Critiques</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assetRiskGroups.map((group, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-bold text-sm">{group.group}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{group.desc}</TableCell>
                    <TableCell>
                      <Badge variant={group.score >= 8 ? 'destructive' : group.score >= 6 ? 'default' : 'secondary'} className="text-sm">
                        {group.score}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-bold">{group.activeCritical.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 5 : DETTE TECHNIQUE (RÉCURRENTES) */}
        <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <FileWarning className="w-5 h-5 text-orange-500" /> 5. Top Dette Technique (Non corrigé &gt; 1 an)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Identifiant Vulnérabilité (CVE)</TableHead>
                  <TableHead>Âge (Dette)</TableHead>
                  <TableHead>Actifs Restants</TableHead>
                  <TableHead>Raison du Blocage (Root Cause)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topRecurringDette.map((vuln, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-bold text-sm">{vuln.cve}</TableCell>
                    <TableCell className="text-destructive font-black">{vuln.age} j</TableCell>
                    <TableCell className="font-bold">{vuln.affectedAssets}</TableCell>
                    <TableCell className="text-sm text-muted-foreground italic">{vuln.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-4 bg-secondary/5 border-t border-border text-xs text-muted-foreground">
               Les actifs liés à ces vulnérabilités nécessitent une acceptation de risque formelle (Risk Acceptance) ou un isolement réseau strict.
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 6 : VULNÉRABILITÉS CRITIQUES ACTIONNABLES */}
        <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <Target className="w-5 h-5 text-destructive" /> 6. Top CVE Critiques & Actionnables (CISA KEV)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">CVE / Titre de la Vulnérabilité</TableHead>
                  <TableHead>Score CVSS</TableHead>
                  <TableHead>Actifs Impactés</TableHead>
                  <TableHead>Catalogue CISA KEV</TableHead>
                  <TableHead>Statut d'Exploitation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.actionableVulns.map((vuln, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <span className="font-bold text-sm block">{vuln.cve}</span>
                      <span className="text-xs text-muted-foreground">{vuln.title}</span>
                    </TableCell>
                    <TableCell><Badge variant="destructive" className="font-mono text-sm">{vuln.cvss.toFixed(1)}</Badge></TableCell>
                    <TableCell className="font-bold text-lg">{vuln.affected}</TableCell>
                    <TableCell>
                      {vuln.cisaKev ? <Badge variant="destructive" className="text-[10px] uppercase">Répertorié</Badge> : <Badge variant="secondary" className="text-[10px] uppercase">Non</Badge>}
                    </TableCell>
                    <TableCell className={`text-xs font-bold ${vuln.exploitStatus.includes('Exploité') ? 'text-destructive' : 'text-orange-500'}`}>{vuln.exploitStatus}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

    </div>
  );
}