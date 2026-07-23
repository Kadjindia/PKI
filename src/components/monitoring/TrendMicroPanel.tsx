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
  ServerCrash, ShieldCheck, Activity, ShieldAlert, Laptop
} from "lucide-react";

export default function TrendMicroPanel() {
  const data = {
    kpis: {
      edrCoverage: "98.5%",
      offlineAgents: 35,
      isolatedEndpoints: 4,
      ransomwareBlocked: 2,
      behavioralAlerts: 142
    },
    endpoints: [
      { hostname: "LT-FIN-045", ip: "10.50.2.14", user: "j.doe", threat: "Emotet Variant", action: "Isolé du réseau (EDR)", time: "Il y a 1h" },
      { hostname: "SRV-DB-02", ip: "10.10.1.5", user: "system", threat: "Cobalt Strike Beacon", action: "Processus killé", time: "Il y a 3h" },
      { hostname: "LT-HR-012", ip: "10.50.3.88", user: "m.smith", threat: "Ransom.WannaCry", action: "Isolé du réseau", time: "Hier" }
    ]
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Couverture EDR</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-emerald-500">{data.kpis.edrCoverage}</div><p className="text-[11px] text-muted-foreground mt-1">Postes supervisés</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Agents Hors Ligne</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-orange-500">{data.kpis.offlineAgents}</div><p className="text-[11px] text-muted-foreground mt-1">Risque aveugle potentiel</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Postes Isolés</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-destructive">{data.kpis.isolatedEndpoints}</div><p className="text-[11px] text-muted-foreground mt-1">Quarantaine réseau active</p></CardContent>
        </Card>
        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase">Ransomwares Bloqués</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-black text-emerald-500">{data.kpis.ransomwareBlocked}</div><p className="text-[11px] text-muted-foreground mt-1">Tentatives stoppées net (30j)</p></CardContent>
        </Card>
      </div>

      {/* Journal des détections endpoints */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2"><Laptop className="w-5 h-5 text-blue-500" /> Journal des Menaces Endpoints (Trend Micro XDR)</CardTitle>
          <Badge variant="destructive">{data.kpis.isolatedEndpoints} Quarantaines</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-6">Hostname / IP</TableHead><TableHead>Utilisateur</TableHead><TableHead>Menace Détectée</TableHead><TableHead>Action Exécutée</TableHead><TableHead>Horodatage</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.endpoints.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6 font-bold text-sm"><span className="block">{e.hostname}</span><span className="text-xs text-muted-foreground font-mono">{e.ip}</span></TableCell>
                  <TableCell className="text-sm">{e.user}</TableCell>
                  <TableCell className="text-destructive font-bold text-sm">{e.threat}</TableCell>
                  <TableCell><Badge variant="destructive">{e.action}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.time}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}