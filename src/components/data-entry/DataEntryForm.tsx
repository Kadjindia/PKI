import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { CATEGORY_LABELS, KpiCategory } from "@/types/kpi";
import { Save, CheckCircle2 } from "lucide-react";

export default function DataEntryForm() {
  const { kpis, addEntry, getLatestValue } = useKpi();
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [activeCategory, setActiveCategory] = useState<KpiCategory>("messagerie");

  const categories = Object.keys(CATEGORY_LABELS) as KpiCategory[];
  const filteredKpis = kpis.filter((k) => k.category === activeCategory);

  const handleSave = () => {
    Object.entries(values).forEach(([kpiId, val]) => {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        addEntry({ kpiId, value: num, period });
      }
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setValues({});
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Saisie des données</h1>
          <p className="text-sm text-muted-foreground mt-1">Renseignez les valeurs pour la période sélectionnée</p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? "Enregistré !" : "Enregistrer"}
        </button>
      </div>

      {/* Period selector */}
      <div className="glass-panel p-4 flex items-center gap-4">
        <label className="text-sm font-medium text-muted-foreground">Période :</label>
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-secondary/50 overflow-x-auto">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
              activeCategory === cat
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Form grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredKpis.map((kpi) => {
          const currentVal = getLatestValue(kpi.id);
          return (
            <div key={kpi.id} className="glass-panel p-4 space-y-2">
              <label className="text-sm font-medium text-foreground">{kpi.name}</label>
              {kpi.description && (
                <p className="text-xs text-muted-foreground">{kpi.description}</p>
              )}
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  placeholder={currentVal !== undefined ? `Actuel: ${currentVal}` : "Valeur"}
                  value={values[kpi.id] || ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [kpi.id]: e.target.value }))}
                  className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-xs text-muted-foreground w-8">
                  {kpi.unit === "pourcentage" || kpi.unit === "taux" ? "%" : "#"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
