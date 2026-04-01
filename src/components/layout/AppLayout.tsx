import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, PenLine, Shield, Bell, Settings, Plug, BookOpen, ShieldAlert, Users, Mail } from "lucide-react"; // <-- Ajout de Mail

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/saisie", label: "Saisie des données", icon: PenLine },
  { path: "/gouvernance", label: "Revue des Politiques", icon: BookOpen },
  { path: "/security-ops", label: "PAS & Audits", icon: ShieldAlert },
  { path: "/sensibilisation", label: "Sensibilisation", icon: Users },
  { path: "/messagerie", label: "Messagerie SSI", icon: Mail }, // <-- LE NOUVEAU MENU EST ICI
  { path: "/alertes", label: "Alertes", icon: Bell },
  { path: "/connecteurs", label: "Connecteurs", icon: Plug },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border flex flex-col bg-sidebar shrink-0">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">KPI SSI</h1>
              <p className="text-xs text-muted-foreground">Indicateurs SSI</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-link ${location.pathname === item.path ? "active" : ""}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <Link to="/parametres" className={`nav-link ${location.pathname === "/parametres" ? "active" : ""}`}>
            <Settings className="w-4 h-4" />
            Paramètres
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-[1600px] mx-auto">{children}</div>
      </main>
    </div>
  );
}