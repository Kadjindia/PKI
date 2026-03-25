import { useKpi } from "@/context/KpiContext";
import { PeriodFilter } from "@/types/kpi";

const FILTERS: { value: PeriodFilter; label: string }[] = [
  { value: "monthly", label: "Mensuel" },
  { value: "quarterly", label: "Trimestriel" },
  { value: "yearly", label: "Annuel" },
];

export default function PeriodFilterBar() {
  const { periodFilter, setPeriodFilter } = useKpi();

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary/50">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => setPeriodFilter(f.value)}
          className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
            periodFilter === f.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
