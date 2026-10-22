import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, FolderOpen } from "lucide-react";
import VaronisPanel from "./VaronisPanel";
import VaronisPosturePanel from "./VaronisPosturePanel";

// Varonis : alertes (détection) et posture des données (exposition, comptes, droits).
// L'onglet « Posture » n'est monté qu'à son ouverture : ses requêtes sont longues.
export default function VaronisView() {
  return (
    <Tabs defaultValue="alerts" className="space-y-4">
      <TabsList>
        <TabsTrigger value="alerts" className="gap-2"><Bell className="w-4 h-4" /> Alertes</TabsTrigger>
        <TabsTrigger value="posture" className="gap-2"><FolderOpen className="w-4 h-4" /> Posture des données</TabsTrigger>
      </TabsList>
      <TabsContent value="alerts"><VaronisPanel /></TabsContent>
      <TabsContent value="posture"><VaronisPosturePanel /></TabsContent>
    </Tabs>
  );
}
