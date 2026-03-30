import AppLayout from "@/components/layout/AppLayout";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";

export default function Settings() {
  const [isDark, setIsDark] = useState(true);

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
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Paramètres</h1>
          <p className="text-muted-foreground mt-1">Configurez l'apparence de votre application</p>
        </div>

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
      </div>
    </AppLayout>
  );
}
