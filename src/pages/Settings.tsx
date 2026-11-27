import { useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Palette, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAccess } from "@/hooks/useAccess";
import UsersAdmin from "@/components/settings/UsersAdmin";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "@/lib/theme";

/** Aperçu miniature d'un thème (bandeaux gris sur fond clair, sombre ou partagé). */
function ThemePreview({ kind }: { readonly kind: ThemeChoice }) {
  const bars = (tone: string) => (
    <div className="space-y-2 p-3">
      <div className={`h-1.5 rounded-full ${tone}`} />
      <div className={`h-1.5 rounded-full ${tone}`} />
      <div className={`h-1.5 rounded-full ${tone}`} />
    </div>
  );
  if (kind === "system") {
    return (
      <div className="grid grid-cols-2 rounded-lg overflow-hidden h-[70px] ring-1 ring-border">
        <div className="bg-slate-100">{bars("bg-slate-300")}</div>
        <div className="bg-slate-900">{bars("bg-slate-600")}</div>
      </div>
    );
  }
  return <div className={`rounded-lg h-[70px] ring-1 ring-border ${kind === "dark" ? "bg-slate-900" : "bg-slate-100"}`}>{bars(kind === "dark" ? "bg-slate-600" : "bg-slate-300")}</div>;
}

const THEMES: { key: ThemeChoice; label: string; icon: string; sub?: string }[] = [
  { key: "light", label: "Clair", icon: "☀️" },
  { key: "dark", label: "Sombre", icon: "🌙" },
  { key: "system", label: "Système", icon: "💻", sub: "suit le réglage de l'ordinateur" },
];

function Section({ icon: Icon, title, sub, children }: {
  readonly icon: typeof Palette; readonly title: string; readonly sub?: string; readonly children: React.ReactNode;
}) {
  return (
    <section className="kpi-card space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0"><Icon className="w-4.5 h-4.5 text-primary" /></div>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function AccountRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { role, label, canEdit } = useAccess();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const choose = (t: ThemeChoice) => { setTheme(t); setThemeChoice(t); };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Paramètres</h1>
        <p className="text-muted-foreground mt-1">Votre compte et l&apos;apparence de l&apos;application</p>
      </div>

      {!role && (
        <div className="kpi-card border-amber-500/40">
          <p className="font-medium text-amber-600">Profil en attente</p>
          <p className="text-sm text-muted-foreground">Votre compte n&apos;a pas encore de profil : demandez au RSSI de vous en attribuer un pour accéder au tableau de bord.</p>
        </div>
      )}

      <Section icon={UserRound} title="Mon compte">
        <div>
          <AccountRow label="Adresse e-mail">{user?.email ?? "—"}</AccountRow>
          <AccountRow label="Rôle">
            <b>{label}</b>{role && !canEdit && <span className="text-muted-foreground"> · lecture seule</span>}
          </AccountRow>
          <AccountRow label="Mot de passe">
            <Link to="/change-password" className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted">
              <KeyRound className="w-4 h-4" /> Modifier le mot de passe
            </Link>
          </AccountRow>
        </div>
      </Section>

      <Section icon={Palette} title="Apparence" sub="Choix mémorisé sur ce poste.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" role="radiogroup" aria-label="Thème de l'interface">
          {THEMES.map((t) => {
            const active = theme === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(t.key)}
                className={`rounded-xl border-2 p-3 text-center transition-colors ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
              >
                <ThemePreview kind={t.key} />
                <div className={`mt-3 text-sm ${active ? "font-semibold text-primary" : "text-foreground"}`}><span aria-hidden="true">{t.icon}</span> {t.label}</div>
                {t.sub && <div className="text-xs text-muted-foreground">{t.sub}</div>}
              </button>
            );
          })}
        </div>
      </Section>

      {canEdit && <UsersAdmin />}
    </div>
  );
}
