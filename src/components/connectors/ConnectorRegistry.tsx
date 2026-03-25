import { DataConnector } from "@/types/kpi";
import { FileSpreadsheet, Globe, BarChart3, Database, Plug, Settings } from "lucide-react";

const ICON_MAP: Record<string, typeof Globe> = {
  excel: FileSpreadsheet,
  csv: FileSpreadsheet,
  powerbi: BarChart3,
  api: Globe,
  sharepoint: Database,
};

const DEFAULT_CONNECTORS: DataConnector[] = [
  {
    id: "excel-import",
    name: "Import Excel/CSV",
    type: "excel",
    icon: "excel",
    description: "Importez des fichiers Excel ou CSV pour alimenter vos indicateurs",
    status: "connected",
  },
  {
    id: "powerbi-connect",
    name: "Power BI",
    type: "powerbi",
    icon: "powerbi",
    description: "Connectez vos rapports Power BI pour une visualisation intégrée",
    status: "disconnected",
  },
  {
    id: "sharepoint-sync",
    name: "SharePoint",
    type: "sharepoint",
    icon: "sharepoint",
    description: "Synchronisez automatiquement depuis les listes SharePoint",
    status: "disconnected",
  },
  {
    id: "api-siem",
    name: "API SIEM/SOC",
    type: "api",
    icon: "api",
    description: "Collecte automatique depuis vos outils de sécurité (SIEM, EDR, etc.)",
    status: "disconnected",
  },
];

export default function ConnectorRegistry() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Plug className="w-5 h-5 text-primary" />
          Connecteurs de données
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configurez les sources de données pour alimenter automatiquement vos indicateurs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DEFAULT_CONNECTORS.map((connector) => {
          const Icon = ICON_MAP[connector.icon] || Globe;
          return (
            <div key={connector.id} className="glass-panel p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{connector.name}</div>
                    <div className="text-xs text-muted-foreground">{connector.description}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connector.status === "connected" ? "bg-success" : connector.status === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                  <span className="text-xs text-muted-foreground capitalize">
                    {connector.status === "connected" ? "Connecté" : connector.status === "error" ? "Erreur" : "Non connecté"}
                  </span>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  <Settings className="w-3 h-3" />
                  {connector.status === "connected" ? "Configurer" : "Connecter"}
                </button>
              </div>

              {connector.lastSync && (
                <p className="text-[10px] text-muted-foreground">
                  Dernière synchro : {new Date(connector.lastSync).toLocaleDateString("fr-FR")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Architecture note */}
      <div className="glass-panel p-5 border-l-4 border-l-primary">
        <h3 className="text-sm font-semibold text-foreground mb-2">Architecture d'intégration</h3>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>• <span className="text-foreground font-medium">Import fichiers</span> : Upload Excel/CSV avec mapping automatique vers les KPIs</li>
          <li>• <span className="text-foreground font-medium">Power BI</span> : Embed iframe ou lien direct vers les rapports</li>
          <li>• <span className="text-foreground font-medium">SharePoint</span> : Synchronisation via API Microsoft Graph</li>
          <li>• <span className="text-foreground font-medium">API SIEM</span> : Webhooks ou polling programmé pour collecte automatique</li>
          <li>• <span className="text-foreground font-medium">Extensible</span> : Ajoutez de nouveaux connecteurs sans modifier la structure</li>
        </ul>
      </div>
    </div>
  );
}
