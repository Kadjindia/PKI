import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase } from "lucide-react";

// Imports de TOUS les sous-composants, y compris la vue globale
import ExecutivePanel from "./ExecutivePanel";
import BitsightPanel from "./BitsightPanel";
import QradarPanel from "./QradarPanel";
import QualysPanel from "./QualysPanel";
import NetskopePanel from "./NetskopePanel";
import VaronisPanel from "./VaronisPanel";
import CortexPanel from "./CortexPanel";
import TrendMicroPanel from "./TrendMicroPanel";

export default function MonitoringView() {
  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-12">

      {/* EN-TÊTE GLOBAL */}
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3 tracking-tight">
          <Briefcase className="w-8 h-8 text-blue-500" /> Pilotage Stratégique des Risques SI
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Exploitation des données issues des solutions de sécurité.
        </p>
      </div>

      {/* SYSTÈME D'ONGLETS */}
      <Tabs defaultValue="executive" className="w-full space-y-6">
        <div className="w-full overflow-x-auto pb-2 scrollbar-hide">
          <TabsList className="inline-flex h-auto p-1 bg-secondary/30 min-w-max border border-border">
            <TabsTrigger value="executive" className="py-2.5 px-6 text-sm font-bold data-[state=active]:bg-blue-600 data-[state=active]:text-white transition-all shadow-sm">Vue Globale (Executive)</TabsTrigger>
            <TabsTrigger value="bitsight" className="py-2.5 px-4 text-sm">BitSight</TabsTrigger>
            <TabsTrigger value="qradar" className="py-2.5 px-4 text-sm">QRadar (SIEM)</TabsTrigger>
            <TabsTrigger value="qualys" className="py-2.5 px-4 text-sm">Qualys (Vuln)</TabsTrigger>
            <TabsTrigger value="netskope" className="py-2.5 px-4 text-sm">Netskope (Cloud)</TabsTrigger>
            <TabsTrigger value="varonis" className="py-2.5 px-4 text-sm">Varonis (Data)</TabsTrigger>
            <TabsTrigger value="cortex" className="py-2.5 px-4 text-sm">Cortex XSIAM</TabsTrigger>
            <TabsTrigger value="trend" className="py-2.5 px-4 text-sm">Trend Micro</TabsTrigger>
          </TabsList>
        </div>

        {/* DISTRIBUTION DES ONGLETS VERS LES SOUS-COMPOSANTS DÉDIÉS */}
        <TabsContent value="executive" className="mt-4"><ExecutivePanel /></TabsContent>
        <TabsContent value="bitsight" className="mt-4"><BitsightPanel /></TabsContent>
        <TabsContent value="qradar" className="mt-4"><QradarPanel /></TabsContent>
        <TabsContent value="qualys" className="mt-4"><QualysPanel /></TabsContent>
        <TabsContent value="netskope" className="mt-4"><NetskopePanel /></TabsContent>
        <TabsContent value="varonis" className="mt-4"><VaronisPanel /></TabsContent>
        <TabsContent value="cortex" className="mt-4"><CortexPanel /></TabsContent>
        <TabsContent value="trend" className="mt-4"><TrendMicroPanel /></TabsContent>

      </Tabs>
    </div>
  );
}