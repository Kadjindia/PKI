import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, FolderOpen, Users } from "lucide-react";
import VaronisPanel from "./VaronisPanel";
import VaronisPosturePanel from "./VaronisPosturePanel";
import VaronisAccountsInventory from "./VaronisAccountsInventory";
import type { InventoryList } from "@/lib/varonisPosture";

// Varonis : alertes (détection), posture des données (exposition, comptes, droits)
// et inventaire des comptes. Les onglets autres qu'« Alertes » ne sont montés qu'à
// leur ouverture : leurs requêtes sont plus lourdes.
export default function VaronisView() {
  const [tab, setTab] = useState("alerts");
  const [inventoryList, setInventoryList] = useState<InventoryList>("admins");
  // Raccourci depuis la posture : ouvre l'inventaire sur la liste demandée
  const openInventory = (list: InventoryList) => { setInventoryList(list); setTab("accounts"); };

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="alerts" className="gap-2"><Bell className="w-4 h-4" /> Alertes</TabsTrigger>
        <TabsTrigger value="posture" className="gap-2"><FolderOpen className="w-4 h-4" /> Posture des données</TabsTrigger>
        <TabsTrigger value="accounts" className="gap-2"><Users className="w-4 h-4" /> Inventaire des comptes</TabsTrigger>
      </TabsList>
      <TabsContent value="alerts"><VaronisPanel /></TabsContent>
      <TabsContent value="posture"><VaronisPosturePanel onOpenInventory={openInventory} /></TabsContent>
      <TabsContent value="accounts"><VaronisAccountsInventory list={inventoryList} onListChange={setInventoryList} /></TabsContent>
    </Tabs>
  );
}
