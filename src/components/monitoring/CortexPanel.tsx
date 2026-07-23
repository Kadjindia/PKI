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
  Cpu, Activity, Zap, CheckCircle2, ShieldAlert, Clock, PlayCircle
} from "lucide-react";

export default function CortexPanel() {
  const data = {
    kpis: {
      mttd: "4 minutes",
      mttr: "1.2 heures",
      automationRate: "82%",
      savedHours: "450h / mois",
      activePlaybooks: 64
    },
    incidentsQueue: [
      { id: "INC-8842", title: "Campagne Phishing -> Exfiltration ciblée", severity: "Critique", playbook: "PB_Ransomware_Auto_Isolate", status: "Résolu (Auto)" },
      { id: "INC-8841", title: "Anomalie comportementale OAuth Token", severity: "Élevé", playbook: "PB_Revoke_Cloud_Session", status: "En cours (Analyste L2)" },
      { id: "INC-8840", title: "Tentative de contournement EDR", severity: "Critique", playbook: "PB_Forensic_Snapshot", status: "Assigné" }
    ],
    playbookMetrics: [
      { name: "Isolation d'endpoint compromise", executions: 124, successRate: "99.2%", avgTime: "12 sec" },
      { name: "Blocage automatique IP C2 (Threat Intel)", executions: 1450, successRate: "100%", avgTime: "2 sec" },
      { name: "Réinitialisation mot de passe compromise AD", executions: 85, successRate: "95.0%", avgTime: "45 sec" }
    ]
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">MTTD XSIAM</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-blue-500">{data.kpis.mttd}</div><p className="text-[11px] text-muted-foreground mt-1">Détection par corrélation IA</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Taux d'Automatisation (SOAR)</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-emerald-500">{data.kpis.automationRate}</div><p className="text-[11px] text-muted-foreground mt-1">{data.kpis.savedHours}</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">MTTR Opérationnel</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-foreground">{data.kpis.mttr}</div><p className="text-[11px] text-muted-foreground mt-1">Temps de remédiation global</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Playbooks Actifs</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-purple-500">{data.kpis.activePlaybooks}</div><p className="text-[11px] text-muted-foreground mt-1">Scénarios d'orchestration</p></CardContent>
        </Card>
      </div>

      {/* File d'incidents */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2"><Cpu className="w-5 h-5 text-blue-500" /> Queue des Incidents & Playbooks XSIAM</CardTitle>
          <Badge variant="outline">Temps Réel</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-6">ID / Titre de l'Incident</TableHead><TableHead>Sévérité</TableHead><TableHead>Playbook Déclenché</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.incidentsQueue.map((inc, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6 font-bold text-sm"><span className="block">{inc.title}</span><span className="text-xs font-mono text-blue-500">{inc.id}</span></TableCell>
                  <TableCell><Badge variant="destructive">{inc.severity}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{inc.playbook}</TableCell>
                  <TableCell><Badge variant={inc.status.includes('Résolu') ? 'default' : 'secondary'} className={inc.status.includes('Résolu') ? 'bg-emerald-500' : ''}>{inc.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Performance Playbooks */}
      <Accordion type="multiple" className="w-full space-y-4">
        <AccordionItem value="item-1" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Zap className="w-5 h-5 text-orange-500" /> Efficacité des Playbooks SOAR</div></AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-6">Nom du Playbook</TableHead><TableHead>Exécutions (30j)</TableHead><TableHead>Taux de Succès</TableHead><TableHead>Temps Moyen</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.playbookMetrics.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-bold text-sm">{p.name}</TableCell>
                    <TableCell className="font-mono text-sm">{p.executions}</TableCell>
                    <TableCell className="font-bold text-emerald-500">{p.successRate}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.avgTime}</TableCell>
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