import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, PenLine, Shield, Bell, Settings, Plug, BookOpen,
  ShieldAlert, Users, Mail, Radar, LogOut, ChevronLeft, ChevronRight
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/saisie", label: "Saisie des données", icon: PenLine },
  { path: "/gouvernance", label: "Revue des Politiques", icon: BookOpen },
  { path: "/security-ops", label: "PAS & Audits", icon: ShieldAlert },
  { path: "/sensibilisation", label: "Sensibilisation", icon: Users },
  { path: "/messagerie", label: "Messagerie SSI", icon: Mail },
  { path: "/risques", label: "Suivi des Risques", icon: Radar },
  { path: "/alertes", label: "Alertes", icon: Bell },
  { path: "/connecteurs", label: "Connecteurs", icon: Plug },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  // État pour savoir si la sidebar est "verrouillée" ouverte ou si on est en survol
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isExpanded = isPinned || isHovered;

  return (
    <div className="flex min-h-screen">
      {/* SIDEBAR */}
      <aside
        className={`border-r border-border flex flex-col bg-sidebar shrink-0 sticky top-0 h-screen transition-all duration-300 ease-in-out ${isExpanded ? "w-64" : "w-20"}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            {isExpanded && (
              <div className="animate-in fade-in duration-300 whitespace-nowrap">
                <h1 className="text-sm font-bold text-foreground tracking-tight">KPI SSI</h1>
                <p className="text-xs text-muted-foreground">Indicateurs SSI</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-link flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location.pathname === item.path ? "active bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {isExpanded && <span className="text-sm animate-in fade-in duration-300">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-border flex flex-col gap-2">
          <Link to="/parametres" className="nav-link flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <Settings className="w-5 h-5 shrink-0" />
            {isExpanded && <span className="text-sm">Paramètres</span>}
          </Link>

          {/* Bouton pour pinner la sidebar */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3"
            onClick={() => setIsPinned(!isPinned)}
          >
            {isPinned ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            {isExpanded && <span className="text-sm">{isPinned ? "Réduire" : "Épingler"}</span>}
          </Button>
        </div>
      </aside>

      {/* ZONE CONTENU */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background shrink-0">
          <div className="text-sm font-medium text-muted-foreground">
            Bonjour, <span className="text-foreground">{user?.email}</span>
          </div>

          <div className="flex items-center">
            <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50">
              <LogOut className="w-4 h-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-8 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}