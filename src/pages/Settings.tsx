import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { useAccess } from "@/hooks/useAccess";
import UsersAdmin from "@/components/settings/UsersAdmin";

export default function Settings() {
  const [isDark, setIsDark] = useState(true);
  const { role, label, canEdit } = useAccess();

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    setIsDark(stored !== "light");
  }, []);

  const toggleTheme = (dark: boolean) => {
    setIsDark(dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
    document.documentElement.classList.toggle("light-theme", !dark);
  };

  return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Paramètres</h1>
          <p className="text-muted-foreground mt-1">Configurez l'apparence de votre application</p>
        </div>

        {role ? (
          <p className="text-sm text-muted-foreground">Votre profil : <b className="text-foreground">{label}</b>{canEdit ? "" : " (lecture seule)"}</p>
        ) : (
          <div className="kpi-card max-w-xl border-amber-500/40">
            <p className="font-medium text-amber-600">Profil en attente</p>
            <p className="text-sm text-muted-foreground">Votre compte n&apos;a pas encore de profil : demandez au RSSI de vous en attribuer un pour accéder au tableau de bord.</p>
          </div>
        )}

        <div className="kpi-card max-w-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
                {isDark ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-accent" />}
              </div>
              <div>
                <p className="font-medium text-foreground">Thème de l'interface</p>
                <p className="text-sm text-muted-foreground">
                  {isDark ? "Mode sombre activé" : "Mode clair activé"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Sun className="w-4 h-4 text-muted-foreground" />
              <Switch checked={isDark} onCheckedChange={toggleTheme} />
              <Moon className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>

        {canEdit && <UsersAdmin />}
      </div>
  );
}
