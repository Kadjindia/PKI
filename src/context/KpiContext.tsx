import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { KpiDefinition, KpiEntry, PeriodFilter } from "@/types/kpi";
import { DEFAULT_KPIS, SAMPLE_ENTRIES } from "@/data/defaultIndicators";

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
}

const KpiContext = createContext<KpiContextType | null>(null);

export function KpiProvider({ children }: { children: ReactNode }) {
  const [kpis, setKpis] = useState<KpiDefinition[]>(DEFAULT_KPIS);
  const [entries, setEntries] = useState<KpiEntry[]>(SAMPLE_ENTRIES);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("monthly");

  const addEntry = useCallback((entry: Omit<KpiEntry, "id" | "createdAt">) => {
    const newEntry: KpiEntry = {
      ...entry,
      id: `${entry.kpiId}-${entry.period}-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => {
      const existing = prev.findIndex((e) => e.kpiId === entry.kpiId && e.period === entry.period);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], value: entry.value, updatedAt: new Date().toISOString() };
        return updated;
      }
      return [...prev, newEntry];
    });
  }, []);

  const updateEntry = useCallback((id: string, value: number) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, value, updatedAt: new Date().toISOString() } : e)));
  }, []);

  const addKpi = useCallback((kpi: Omit<KpiDefinition, "id">) => {
    const newKpi: KpiDefinition = { ...kpi, id: `custom-${Date.now()}` };
    setKpis((prev) => [...prev, newKpi]);
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
      value={{ kpis, entries, periodFilter, setPeriodFilter, addEntry, updateEntry, addKpi, getLatestValue, getEntriesForKpi, getPreviousValue }}
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
