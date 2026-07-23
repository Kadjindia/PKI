import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Cloud, Users, AlertTriangle, Database, ShieldAlert, PieChart as PieChartIcon
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend
} from "recharts";

export default function NetskopePanel() {
  // --- MOCK DATA ENTERPRISE : CLOUD & SHADOW IT ---
  const data = {
    // 1. KPI Globaux Netskope
    kpis: {
      shadowItTotal: 380,
      highRiskApps: 45,
      unapprovedDataVol: "12.5 TB",
      totalDlpIncidents: 145,
      unsanctionedIaas: 4
    },
    dlpBreakdown: { pii: 92, financial: 41, ip: 12 },

    // 2. Répartition de l'usage Cloud (Graphique)
    categoryUsage: [
      { name: 'Stockage Cloud', value: 45, color: '#3b82f6' },
      { name: 'IA Générative', value: 25, color: '#f97316' },
      { name: 'Réseaux Sociaux', value: 15, color: '#ef4444' },
      { name: 'Outils Dév / IT', value: 15, color: '#10b981' }
    ],

    // 3. Registre du Shadow IT critique (CCI)
    shadowItApps: [
      { app: "WeTransfer", category: "Cloud Storage", cci: "Faible (24/100)", users: 450, dataVol: "4.2 TB", dlpHits: 12, status: "Upload Bloqué" },
      { app: "ChatGPT (Free)", category: "GenAI", cci: "Moyen (55/100)", users: 1250, dataVol: "850 GB", dlpHits: 45, status: "Autorisé (DLP Actif)" },
      { app: "Mega.nz", category: "Cloud Storage", cci: "Très Faible (12/100)", users: 15, dataVol: "1.2 TB", dlpHits: 2, status: "Bloqué Totalement" },
      { app: "GitHub Personal", category: "Development", cci: "Moyen (60/100)", users: 85, dataVol: "4.5 GB", dlpHits: 8, status: "Monitoring" }
    ],

    // 4. Comportements Utilisateurs (UEBA)
    riskyBehaviors: [
      { user: "j.doe (Marketing)", action: "Upload massif inaccoutumé vers stockage non sanctionné", target: "Mega.nz", risk: "Critique", status: "Bloqué (Isolation réseau)" },
      { user: "s.martin (DAF)", action: "Partage de document financier via lien public (sans mot de passe)", target: "Google Drive Corporate", risk: "Élevé", status: "Lien révoqué (Auto)" },
      { user: "a.turing (R&D)", action: "Copie de code source vers un dépôt public", target: "GitHub Personal", risk: "Élevé", status: "Alerte envoyée au Manager" }
    ]
  };

  return (
    <div className="space-y-6">

      {/* ==============================================================================
          1. BANDEAU SUPÉRIEUR (EXECUTIVE SUMMARY NETSKOPE)
          ============================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-orange-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Shadow IT (Haut Risque)</CardTitle>
            <Cloud className="w-5 h-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-orange-500">{data.kpis.highRiskApps}</span>
              <span className="text-sm text-muted-foreground font-medium">Apps</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Sur un total de {data.kpis.shadowItTotal} applications détectées.</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Volume Non Approuvé</CardTitle>
            <Database className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.unapprovedDataVol.split(' ')[0]}</span>
              <span className="text-sm text-muted-foreground font-medium">TB</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Données hébergées hors périmètre de contrôle.</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Incidents DLP (Fuites)</CardTitle>
            <ShieldAlert className="w-5 h-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-orange-500">{data.kpis.totalDlpIncidents}</span>
              <span className="text-xs text-muted-foreground font-medium">Blocages</span>
            </div>
            <div className="flex gap-2 text-[10px] font-bold mt-2">
               <span className="text-destructive">PII: {data.dlpBreakdown.pii}</span>
               <span className="text-orange-500">Finance: {data.dlpBreakdown.financial}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">IaaS Non Autorisés</CardTitle>
            <Cloud className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.unsanctionedIaas}</span>
              <span className="text-xs text-muted-foreground font-medium">Comptes AWS/Azure</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Instances montées hors de la gouvernance FinOps/SecOps.</p>
          </CardContent>
        </Card>
      </div>

      {/* ==============================================================================
          2. SECTION : USAGES ET SHADOW IT (Tableaux & Graphiques)
          ============================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Pie Chart */}
        <Card className="border border-border shadow-sm col-span-1">
          <CardHeader className="border-b border-border bg-secondary/10">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <PieChartIcon className="w-5 h-5 text-blue-500" /> Distribution du Trafic Cloud
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.categoryUsage} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                    {data.categoryUsage.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Table Shadow IT */}
        <Card className="border border-border shadow-sm col-span-1 lg:col-span-2 overflow-hidden">
          <CardHeader className="border-b border-border bg-secondary/10">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Cloud className="w-5 h-5 text-orange-500" /> Inventaire Shadow IT par Risque (Index CCI)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Application SaaS</TableHead>
                  <TableHead>Confiance (CCI)</TableHead>
                  <TableHead>Volume Data</TableHead>
                  <TableHead>Blocages DLP</TableHead>
                  <TableHead>Politique CASB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.shadowItApps.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-bold text-sm">
                      <span className="block">{a.app}</span>
                      <span className="text-xs text-muted-foreground font-normal">{a.category} ({a.users} users)</span>
                    </TableCell>
                    <TableCell><Badge variant={a.cci.includes('Faible') ? 'destructive' : 'secondary'}>{a.cci}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{a.dataVol}</TableCell>
                    <TableCell className={`font-bold ${a.dlpHits > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{a.dlpHits}</TableCell>
                    <TableCell className="text-sm font-medium">{a.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>

      {/* ==============================================================================
          3. SECTION : UEBA (Comportements Utilisateurs à Risque)
          ============================================================================== */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" /> 3. Comportements Utilisateurs Anormaux (Analyse UEBA)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/5">
                <TableHead className="pl-6">Utilisateur (Département)</TableHead>
                <TableHead>Comportement Détecté</TableHead>
                <TableHead>Cible (Destination)</TableHead>
                <TableHead>Risque</TableHead>
                <TableHead>Statut Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.riskyBehaviors.map((b, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6 font-bold text-sm">{b.user}</TableCell>
                  <TableCell className="text-sm">{b.action}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{b.target}</TableCell>
                  <TableCell><Badge variant={b.risk === 'Critique' ? 'destructive' : 'default'} className={b.risk === 'Élevé' ? 'bg-orange-500' : ''}>{b.risk}</Badge></TableCell>
                  <TableCell className={`text-sm font-bold ${b.status.includes('Bloqué') || b.status.includes('révoqué') ? 'text-emerald-500' : 'text-orange-500'}`}>{b.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}