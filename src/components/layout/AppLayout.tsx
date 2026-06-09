import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, PenLine, Shield, Bell, Settings, Plug, BookOpen,
  ShieldAlert, Users, Mail, Radar, ChevronLeft, ChevronRight, LogOut,
  User, Lock, FileText, ChevronDown
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import ProfileModal from "@/components/profile/ProfileModal";
import { supabase } from "@/integrations/supabase/client";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/gouvernance", label: "Revue des Politiques", icon: BookOpen },
  { path: "/security-ops", label: "PAS & Audits", icon: ShieldAlert },
  { path: "/sensibilisation", label: "Sensibilisation", icon: Users },
  { path: "/messagerie", label: "Messagerie SSI", icon: Mail },
  { path: "/risques", label: "Suivi des Risques", icon: Radar },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const [isPinned, setIsPinned] = useState(() => localStorage.getItem("sidebarPinned") === "true");
  const [isHovered, setIsHovered] = useState(false);

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [customInitials, setCustomInitials] = useState(() => localStorage.getItem('userInitials') || '');
  const [firstName, setFirstName] = useState('');

  // États pour le minuteur de 2 minutes
  const [showGreeting, setShowGreeting] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // NOUVEAU : État pour l'effet "machine à écrire"
  const [visibleChars, setVisibleChars] = useState(0);

  const greetingName = firstName ? firstName : (user?.email || "");
  const prefixText = "Bonjour, ";
  const suffixText = " 👋";

  const togglePin = () => {
    const newState = !isPinned;
    setIsPinned(newState);
    localStorage.setItem("sidebarPinned", String(newState));
  };

  const isExpanded = isPinned || isHovered;

  // 1. GESTION DE L'EFFET MACHINE À ÉCRIRE
  useEffect(() => {
    const totalChars = prefixText.length + greetingName.length + suffixText.length;
    if (visibleChars < totalChars) {
      const timer = setTimeout(() => {
        setVisibleChars((prev) => prev + 1);
      }, 50); // VITESSE DE FRAPPE : 50ms par lettre (ajustable)
      return () => clearTimeout(timer);
    }
  }, [visibleChars, greetingName]);

  // Redémarrer l'animation proprement si les données chargent après
  useEffect(() => {
    setVisibleChars(0);
  }, [greetingName]);

  // Fonction pour afficher uniquement les lettres "tapées"
  const getVisibleText = (text: string, startIndex: number) => {
    const charsToShow = Math.max(0, visibleChars - startIndex);
    return text.slice(0, charsToShow);
  };

  // 2. DISPARITION APRÈS 2 MINUTES
  useEffect(() => {
    const fadeOutTimer = setTimeout(() => {
      setIsFadingOut(true);
    }, 119000);

    const removeTimer = setTimeout(() => {
      setShowGreeting(false);
    }, 120000);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        const { data, error } = await supabase
          .from('users')
          .select('initials, first_name')
          .eq('id', user.id)
          .single();

        if (data && !error) {
          if (data.initials) {
            setCustomInitials(data.initials);
            localStorage.setItem('userInitials', data.initials);
          }
          if (data.first_name) {
            setFirstName(data.first_name);
          }
        }
      }
    };

    fetchUserData();
  }, [user]);

  return (
    <div className="flex min-h-screen">
      {/* --- BARRE LATÉRALE --- */}
      <aside className={`border-r border-border flex flex-col bg-sidebar shrink-0 sticky top-0 h-screen z-50 transition-all duration-300 ease-in-out ${isExpanded ? "w-64" : "w-20"}`} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <div className="p-6 border-b border-border overflow-hidden h-[85px] flex items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            {isExpanded && (
              <div className="whitespace-nowrap animate-in fade-in duration-300">
                <h1 className="text-sm font-bold text-foreground tracking-tight">KPI SSI</h1>
                <p className="text-xs text-muted-foreground">Indicateurs SSI</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map((item) => (
            <Link key={item.path} to={item.path} className={`nav-link flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${location.pathname === item.path ? "active bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={!isExpanded ? item.label : undefined}>
              <item.icon className="w-5 h-5 shrink-0" />
              {isExpanded && <span className="text-sm font-medium whitespace-nowrap animate-in fade-in duration-300">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-border flex flex-col gap-2 overflow-hidden">
          <Link to="/parametres" className={`nav-link flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${location.pathname === "/parametres" ? "active bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={!isExpanded ? "Paramètres" : undefined}>
            <Settings className="w-5 h-5 shrink-0" />
            {isExpanded && <span className="text-sm font-medium whitespace-nowrap animate-in fade-in duration-300">Paramètres</span>}
          </Link>

          <button onClick={togglePin} className="flex items-center gap-3 px-3 py-2.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full text-left" title={!isExpanded ? (isPinned ? "Réduire" : "Épingler") : undefined}>
            {isPinned ? <ChevronLeft className="w-5 h-5 shrink-0" /> : <ChevronRight className="w-5 h-5 shrink-0" />}
            {isExpanded && <span className="text-sm font-medium whitespace-nowrap animate-in fade-in duration-300">{isPinned ? "Réduire" : "Épingler"}</span>}
          </button>
        </div>
      </aside>

      {/* --- ZONE PRINCIPALE --- */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-[85px] border-b border-border flex items-center justify-between px-8 bg-background shrink-0">

          {/* ANIMATION DU MESSAGE DE BIENVENUE */}
          <div className="flex-1">
            {showGreeting && (
              <div
                className={`inline-block text-xl font-semibold text-foreground transition-all duration-1000 ease-out h-8 flex items-center
                  ${isFadingOut ? 'opacity-0 -translate-y-2 blur-sm' : 'opacity-100'}`}
              >
                {getVisibleText(prefixText, 0)}

                <span className="bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent px-1">
                  {getVisibleText(greetingName, prefixText.length)}
                </span>

                {getVisibleText(suffixText, prefixText.length + greetingName.length)}
              </div>
            )}
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <span className="text-sm font-medium text-foreground">
                {user?.email}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>

            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-card rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.1)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-border py-2 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="px-2 py-1 space-y-1">
                  <button onClick={() => { setIsUserMenuOpen(false); setIsProfileModalOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <User className="w-4 h-4" /> Modifier le profil
                  </button>
                  <Link to="/change-password" onClick={() => setIsUserMenuOpen(false)} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Lock className="w-4 h-4" /> Changer le mot de passe
                  </Link>
                </div>
                <div className="h-px bg-border my-1"></div>
                <div className="px-2 py-1">
                  <button onClick={() => { setIsUserMenuOpen(false); signOut(); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors">
                    <LogOut className="w-4 h-4" /> Déconnexion
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-background">
          <div className="p-8 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Modale de Profil */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          window.dispatchEvent(new Event("focus"));
        }}
        userEmail={user?.email}
        currentInitials={customInitials}
        onSaveProfile={(newInitials) => setCustomInitials(newInitials)}
      />

    </div>
  );
}