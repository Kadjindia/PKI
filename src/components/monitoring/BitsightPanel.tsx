import React from "react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Globe, TrendingUp, TrendingDown, CheckCircle2, ShieldCheck,
  Activity, ArrowUpRight, ArrowDownRight, AlertOctagon,
  ShieldAlert, Lock, Cpu, BarChart, Wrench, Briefcase, AlertTriangle
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart as RechartsBarChart, Bar,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend
} from "recharts";

export default function BitsightPanel() {
  // Les données spécifiques à BitSight
  const data = {
    executive: {
      score: 740, maxScore: 900, trends: { d7: "+2", d30: "+15", d90: "+42" },
      industryAvg: 680, percentile: "Top 15%", monitoredAssets: 1450,
      newAssets: 18, totalFindings: 342, criticalRisks: 4, lastSync: "2026-07-23 14:15:00"
    },
    scorePosture: {
      historical: [
        { month: 'Fév', score: 698, industry: 675, topPeers: 785 },
        { month: 'Mar', score: 705, industry: 675, topPeers: 788 },
        { month: 'Avr', score: 712, industry: 678, topPeers: 790 },
        { month: 'Mai', score: 720, industry: 680, topPeers: 790 },
        { month: 'Juin', score: 725, industry: 680, topPeers: 792 },
        { month: 'Juil', score: 740, industry: 680, topPeers: 790 }
      ],
      positiveFactors: [
        { factor: "Remédiation rapide des failles TLS/SSL", impact: "+12 pts" },
        { factor: "Fermeture des ports Telnet/FTP", impact: "+8 pts" },
        { factor: "Mise en place de DMARC 'Reject'", impact: "+5 pts" }
      ],
      negativeFactors: [
        { factor: "2 ports RDP ouverts (IP recette)", impact: "-10 pts" },
        { factor: "Certificat SSL expiré (VPN)", impact: "-5 pts" }
      ],
      categories: [
        { name: "Infections / Botnets", rating: "A", score: 95 },
        { name: "Hygiène de Sécurité", rating: "B", score: 78 },
        { name: "Sécurité Réseau", rating: "B-", score: 72 },
        { name: "Comportement", rating: "A", score: 92 }
      ]
    },
    priorityRisks: [
      { id: "RSK-01", risk: "Infection Botnet", severity: "Critique", impactScore: "-25 pts", assets: "192.168.45.12", discoveryDate: "2026-07-20", recommendation: "Isoler l'hôte.", status: "Ouvert" },
      { id: "RSK-02", risk: "Port RDP ouvert", severity: "Critique", impactScore: "-15 pts", assets: "ext-dev.entreprise.com", discoveryDate: "2026-07-22", recommendation: "Fermer le port FW.", status: "En cours" },
      { id: "RSK-03", risk: "Certificat expiré", severity: "Élevé", impactScore: "-8 pts", assets: "api-partner.entreprise.com", discoveryDate: "2026-07-15", recommendation: "Renouveler SSL.", status: "Planifié" }
    ],
    attackSurface: {
      totalExposed: 1450, newAssetsCount: 18, domainsCount: 42, subdomainsCount: 890, publicIpsCount: 518, exposedServicesCount: 124, technologiesCount: 35,
      riskyAssets: [
        { asset: "vpn-legacy.entreprise.com", type: "Sous-domaine", riskLevel: "F (Critique)", findings: 12, lastObserved: "2026-07-23" },
        { asset: "198.51.100.45", type: "IP Publique", riskLevel: "D (Élevé)", findings: 8, lastObserved: "2026-07-22" }
      ]
    },
    findings: {
      kpis: { total: 342, critical: 4, high: 28, medium: 110, low: 200 },
      severityDistribution: [ { name: "Critique", value: 4, color: "#ef4444" }, { name: "Élevé", value: 28, color: "#f97316" }, { name: "Moyen", value: 110, color: "#eab308" }, { name: "Faible", value: 200, color: "#3b82f6" } ],
      categoryDistribution: [ { category: "SSL/TLS", count: 120 }, { category: "DNS", count: 85 }, { category: "Ports", count: 65 } ],
      agingData: [ { range: "< 30j", count: 180 }, { range: "31-60j", count: 90 }, { range: "> 90j", count: 27 } ],
      list: [
        { finding: "TLS 1.0 Autorisé", category: "SSL/TLS", severity: "Élevé", cve: "N/A", cvss: 7.5, asset: "web.entreprise.com", exposureTime: "45j", impactScore: "-4 pts", status: "En cours" },
        { finding: "OpenSSL RCE", category: "Web App Vulns", severity: "Critique", cve: "CVE-2024-1234", cvss: 9.8, asset: "ext-app.entreprise.com", exposureTime: "12j", impactScore: "-12 pts", status: "Ouvert" }
      ]
    },
    hygiene: {
      sslTls: { expiredCerts: 2, expiringSoon: 14, weakProtocols: 8, score: 85 },
      dns: { dmarcPolicy: "Reject", score: 92 },
      services: { openPortsCount: 45, criticalServicesExposed: 2, score: 78 }
    },
    techShadowIt: {
      technologies: [
        { name: "Nginx", version: "1.18.0", instances: 24, risk: "Élevé", vulnsCount: 8 }
      ],
      shadowIt: [
        { name: "cloud-dev.com", type: "Domaine", discoveryDate: "2026-07-21", risk: "Élevé", details: "Non enregistré" }
      ]
    },
    benchmark: {
      radarData: [
        { metric: 'Rating', Enterprise: 82, Industry: 65, Top10: 92 },
        { metric: 'Infections', Enterprise: 95, Industry: 70, Top10: 98 },
        { metric: 'SSL', Enterprise: 85, Industry: 60, Top10: 90 },
        { metric: 'DNS', Enterprise: 92, Industry: 75, Top10: 96 }
      ]
    },
    historyRecommendations: {
      timeline: [
        { date: "23 Juil 2026", title: "Hausse du Score (+15 pts)", desc: "Remédiation certificats expirés." }
      ],
      actions: [
        { action: "Bloquer port RDP", impact: "+10 pts", difficulty: "Faible", priority: "P1", assignee: "Réseau", status: "En cours" }
      ]
    }
  };

  return (
    <div className="space-y-6">

      {/* 1. Bandeau Exécutif */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
        <Card className="lg:col-span-2 border-l-4 border-l-emerald-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">BitSight Rating</CardTitle>
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black tracking-tight text-foreground">{data.executive.score}</span>
              <span className="text-sm text-muted-foreground font-medium">/ {data.executive.maxScore}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge className="bg-emerald-500/10 text-emerald-500 font-bold border-none">
                <TrendingUp className="w-3.5 h-3.5 mr-1" /> {data.executive.trends.d30} pts (30j)
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tendance</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span>7 jours:</span><span className="font-bold text-emerald-500">{data.executive.trends.d7}</span></div>
            <div className="flex justify-between"><span>30 jours:</span><span className="font-bold text-emerald-500">{data.executive.trends.d30}</span></div>
            <div className="flex justify-between"><span>90 jours:</span><span className="font-bold text-emerald-500">{data.executive.trends.d90}</span></div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Benchmark</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-blue-500">{data.executive.percentile}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Moy. secteur: <strong>{data.executive.industryAvg}</strong></p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Actifs Exposés</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">{data.executive.monitoredAssets.toLocaleString()}</div>
            <p className="text-[11px] text-emerald-500 font-medium mt-1">+{data.executive.newAssets} détectés</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-t-4 border-t-destructive bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Risques Actifs</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-destructive">{data.executive.criticalRisks} <span className="text-xs text-muted-foreground font-normal">critiques</span></div>
            <p className="text-[11px] text-muted-foreground mt-1">Findings: {data.executive.totalFindings}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Sync API</CardTitle></CardHeader>
          <CardContent className="text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 text-emerald-500 font-medium"><CheckCircle2 className="w-3.5 h-3.5"/> Connecté</div>
            <div className="font-mono text-[10px] text-foreground">{data.executive.lastSync.split(' ')[1]}</div>
          </CardContent>
        </Card>
      </div>

      {/* 2. Score & Posture */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2"><Activity className="w-5 h-5 text-blue-500" /> 2. Score & Posture de Sécurité</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase">Évolution du Security Rating</h4>
              <div className="h-64 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.scorePosture.historical} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="scoreColor" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.1} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <YAxis domain={[600, 850]} axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                    <RechartsTooltip />
                    <Legend verticalAlign="top" height={36}/>
                    <Area type="monotone" dataKey="score" name="Notre Entreprise" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#scoreColor)" />
                    <Area type="monotone" dataKey="industry" name="Moy. Secteur" stroke="#94a3b8" strokeWidth={2} fillOpacity={0} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-muted-foreground uppercase">Facteurs d'impact</h4>
              <div className="space-y-2">
                <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1"><ArrowUpRight className="w-4 h-4"/> Impacts Positifs</span>
                {data.scorePosture.positiveFactors.map((f, i) => (
                  <div key={i} className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex justify-between items-center text-xs">
                    <span className="text-foreground">{f.factor}</span><Badge className="bg-emerald-500 text-white font-bold">{f.impact}</Badge>
                  </div>
                ))}
              </div>
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-destructive flex items-center gap-1"><ArrowDownRight className="w-4 h-4"/> Impacts Négatifs</span>
                {data.scorePosture.negativeFactors.map((f, i) => (
                  <div key={i} className="p-2.5 bg-destructive/5 border border-destructive/20 rounded-lg flex justify-between items-center text-xs">
                    <span className="text-foreground">{f.factor}</span><Badge variant="destructive" className="font-bold">{f.impact}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4">Répartition par Catégorie</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.scorePosture.categories.map((cat, i) => (
                <div key={i} className="p-4 bg-secondary/20 rounded-xl border border-border space-y-2">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-foreground">{cat.name}</span><Badge variant={cat.rating === 'A' ? 'default' : 'secondary'} className={cat.rating === 'A' ? 'bg-emerald-500' : ''}>{cat.rating}</Badge></div>
                  <Progress value={cat.score} className="h-1.5" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Risques Prioritaires */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2"><AlertOctagon className="w-5 h-5 text-destructive" /> 3. Risques Prioritaires</CardTitle>
          <Badge variant="destructive">{data.priorityRisks.length} Actions Requises</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/5">
                <TableHead>Risque / Finding</TableHead>
                <TableHead>Gravité</TableHead>
                <TableHead>Impact Score</TableHead>
                <TableHead>Actifs Concernés</TableHead>
                <TableHead>Découverte</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.priorityRisks.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-bold text-sm"><span className="block">{r.risk}</span><span className="text-xs text-muted-foreground font-mono">{r.id}</span></TableCell>
                  <TableCell><Badge variant={r.severity === 'Critique' ? 'destructive' : 'default'}>{r.severity}</Badge></TableCell>
                  <TableCell className="font-bold text-destructive">{r.impactScore}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.assets}</TableCell>
                  <TableCell className="text-xs">{r.discoveryDate}</TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Accordéons techniques */}
      <Accordion type="multiple" className="w-full space-y-4">

        {/* 4. Surface d'Attaque */}
        <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Globe className="w-5 h-5 text-blue-500" /> 4. Surface d'Attaque Externe</div></AccordionTrigger>
          <AccordionContent className="p-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
              <div className="p-3 bg-secondary/20 rounded-xl"><span className="block text-xl font-bold">{data.attackSurface.domainsCount}</span><span className="text-[10px] text-muted-foreground uppercase">Domaines</span></div>
              <div className="p-3 bg-secondary/20 rounded-xl"><span className="block text-xl font-bold">{data.attackSurface.subdomainsCount}</span><span className="text-[10px] text-muted-foreground uppercase">Sous-domaines</span></div>
              <div className="p-3 bg-secondary/20 rounded-xl"><span className="block text-xl font-bold">{data.attackSurface.publicIpsCount}</span><span className="text-[10px] text-muted-foreground uppercase">IPs Publiques</span></div>
              <div className="p-3 bg-emerald-500/10 rounded-xl"><span className="block text-xl font-bold text-emerald-500">+{data.attackSurface.newAssetsCount}</span><span className="text-[10px] text-muted-foreground uppercase">Nouveaux (30j)</span></div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Actif</TableHead><TableHead>Type</TableHead><TableHead>Niveau Risque</TableHead><TableHead>Findings</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.attackSurface.riskyAssets.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs font-bold">{a.asset}</TableCell>
                    <TableCell className="text-xs">{a.type}</TableCell>
                    <TableCell><Badge variant={a.riskLevel.startsWith('F') ? 'destructive' : 'secondary'}>{a.riskLevel}</Badge></TableCell>
                    <TableCell className="font-bold text-xs">{a.findings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* 5. Findings & Vulnérabilités */}
        <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><ShieldAlert className="w-5 h-5 text-orange-500" /> 5. Findings & Vulnérabilités</div></AccordionTrigger>
          <AccordionContent className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 border border-border rounded-xl">
                <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Sévérité</h5>
                <div className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.findings.severityDistribution} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">{data.findings.severityDistribution.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><RechartsTooltip /></PieChart></ResponsiveContainer></div>
              </div>
              <div className="p-4 border border-border rounded-xl">
                <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Catégorie</h5>
                <div className="h-44"><ResponsiveContainer width="100%" height="100%"><RechartsBarChart data={data.findings.categoryDistribution} layout="vertical" margin={{ left: 20 }}><XAxis type="number" hide /><YAxis dataKey="category" type="category" tick={{fontSize: 10}} axisLine={false} /><Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} /></RechartsBarChart></ResponsiveContainer></div>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Catégorie</TableHead><TableHead>Sévérité</TableHead><TableHead>Actif</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.findings.list.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-bold text-sm">{f.finding}</TableCell>
                    <TableCell><Badge variant="outline">{f.category}</Badge></TableCell>
                    <TableCell><Badge variant={f.severity === 'Critique' ? 'destructive' : 'default'}>{f.severity}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{f.asset}</TableCell>
                    <TableCell className="text-xs">{f.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* 6. Hygiène Internet */}
        <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Lock className="w-5 h-5 text-emerald-500" /> 6. Hygiène Internet</div></AccordionTrigger>
          <AccordionContent className="p-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 border border-border rounded-xl space-y-3">
                  <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">SSL / TLS</span><Badge className="bg-emerald-500">{data.hygiene.sslTls.score}%</Badge></div>
                  <div className="text-xs space-y-2"><div className="flex justify-between"><span>Certificats Expirés:</span><span className="font-bold text-destructive">{data.hygiene.sslTls.expiredCerts}</span></div></div>
                </div>
                <div className="p-4 border border-border rounded-xl space-y-3">
                  <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">DNS & Mail</span><Badge className="bg-emerald-500">{data.hygiene.dns.score}%</Badge></div>
                  <div className="text-xs space-y-2"><div className="flex justify-between"><span>DMARC:</span><span className="font-bold text-emerald-500">{data.hygiene.dns.dmarcPolicy}</span></div></div>
                </div>
                <div className="p-4 border border-border rounded-xl space-y-3">
                  <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">Services Exposés</span><Badge className="bg-orange-500">{data.hygiene.services.score}%</Badge></div>
                  <div className="text-xs space-y-2"><div className="flex justify-between"><span>Ports Ouverts:</span><span className="font-bold">{data.hygiene.services.openPortsCount}</span></div></div>
                </div>
             </div>
          </AccordionContent>
        </AccordionItem>

        {/* 7. Technologies & Shadow IT */}
        <AccordionItem value="item-7" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Cpu className="w-5 h-5 text-purple-500" /> 7. Technologies & Shadow IT</div></AccordionTrigger>
          <AccordionContent className="p-6">
             <Table>
                <TableHeader><TableRow><TableHead>Technologie</TableHead><TableHead>Version</TableHead><TableHead>Risque</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.techShadowIt.technologies.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-bold text-xs">{t.name}</TableCell>
                      <TableCell className="text-xs font-mono">{t.version}</TableCell>
                      <TableCell><Badge variant={t.risk === 'Élevé' ? 'destructive' : 'secondary'}>{t.risk}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </AccordionContent>
        </AccordionItem>

        {/* 8. Benchmark */}
        <AccordionItem value="item-8" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><BarChart className="w-5 h-5 text-indigo-500" /> 8. Benchmark Externe</div></AccordionTrigger>
          <AccordionContent className="p-6">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data.benchmark.radarData}>
                  <PolarGrid stroke="#333" opacity={0.2} />
                  <PolarAngleAxis dataKey="metric" tick={{fontSize: 12}} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} />
                  <Radar name="Notre Entreprise" dataKey="Enterprise" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
                  <Radar name="Moyenne Secteur" dataKey="Industry" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
                  <Legend />
                  <RechartsTooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 9. Historique & Recommandations */}
        <AccordionItem value="item-9" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Wrench className="w-5 h-5 text-emerald-500" /> 9. Recommandations</div></AccordionTrigger>
          <AccordionContent className="p-6">
             <Table>
                <TableHeader><TableRow><TableHead>Action Recommandée</TableHead><TableHead>Impact</TableHead><TableHead>Priorité</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.historyRecommendations.actions.map((act, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-bold text-xs">{act.action}</TableCell>
                      <TableCell className="text-emerald-500 font-bold text-xs">{act.impact}</TableCell>
                      <TableCell><Badge variant="destructive">{act.priority}</Badge></TableCell>
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