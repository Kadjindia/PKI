import React from "react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Database, Users, Lock, ShieldAlert, AlertTriangle,
  UserX, FolderOpen, Activity, CheckCircle2
} from "lucide-react";

import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip
} from "recharts";

// --- FONCTIONS UTILITAIRES (Pour éliminer les ternaires imbriqués de l'UI) ---
const getRiskScoreColor = (score: number) => {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f97316';
  return '#10b981';
};

const getRiskLevelVariant = (riskLevel: string): "destructive" | "default" | "secondary" => {
  if (riskLevel === 'Critique') return 'destructive';
  if (riskLevel === 'Élevé') return 'default';
  return 'secondary';
};

const getAlertSeverityVariant = (severity: string): "destructive" | "default" | "secondary" => {
  if (severity === 'Critique') return 'destructive';
  if (severity === 'Élevé') return 'default';
  return 'secondary';
};

export default function VaronisPanel() {
  // --- MOCK DATA ENTERPRISE (Scale : 4000 utilisateurs / 1.8 PB de données) ---
  const data = {
    // 1. KPI Globaux Varonis
    kpis: {
      totalData: "1.8 PB",
      sensitiveDataFound: "450 TB",
      globalAccessFiles: "2.3M",
      staleData: "850 TB", // Données non touchées depuis > 1 an
      activeAlerts: 12,
      dormantAccounts: 345
    },

    // 2. Exposition par Département
    riskByDepartment: [
      { dept: "DAF (Finance)", score: 92, riskLevel: "Critique", sensitiveFiles: 145000, globalAccess: 4500 },
      { dept: "Ressources Humaines", score: 85, riskLevel: "Élevé", sensitiveFiles: 320000, globalAccess: 1200 },
      { dept: "Direction R&D", score: 65, riskLevel: "Moyen", sensitiveFiles: 85000, globalAccess: 34000 },
      { dept: "Marketing & Com", score: 40, riskLevel: "Faible", sensitiveFiles: 12000, globalAccess: 125000 },
      { dept: "DSI / IT", score: 78, riskLevel: "Élevé", sensitiveFiles: 45000, globalAccess: 800 }
    ],

    // 3. Classification des données sensibles
    dataClassification: [
      { name: 'PII (Données Personnelles - RGPD)', value: 65, color: '#3b82f6' },
      { name: 'Données Financières (PCI-DSS)', value: 20, color: '#f97316' },
      { name: 'Propriété Intellectuelle (Secrets)', value: 10, color: '#ef4444' },
      { name: 'Données de Santé (HDS)', value: 5, color: '#10b981' }
    ],
    classificationDetails: [
      { category: "PII (RGPD)", criteria: "Noms, IBAN, Numéros de Sécu", filesCount: "1.2M", maxRiskLoc: String.raw`\\fs-corp\RH\Recrutement` },
      { category: "Financier (PCI-DSS)", criteria: "Numéros de CB, Bilans", filesCount: "350K", maxRiskLoc: String.raw`\\fs-corp\DAF\Cloture` },
      { category: "Propriété Intellectuelle", criteria: "Brevets, Code Source, Plans", filesCount: "85K", maxRiskLoc: String.raw`\\fs-corp\R&D\Projet_X` }
    ],

    // 4. Permissions Excessives ("Global Access")
    excessivePermissions: [
      { path: String.raw`\\fs-corp\DAF\M&A_2026`, owner: "S. Martin (DAF)", issue: "Accessible au groupe 'Tout le monde'", sensitiveHits: 450, status: "Révocation Auto." },
      { path: String.raw`\\fs-corp\RH\Evaluations_2025`, owner: "L. Bernard (DRH)", issue: "Héritage cassé + Droits directs", sensitiveHits: 3200, status: "En attente Data Owner" },
      { path: String.raw`\\fs-corp\IT\Passwords_Backup`, owner: "Orphelin (Sans Prop.)", issue: "Dossier partagé publiquement", sensitiveHits: 15, status: "Révocation Immédiate" },
      { path: String.raw`\\fs-corp\Direction\Board_Minutes`, owner: "M. Dupont (PDG)", issue: "Accessible au groupe 'Utilisateurs du domaine'", sensitiveHits: 125, status: "Corrigé" }
    ],

    // 5. Alertes Comportementales (UEBA / Insider Threat)
    behavioralAlerts: [
      { alert: "Accès massif à des données financières", user: "svc_backup_old", type: "Compte de service", time: "03:15 AM", severity: "Critique", action: "Compte désactivé (AD)" },
      { alert: "Exfiltration potentielle (Upload volume anormal)", user: "j.doe (Départ imminent)", type: "Employé", time: "14:22 PM", severity: "Critique", action: "Session révoquée" },
      { alert: "Élévation de privilèges suivie d'accès PII", user: "admin_temp", type: "Prestataire IT", time: "Hier, 22:40", severity: "Élevé", action: "Investigation SOC" },
      { alert: "Accès à des données sensibles jamais consultées", user: "a.turing (Marketing)", type: "Employé", time: "Ce matin, 09:10", severity: "Moyen", action: "Alerte Manager" }
    ],

    // 6. Gouvernance des Identités (AD / Entra ID)
    identityGovernance: [
      { metric: "Comptes utilisateurs dormants (> 90 jours)", value: 345, risk: "Désactivation automatique recommandée" },
      { metric: "Mots de passe qui n'expirent jamais", value: 12, risk: "Violation politique de sécurité" },
      { metric: "Comptes à privilèges (Admin) inactifs", value: 4, risk: "Risque de compromission critique" },
      { metric: "Groupes de sécurité vides ou sans owner", value: 142, risk: "Dette technique AD" }
    ]
  };

  return (
    <div className="space-y-6">

      {/* ==============================================================================
          1. BANDEAU SUPÉRIEUR PERMANENT (EXECUTIVE SUMMARY VARONIS)
          ============================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">

        <Card className="border-l-4 border-l-purple-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Données Scannées</CardTitle>
            <Database className="w-5 h-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-foreground">{data.kpis.totalData.split(' ')[0]}</span>
              <span className="text-sm text-muted-foreground font-medium">PB</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Dette data: {data.kpis.staleData} non consultés (&gt; 1an)</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Sur-exposition : "Global Access"</CardTitle>
            <FolderOpen className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.globalAccessFiles}</span>
              <span className="text-sm text-muted-foreground font-medium">Fichiers</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Données accessibles au groupe "Tout le monde" (Everyone).</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Comptes Fantômes</CardTitle>
            <UserX className="w-5 h-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-orange-500">{data.kpis.dormantAccounts}</span>
              <span className="text-sm text-muted-foreground font-medium">Dormants</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Comptes inactifs avec accès préservés.</p>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-destructive bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Insider Threats</CardTitle>
            <ShieldAlert className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.activeAlerts}</span>
              <span className="text-xs text-muted-foreground font-medium">Alertes Actives</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Anomalies comportementales (UEBA)</p>
          </CardContent>
        </Card>

      </div>

      {/* ==============================================================================
          2. SECTION : EXPOSITION PAR DÉPARTEMENT (OUVERTE PAR DÉFAUT)
          ============================================================================== */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" /> 2. Score de Risque et Exposition par Département
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Bar Chart Risk by Dept */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4 text-center">Score de Risque Data par Direction (0-100)</h4>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.riskByDepartment} layout="vertical" margin={{ top: 10, right: 30, left: 30, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#333" opacity={0.2} />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="dept" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} width={120} />
                    <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="score" name="Score de Risque" radius={[0, 4, 4, 0]}>
                      {data.riskByDepartment.map((entry) => (
                        <Cell key={entry.dept} fill={getRiskScoreColor(entry.score)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tableau Récapitulatif */}
            <div className="overflow-hidden flex flex-col justify-center">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/5">
                    <TableHead>Département / B.U.</TableHead>
                    <TableHead>Niveau</TableHead>
                    <TableHead>Fichiers Sensibles</TableHead>
                    <TableHead>Fichiers Global Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.riskByDepartment.map((r) => (
                    <TableRow key={r.dept}>
                      <TableCell className="font-bold text-sm">{r.dept}</TableCell>
                      <TableCell>
                        <Badge variant={getRiskLevelVariant(r.riskLevel)}>
                          {r.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.sensitiveFiles.toLocaleString()}</TableCell>
                      <TableCell className={`font-mono text-xs font-bold ${r.globalAccess > 10000 ? 'text-destructive' : 'text-orange-500'}`}>
                        {r.globalAccess.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ==============================================================================
          3. SECTION : CLASSIFICATION DES DONNÉES (OUVERTE PAR DÉFAUT)
          ============================================================================== */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Lock className="w-5 h-5 text-emerald-500" /> 3. Classification Automatique (Moteur d'inspection Varonis)
          </CardTitle>
          <Badge variant="outline" className="border-emerald-500 text-emerald-500">{data.kpis.sensitiveDataFound} de données sensibles identifiées</Badge>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Pie Chart Classification */}
            <div className="lg:col-span-1 space-y-2 border-r border-border pr-4">
              <h4 className="text-xs font-bold text-muted-foreground uppercase text-center">Répartition des types de données</h4>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.dataClassification} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">
                      {data.dataClassification.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {data.dataClassification.map((c) => (
                  <div key={c.name} className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full" style={{backgroundColor: c.color}}></span>{c.name.split(' ')[0]}</div>
                ))}
              </div>
            </div>

            {/* Détails Classification */}
            <div className="lg:col-span-2 overflow-hidden flex flex-col justify-center">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/5">
                    <TableHead>Catégorie de Classification</TableHead>
                    <TableHead>Critères de détection</TableHead>
                    <TableHead>Volume Trouvé</TableHead>
                    <TableHead>Dossier le plus à risque (Top 1)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.classificationDetails.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-bold text-sm">{c.category}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.criteria}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{c.filesCount}</TableCell>
                      <TableCell className="font-mono text-xs text-blue-500 truncate max-w-[200px]">{c.maxRiskLoc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ==============================================================================
          ACCORDÉONS TECHNIQUES (4 À 6)
          ============================================================================== */}
      <Accordion type="multiple" className="w-full space-y-4">

        {/* SECTION 4 : PERMISSIONS EXCESSIVES */}
        <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <FolderOpen className="w-5 h-5 text-orange-500" /> 4. Cartographie des Permissions Excessives ("Global Access")
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Chemin du Répertoire / Fichier</TableHead>
                  <TableHead>Data Owner (Propriétaire)</TableHead>
                  <TableHead>Problème d'Habilitation</TableHead>
                  <TableHead>Hits Sensibles (PII)</TableHead>
                  <TableHead>Action / Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.excessivePermissions.map((p) => (
                  <TableRow key={p.path}>
                    <TableCell className="pl-6 font-mono text-xs font-bold text-foreground">{p.path}</TableCell>
                    <TableCell className="text-sm font-medium">{p.owner}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.issue}</TableCell>
                    <TableCell className={p.sensitiveHits > 100 ? "text-destructive font-black text-lg" : "text-muted-foreground"}>{p.sensitiveHits}</TableCell>
                    <TableCell>
                      <Badge variant={p.status.includes('Attente') ? 'secondary' : 'default'} className={p.status.includes('Révocation') ? 'bg-emerald-500' : ''}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 5 : ALERTES COMPORTEMENTALES (UEBA) */}
        <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <AlertTriangle className="w-5 h-5 text-destructive" /> 5. Menaces Internes & Comportements Anormaux (UEBA)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Alerte Détectée</TableHead>
                  <TableHead>Sévérité</TableHead>
                  <TableHead>Utilisateur / Compte</TableHead>
                  <TableHead>Date / Heure</TableHead>
                  <TableHead>Réponse Varonis / SOC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.behavioralAlerts.map((a) => (
                  <TableRow key={`${a.user}-${a.time}`}>
                    <TableCell className="pl-6 font-bold text-sm text-foreground">{a.alert}</TableCell>
                    <TableCell>
                      <Badge variant={getAlertSeverityVariant(a.severity)}>
                        {a.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium text-sm">{a.user}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{a.type}</span>
                    </TableCell>
                    <TableCell className="text-xs">{a.time}</TableCell>
                    <TableCell className={`text-sm font-bold ${a.action.includes('désactivé') || a.action.includes('révoquée') ? 'text-emerald-500 flex items-center gap-1' : 'text-orange-500'}`}>
                      {a.action.includes('désactivé') || a.action.includes('révoquée') ? <CheckCircle2 className="w-4 h-4"/> : null}
                      {a.action}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 6 : GOUVERNANCE IDENTITÉS AD */}
        <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <Users className="w-5 h-5 text-blue-500" /> 6. Gouvernance des Identités (Active Directory & Entra ID)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Indicateur de Santé AD</TableHead>
                  <TableHead>Volume Identifié</TableHead>
                  <TableHead>Impact Risque & Remédiation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.identityGovernance.map((g) => (
                  <TableRow key={g.metric}>
                    <TableCell className="pl-6 font-bold text-sm text-foreground">{g.metric}</TableCell>
                    <TableCell className="font-black text-xl text-orange-500">{g.value}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.risk}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-4 bg-secondary/5 border-t border-border flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Une intégration avec le système IAM/IGA est requise pour automatiser le nettoyage des comptes AD.</span>
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

    </div>
  );
}