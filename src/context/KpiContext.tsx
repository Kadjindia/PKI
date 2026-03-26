import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { KpiDefinition, KpiEntry, PeriodFilter } from "@/types/kpi";
import { DEFAULT_KPIS } from "@/data/defaultIndicators";
import {
  fetchKpiDefinitions,
  fetchKpiEntries,
  addKpiEntry,
  updateKpiEntry as apiUpdateEntry,
  deleteKpiEntry,
  upsertKpiDefinition,
  seedDefaultKpis,
} from "@/lib/supabase-kpi";
import { toast } from "sonner";

interface KpiContextType {
  kpis: KpiDefinition[];
  entries: KpiEntry[];
  periodFilter: PeriodFilter;
  setPeriodFilter: (f: PeriodFilter) => void;
  addEntry: (entry: Omit<KpiEntry, "id" | "createdAt">) => void;
  addEntryFromFile: (entry: Omit<KpiEntry, "id" | "createdAt">) => void;
  updateEntry: (id: string, value: number) => void;
  removeEntry: (id: string) => void;
  addKpi: (kpi: Omit<KpiDefinition, "id">) => void;
  getLatestValue: (kpiId: string) => number | undefined;
  getEntriesForKpi: (kpiId: string) => KpiEntry[];
  getPreviousValue: (kpiId: string) => number | undefined;
  loading: boolean;
  refreshData: () => Promise<void>;
}

const KpiContext = createContext<KpiContextType | null>(null);

export function KpiProvider({ children }: { children: ReactNode }) {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("monthly");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Seed defaults if empty
      await seedDefaultKpis(DEFAULT_KPIS);
      const [defs, ents] = await Promise.all([fetchKpiDefinitions(), fetchKpiEntries()]);
      setKpis(defs);
      setEntries(ents);
    } catch (err) {
      console.error("Failed to load KPI data:", err);
      toast.error("Erreur de chargement des données");
      // Fallback to defaults for offline dev
      setKpis(DEFAULT_KPIS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addEntry = useCallback(async (entry: Omit<KpiEntry, "id" | "createdAt">) => {
    try {
      const newEntry = await addKpiEntry({
        kpiId: entry.kpiId,
        value: entry.value,
        period: entry.period,
      });
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.kpiId === entry.kpiId && e.period === entry.period && (!e.source || e.source.type === "manual"));
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = newEntry;
          return updated;
        }
        return [...prev, newEntry];
      });
      toast.success("Valeur enregistrée");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'enregistrement");
    }
  }, []);

  const addEntryFromFile = useCallback(async (_entry: Omit<KpiEntry, "id" | "createdAt">) => {
    // File entries are added via the edge function; just refresh
    await loadData();
  }, [loadData]);

  const updateEntry = useCallback(async (id: string, value: number) => {
    try {
      await apiUpdateEntry(id, value);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, value, updatedAt: new Date().toISOString() } : e)));
      toast.success("Valeur mise à jour");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la mise à jour");
    }
  }, []);

  const removeEntry = useCallback(async (id: string) => {
    try {
      await deleteKpiEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("Entrée supprimée");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la suppression");
    }
  }, []);

  const addKpi = useCallback(async (kpi: Omit<KpiDefinition, "id">) => {
    try {
      const newKpi = await upsertKpiDefinition(kpi);
      setKpis((prev) => [...prev, newKpi]);
      toast.success("Indicateur ajouté");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'ajout");
    }
  }, []);

  const sortedEntries = [...entries].sort((a, b) => a.period.localeCompare(b.period));

  const getEntriesForKpi = useCallback(
    (kpiId: string) => sortedEntries.filter((e) => e.kpiId === kpiId),
    [sortedEntries]
  );

  const getLatestValue = useCallback(
    (kpiId: string) => {
      const kpiEntries = getEntriesForKpi(kpiId);
      return kpiEntries.length > 0 ? kpiEntries[kpiEntries.length - 1].value : undefined;
    },
    [getEntriesForKpi]
  );

  const getPreviousValue = useCallback(
    (kpiId: string) => {
      const kpiEntries = getEntriesForKpi(kpiId);
      return kpiEntries.length > 1 ? kpiEntries[kpiEntries.length - 2].value : undefined;
    },
    [getEntriesForKpi]
  );

  return (
    <KpiContext.Provider
      value={{
        kpis, entries, periodFilter, setPeriodFilter,
        addEntry, addEntryFromFile, updateEntry, removeEntry, addKpi,
        getLatestValue, getEntriesForKpi, getPreviousValue,
        loading, refreshData: loadData,
      }}
    >
      {children}
    </KpiContext.Provider>
  );
}

export function useKpi() {
  const ctx = useContext(KpiContext);
  if (!ctx) throw new Error("useKpi must be used within KpiProvider");
  return ctx;
}
