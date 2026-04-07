import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { DaxEngine } from "@/lib/DaxEngine";
import {
  ArrowLeft, Shield, Plus, Trash2, BarChart3, LineChart as LineChartIcon,
  PieChart as PieChartIcon, Hash, Target, LayoutDashboard, Database, CheckSquare,
  Calculator, Sigma, Filter, ChevronRight, GripVertical, FileSpreadsheet, Loader2,
  Calendar, Palette, Maximize, Tag, LayoutPanelLeft
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend
} from "recharts";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================
type AggregationType = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'DISTINCTCOUNT';
type WidgetType = 'kpi' | 'bar' | 'area' | 'pie';
type DateGrouping = 'none' | 'day' | 'week' | 'month' | 'quarter' | 'year';
type FilterOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'last_n_days';
type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'none';
type WidgetSize = 'small' | 'medium' | 'large';

interface FilterConfig { id: string; column: string; operator: FilterOperator; value: string; }
interface Dataset { id: string; name: string; columns: string[]; data: any[]; }
interface CustomMeasure { id: string; datasetId: string; name: string; formula: string; }
interface ChartSeries { id: string; yAxisCol: string; isMeasure: boolean; aggregation: AggregationType; color: string; }

interface WidgetConfig {
  id: string; title: string; type: WidgetType; datasetId: string;
  xAxisCol?: string; dateGrouping: DateGrouping; series: ChartSeries[]; filters: FilterConfig[];
  showLabels?: boolean;
  legendPosition?: LegendPosition;
  widgetSize?: WidgetSize;
}

interface TrackedRisk { id: string; title: string; description: string; icon: string; datasets: Dataset[]; measures: CustomMeasure[]; widgets: WidgetConfig[]; }

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

// ============================================================================
// UTILITAIRES : DATES ET FILTRES
// ============================================================================
const safeNumber = (val: any): number => {
  if (val === null || val === undefined || val === '') return NaN;
  if (typeof val === 'number') return val;
  const cleanStr = String(val).replace(/\s/g, '').replace(',', '.');
  return Number(cleanStr);
};

const safeString = (val: any): string => {
  if (val === null || val === undefined) return "";
  return String(val).trim();
};

const parseExcelDate = (rawDate: any): Date => {
  if (rawDate === null || rawDate === undefined || rawDate === '') return new Date(NaN);
  if (typeof rawDate === 'number') return new Date(Math.round((rawDate - 25569) * 86400 * 1000));
  const dateStr = String(rawDate).trim();
  const frDateMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (frDateMatch) return new Date(`${frDateMatch[3]}-${frDateMatch[2].padStart(2,'0')}-${frDateMatch[1].padStart(2,'0')}`);
  return new Date(dateStr);
};

const formatTimeGrouping = (rawDate: any, grouping: DateGrouping): string => {
  if (grouping === 'none' || !rawDate) return safeString(rawDate || 'N/A');
  const d = parseExcelDate(rawDate);
  if (isNaN(d.getTime())) return safeString(rawDate);
  const year = d.getFullYear(); const month = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  switch (grouping) {
    case 'day': return `${year}-${month}-${day}`;
    case 'month': return `${year}-${month}`;
    case 'year': return `${year}`;
    case 'quarter': return `${year}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    case 'week': {
      const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = d2.getUTCDay() || 7; d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(),0,1));
      return `${d2.getUTCFullYear()}-S${String(Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1)/7)).padStart(2, '0')}`;
    }
    default: return safeString(rawDate);
  }
};

const applyFiltersToData = (data: any[], filters: FilterConfig[]): any[] => {
  if (!filters || filters.length === 0) return data;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return data.filter(row => {
    return filters.every(f => {
      if (!f.column || f.value === '') return true;
      const rawVal = row[f.column];

      if (f.operator === 'last_n_days') {
        const rowDate = parseExcelDate(rawVal);
        if (isNaN(rowDate.getTime())) return false;
        rowDate.setHours(0, 0, 0, 0);
        const diffTime = now.getTime() - rowDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= Number(f.value);
      }

      const isDateFilter = /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(f.value) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(f.value);
      if (isDateFilter) {
        const rowDate = parseExcelDate(rawVal);
        const filterDate = parseExcelDate(f.value);
        if (!isNaN(rowDate.getTime()) && !isNaN(filterDate.getTime())) {
          rowDate.setHours(0, 0, 0, 0); filterDate.setHours(0, 0, 0, 0);
          const rTime = rowDate.getTime(); const fTime = filterDate.getTime();
          switch (f.operator) {
            case 'eq': return rTime === fTime;
            case 'neq': return rTime !== fTime;
            case 'gt': return rTime > fTime;
            case 'lt': return rTime < fTime;
          }
        }
      }

      if (rawVal === undefined || rawVal === null || rawVal === '') return f.operator === 'neq';
      const strVal = safeString(rawVal).toLowerCase();
      const filterVal = safeString(f.value).toLowerCase();

      switch (f.operator) {
        case 'eq': return strVal === filterVal;
        case 'neq': return strVal !== filterVal;
        case 'contains': return strVal.includes(filterVal);
        case 'gt':
          const numRaw = safeNumber(rawVal); const numFilt = safeNumber(f.value);
          if (!isNaN(numRaw) && !isNaN(numFilt)) return numRaw > numFilt;
          return strVal > filterVal;
        case 'lt':
          const numRawLt = safeNumber(rawVal); const numFiltLt = safeNumber(f.value);
          if (!isNaN(numRawLt) && !isNaN(numFiltLt)) return numRawLt < numFiltLt;
          return strVal < filterVal;
        default: return true;
      }
    });
  });
};

// ============================================================================
// MOTEURS D'AGRÉGATION
// ============================================================================
const aggregateMultiSeries = (rawData: any[], xAxisCol: string, dateGrouping: DateGrouping, series: ChartSeries[], measures: CustomMeasure[], filters: FilterConfig[]) => {
  const filteredData = applyFiltersToData(rawData, filters);
  if (!filteredData || filteredData.length === 0) return [];
  const groups = new Map<string, any[]>();

  filteredData.forEach(row => {
    let key = row[xAxisCol];
    if (dateGrouping !== 'none') key = formatTimeGrouping(key, dateGrouping); else key = safeString(key || 'N/A');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  const result: any[] = [];
  Array.from(groups.keys()).sort().forEach(key => {
    const rows = groups.get(key)!;
    const outRow: any = { [xAxisCol]: key };

    series.forEach(s => {
      if (s.isMeasure) {
        const m = measures.find(measure => measure.name === s.yAxisCol);
        if (m) { try { const subEngine = new DaxEngine(rows); outRow[s.id] = subEngine.evaluateMeasure(m.formula); } catch { outRow[s.id] = 0; } }
      } else {
        let aggValue = 0;
        const rawVals = rows.map(r => r[s.yAxisCol]);
        const nonBlanks = rawVals.filter(v => v !== null && v !== undefined && String(v).trim() !== "");
        const numVals = nonBlanks.map(v => safeNumber(v)).filter(v => !isNaN(v));

        if (s.aggregation === 'COUNT') {
          aggValue = nonBlanks.length;
        } else if (s.aggregation === 'DISTINCTCOUNT') {
          aggValue = new Set(nonBlanks.map(v => safeString(v).toLowerCase())).size;
        } else if (numVals.length > 0) {
          if (s.aggregation === 'SUM') aggValue = numVals.reduce((a, b) => a + b, 0);
          if (s.aggregation === 'AVERAGE') aggValue = numVals.reduce((a, b) => a + b, 0) / numVals.length;
          if (s.aggregation === 'MIN') aggValue = Math.min(...numVals);
          if (s.aggregation === 'MAX') aggValue = Math.max(...numVals);
        }

        outRow[s.id] = Math.round((aggValue + Number.EPSILON) * 100) / 100;
      }
    });
    result.push(outRow);
  });
  return result;
};

const aggregateGlobal = (rawData: any[], series: ChartSeries[], measures: CustomMeasure[], filters: FilterConfig[]): number[] => {
  if (series.length === 0) return [];
  const filteredData = applyFiltersToData(rawData, filters);
  if (filteredData.length === 0) return series.map(() => 0);

  return series.map(s => {
    if (s.isMeasure) {
      const m = measures.find(measure => measure.name === s.yAxisCol);
      if (!m) return 0;
      try { const engine = new DaxEngine(filteredData); return engine.evaluateMeasure(m.formula); } catch { return 0; }
    }

    let aggValue = 0;
    const rawVals = filteredData.map(r => r[s.yAxisCol]);
    const nonBlanks = rawVals.filter(v => v !== null && v !== undefined && String(v).trim() !== "");
    const numVals = nonBlanks.map(v => safeNumber(v)).filter(v => !isNaN(v));

    if (s.aggregation === 'COUNT') {
      aggValue = nonBlanks.length;
    } else if (s.aggregation === 'DISTINCTCOUNT') {
      aggValue = new Set(nonBlanks.map(v => safeString(v).toLowerCase())).size;
    } else if (numVals.length > 0) {
      if (s.aggregation === 'SUM') aggValue = numVals.reduce((a, b) => a + b, 0);
      if (s.aggregation === 'AVERAGE') aggValue = numVals.reduce((a, b) => a + b, 0) / numVals.length;
      if (s.aggregation === 'MIN') aggValue = Math.min(...numVals);
      if (s.aggregation === 'MAX') aggValue = Math.max(...numVals);
    }

    return Math.round((aggValue + Number.EPSILON) * 100) / 100;
  });
};

// ============================================================================
// COMPOSANT DÉDIÉ AU RENDU DU GRAPHIQUE (MÉMOÏSÉ + APPARENCE GÉRÉE)
// ============================================================================
const DashboardWidget = React.memo(({ widget, datasets, measures }: { widget: WidgetConfig, datasets: Dataset[], measures: CustomMeasure[] }) => {
  const dataset = datasets.find(d => d.id === widget.datasetId);

  const chartData = useMemo(() => {
    if (!dataset || widget.type === 'kpi') return [];
    if (!widget.xAxisCol || widget.series.length === 0) return [];
    return aggregateMultiSeries(dataset.data, widget.xAxisCol, widget.dateGrouping, widget.series, measures, widget.filters || []);
  }, [dataset?.data, widget.xAxisCol, widget.dateGrouping, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  const kpiValues = useMemo(() => {
    if (!dataset || widget.series.length === 0) return [];
    return aggregateGlobal(dataset.data, widget.series, measures, widget.filters || []);
  }, [dataset?.data, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  if (!dataset) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Source introuvable.</div>;

  if (widget.series.length === 0) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Glissez une ou plusieurs valeurs.</div>;
  }

  if (widget.type !== 'kpi' && widget.type !== 'pie' && !widget.xAxisCol) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Glissez une catégorie pour l'Axe X.</div>;
  }

  // RENDU KPI
  if (widget.type === 'kpi') {
    return (
      <div className="flex flex-col h-full justify-center items-center px-4 gap-6 overflow-y-auto">
        {widget.series.map((s, idx) => (
          <div key={s.id} className="text-center w-full">
            <div className="text-4xl font-black tracking-tight" style={{ color: s.color }}>
              {new Intl.NumberFormat('fr-FR').format(kpiValues[idx] || 0)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 font-black uppercase tracking-widest truncate">
              {s.isMeasure ? s.yAxisCol : `${s.aggregation} : ${s.yAxisCol}`}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const formatLabel = (value: number) => new Intl.NumberFormat('fr-FR').format(value);

  const legendPos = widget.legendPosition || 'bottom';
  const renderLegend = () => {
    if (legendPos === 'none') return null;
    if (legendPos === 'left') return <Legend layout="vertical" verticalAlign="middle" align="left" wrapperStyle={{ fontSize: '11px', paddingRight: '20px' }}/>;
    if (legendPos === 'right') return <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px', paddingLeft: '20px' }}/>;
    if (legendPos === 'top') return <Legend layout="horizontal" verticalAlign="top" align="center" wrapperStyle={{ fontSize: '11px', paddingBottom: '10px' }}/>;
    return <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}/>;
  };

  // RENDU CAMEMBERT (PIE)
  if (widget.type === 'pie') {
    if (!widget.xAxisCol) {
      const pieData = widget.series.map((s, idx) => ({
        name: s.isMeasure ? s.yAxisCol : `${s.aggregation} de ${s.yAxisCol}`,
        value: kpiValues[idx] || 0,
        color: s.color
      })).filter(d => d.value > 0);

      if (pieData.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center">Aucune donnée positive.</div>;

      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name"
              label={widget.showLabels !== false ? ((entry) => formatLabel(entry.value)) : false}
            >
              {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
            </Pie>
            <Tooltip formatter={(value: number) => formatLabel(value)} contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
            {renderLegend()}
          </PieChart>
        </ResponsiveContainer>
      );
    }
    else {
      if (chartData.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center">Aucune donnée.</div>;

      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey={widget.series[0].id} nameKey={widget.xAxisCol!}
              label={widget.showLabels !== false ? ((entry) => formatLabel(entry[widget.series[0].id])) : false}
            >
              {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => formatLabel(value)} contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
            {renderLegend()}
          </PieChart>
        </ResponsiveContainer>
      );
    }
  }

  // RENDU BARRES ET COURBES
  if (chartData.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center">Aucune donnée correspondant aux filtres.</div>;

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {widget.type === 'bar' ? (
          <BarChart data={chartData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={widget.xAxisCol} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
            {renderLegend()}
            {widget.series.map(s => (
                <Bar key={`bar-${s.id}`} dataKey={s.id} name={s.isMeasure ? s.yAxisCol : `${s.aggregation}(${s.yAxisCol})`} fill={s.color} radius={[2, 2, 0, 0]}
                     label={widget.showLabels !== false ? { position: 'top', fontSize: 10, fill: 'currentColor', formatter: formatLabel } : false} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={chartData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={widget.xAxisCol} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
            {renderLegend()}
            {widget.series.map(s => (
              <Area
                key={s.id} type="monotone" dataKey={s.id} name={s.isMeasure ? s.yAxisCol : `${s.aggregation}(${s.yAxisCol})`} stroke={s.color} fill={s.color} fillOpacity={0.1} strokeWidth={2}
                label={widget.showLabels !== false ? { position: 'top', fontSize: 10, fill: 'currentColor', formatter: formatLabel } : false}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});

// ============================================================================
// COMPOSANT PRINCIPAL (VIEW)
// ============================================================================
export default function RisksView() {

  const [risks, setRisks] = useState<TrackedRisk[]>(() => {
    try { const saved = localStorage.getItem("pbi_risks_v17_fixed"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      try { const serialized = JSON.stringify(risks); if (serialized.length < 4000000) localStorage.setItem("pbi_risks_v17_fixed", serialized); } catch { console.warn("Stockage saturé."); }
    }, 800);
    return () => clearTimeout(timer);
  }, [risks]);

  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);

  const [isFiltersOpen, setIsFiltersOpen] = useState(true);
  const [isVisOpen, setIsVisOpen] = useState(true);
  const [isDataOpen, setIsDataOpen] = useState(true);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1|2>(1);
  const [isImporting, setIsImporting] = useState(false);
  const [newRiskTitle, setNewRiskTitle] = useState("");
  const [newRiskDesc, setNewRiskDesc] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Dataset[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  // ============================================================================
  // LOGIQUE WIZARD
  // ============================================================================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setTimeout(() => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetsData: Dataset[] = [];
          wb.SheetNames.forEach(sheetName => {
            const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
            if (jsonData.length > 0) sheetsData.push({ id: `ds_${Date.now()}_${Math.random().toString(36).substring(7)}`, name: sheetName, columns: Object.keys(jsonData[0] as object), data: jsonData });
          });
          if (sheetsData.length === 0) throw new Error("Fichier vide");
          setAvailableSheets(sheetsData); setSelectedSheets([sheetsData[0].id]); setWizardStep(2);
        } catch { toast.error("Erreur de lecture."); } finally { setIsImporting(false); }
      }, 100);
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleSheetSelection = (id: string) => { setSelectedSheets(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]); };
  const resetWizard = () => { setWizardStep(1); setNewRiskTitle(""); setNewRiskDesc(""); setAvailableSheets([]); setSelectedSheets([]); };

  const finalizeRiskCreation = () => {
    if (selectedSheets.length === 0) return toast.error("Sélectionnez au moins une table.");
    const datasets = availableSheets.filter(s => selectedSheets.includes(s.id));
    const newRisk: TrackedRisk = { id: `risk_${Date.now()}`, title: newRiskTitle, description: newRiskDesc, icon: "shield", datasets, measures: [], widgets: [] };
    setRisks([...risks, newRisk]);
    setIsAddOpen(false); resetWizard();
    toast.success(`Rapport créé avec succès !`);
    setActiveRiskId(newRisk.id);
  };

  const handleDeleteRisk = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setRisks(risks.filter(r => r.id !== id));
    if (activeRiskId === id) setActiveRiskId(null);
  };

  // ============================================================================
  // LOGIQUE STUDIO BI
  // ============================================================================
  const activeRisk = risks.find(r => r.id === activeRiskId);
  const activeWidget = activeRisk?.widgets.find(w => w.id === activeWidgetId);
  const activeDataset = activeWidget ? activeRisk?.datasets.find(d => d.id === activeWidget.datasetId) : null;

  const updateActiveRisk = (updates: Partial<TrackedRisk>) => { setRisks(risks.map(r => r.id === activeRiskId ? { ...r, ...updates } : r)); };

  const addWidgetToStudio = () => {
    if (!activeRisk || activeRisk.datasets.length === 0) return toast.error("Importez des données d'abord.");
    const newWidget: WidgetConfig = {
      id: `w_${Date.now()}`, title: "Nouveau Visuel", type: "bar", datasetId: activeRisk.datasets[0].id,
      dateGrouping: "none", series: [], filters: [],
      showLabels: true, legendPosition: 'bottom', widgetSize: 'medium'
    };
    updateActiveRisk({ widgets: [...activeRisk.widgets, newWidget] });
    setActiveWidgetId(newWidget.id);
    setIsVisOpen(true); setIsDataOpen(true);
  };

  const updateActiveWidget = (updates: Partial<WidgetConfig>) => {
    if (!activeRisk || !activeWidgetId) return;
    // J'AI ENLEVÉ LE BLOCAGE QUI LIMITAIT LE PIE CHART ICI
    if (updates.datasetId && updates.datasetId !== activeWidget?.datasetId) { updates.xAxisCol = ""; updates.series = []; updates.filters = []; }
    updateActiveRisk({ widgets: activeRisk.widgets.map(w => w.id === activeWidgetId ? { ...w, ...updates } : w) });
  };

  const deleteActiveWidget = () => {
    if (!activeRisk || !activeWidgetId) return;
    updateActiveRisk({ widgets: activeRisk.widgets.filter(w => w.id !== activeWidgetId) });
    setActiveWidgetId(null);
  };

  const addSeriesWithData = (colName: string, isMeasure: boolean) => {
    if (!activeWidget) return;
    // J'AI ENLEVÉ LE BLOCAGE QUI LIMITAIT LE PIE CHART ICI AUSSI
    const newSeries: ChartSeries = { id: `s_${Date.now()}`, yAxisCol: colName, isMeasure, aggregation: "SUM", color: COLORS[activeWidget.series.length % COLORS.length] };
    updateActiveWidget({ series: [...activeWidget.series, newSeries] });
  };

  const addSeries = () => {
    if (!activeWidget) return;
    const newSeries: ChartSeries = { id: `s_${Date.now()}`, yAxisCol: "", isMeasure: false, aggregation: "SUM", color: COLORS[activeWidget.series.length % COLORS.length] };
    updateActiveWidget({ series: [...activeWidget.series, newSeries] });
  };

  const updateSeries = (seriesId: string, updates: Partial<ChartSeries>) => { if (!activeWidget) return; updateActiveWidget({ series: activeWidget.series.map(s => s.id === seriesId ? { ...s, ...updates } : s) }); };
  const removeSeries = (seriesId: string) => { if (!activeWidget) return; updateActiveWidget({ series: activeWidget.series.filter(s => s.id !== seriesId) }); };

  const addFilter = () => { if (!activeWidget) return; updateActiveWidget({ filters: [...(activeWidget.filters || []), { id: `f_${Date.now()}`, column: "", operator: "eq", value: "" }] }); setIsFiltersOpen(true); };
  const updateFilter = (filterId: string, updates: Partial<FilterConfig>) => { if (!activeWidget) return; updateActiveWidget({ filters: activeWidget.filters.map(f => f.id === filterId ? { ...f, ...updates } : f) }); };
  const removeFilter = (filterId: string) => { if (!activeWidget) return; updateActiveWidget({ filters: activeWidget.filters.filter(f => f.id !== filterId) }); };

  // DRAG & DROP + CHECKBOX LOGIC
  const toggleColumnInWidget = (colName: string, isMeasure: boolean, datasetId: string) => {
    if (!activeWidget) return toast.info("Sélectionnez un graphique sur le canvas d'abord.");
    if (activeWidget.datasetId !== datasetId) return toast.error("Cette donnée appartient à une autre table.");

    const isX = activeWidget.xAxisCol === colName;
    const seriesMatch = activeWidget.series.find(s => s.yAxisCol === colName);

    if (isX) { updateActiveWidget({ xAxisCol: "" }); }
    else if (seriesMatch) { removeSeries(seriesMatch.id); }
    else {
      if (!activeWidget.xAxisCol && !isMeasure && activeWidget.type !== 'kpi') { updateActiveWidget({ xAxisCol: colName }); }
      else { addSeriesWithData(colName, isMeasure); }
    }
  };

  const handleDropOnX = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.datasetId !== activeWidget?.datasetId) return toast.error("Table source différente.");
      if (data.isMeasure) return toast.error("Une mesure DAX ne peut pas être un Axe X.");
      updateActiveWidget({ xAxisCol: data.colName });
    } catch {}
  };

  const handleDropOnY = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.datasetId !== activeWidget?.datasetId) return toast.error("Table source différente.");
      addSeriesWithData(data.colName, data.isMeasure);
    } catch {}
  };

  const getWidgetGridClass = (size?: WidgetSize) => {
    if (size === 'small') return 'col-span-1';
    if (size === 'large') return 'md:col-span-2 xl:col-span-3';
    return 'md:col-span-2';
  };

  // ============================================================================
  // VUE 1 : ACCUEIL
  // ============================================================================
  if (!activeRiskId) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/50">
          <div><h1 className="text-2xl font-bold flex items-center gap-2"><Target className="w-6 h-6 text-primary" /> Rapports Power BI</h1><p className="text-sm text-muted-foreground mt-1">Créez vos modèles de données et vos rapports interactifs.</p></div>
          <Dialog open={isAddOpen} onOpenChange={(o) => { setIsAddOpen(o); if(!o) resetWizard(); }}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Nouveau Rapport</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Création du Modèle de Données</DialogTitle></DialogHeader>
              {wizardStep === 1 && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2"><Label>Nom du rapport</Label><Input value={newRiskTitle} onChange={e => setNewRiskTitle(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Description</Label><Input value={newRiskDesc} onChange={e => setNewRiskDesc(e.target.value)} /></div>
                  <div className="space-y-2 pt-4 border-t">
                    <Label className="text-primary font-bold">Fichier source (.xlsx, .csv)</Label>
                    {isImporting ? <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/10"><Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" /></div> : <div className="relative"><input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={!newRiskTitle} /><Button variant="outline" className="w-full h-24 border-dashed border-2 flex-col gap-2" disabled={!newRiskTitle}><FileSpreadsheet className="w-6 h-6" /><span>Parcourir</span></Button></div>}
                  </div>
                </div>
              )}
              {wizardStep === 2 && (
                <div className="space-y-6 py-4">
                  <div className="bg-primary/10 text-primary p-3 rounded-lg flex items-center gap-3"><Database className="w-6 h-6 shrink-0"/><div><h4 className="font-bold text-sm">Fichier analysé</h4><p className="text-xs">Cochez les tables à importer.</p></div></div>
                  <div className="max-h-[200px] overflow-y-auto space-y-2 border p-2 rounded-md">
                    {availableSheets.map(sheet => (
                      <div key={sheet.id} onClick={() => toggleSheetSelection(sheet.id)} className={`flex justify-between p-3 rounded border cursor-pointer ${selectedSheets.includes(sheet.id) ? 'bg-primary/5 border-primary shadow-sm' : 'hover:bg-muted'}`}>
                        <div className="flex items-center gap-3"><CheckSquare className={`w-5 h-5 ${selectedSheets.includes(sheet.id) ? 'text-primary' : 'opacity-30'}`} /><p className="font-bold text-sm">{sheet.name}</p></div><Badge variant="secondary">{sheet.data.length} lignes</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-4"><Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">Retour</Button><Button onClick={finalizeRiskCreation} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={selectedSheets.length === 0}>Créer et Lancer le Studio</Button></div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2">
          {risks.map((risk) => (
            <Card key={risk.id} onClick={() => setActiveRiskId(risk.id)} className="group cursor-pointer border-l-4 border-l-primary hover:-translate-y-1 shadow-sm relative">
              <button onClick={(e) => handleDeleteRisk(e, risk.id)} className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-rose-100 hover:text-rose-600 z-10 transition-all"><Trash2 className="w-4 h-4" /></button>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4 pr-8"><div className="p-2.5 rounded-lg bg-primary/10 text-primary"><Shield className="w-6 h-6" /></div><div><h3 className="font-bold text-lg truncate">{risk.title}</h3></div></div>
                <div className="flex gap-2 mb-4"><Badge variant="outline" className="text-[10px] bg-secondary/50"><Database className="w-3 h-3 mr-1"/> {risk.datasets.length} Tables</Badge><Badge variant="outline" className="text-[10px] bg-secondary/50"><BarChart3 className="w-3 h-3 mr-1"/> {risk.widgets.length} Visuels</Badge></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ============================================================================
  // VUE 2 : STUDIO POWER BI
  // ============================================================================
  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] animate-in fade-in duration-300 -m-4 bg-slate-50 dark:bg-slate-900/50">

      {/* NAVBAR STUDIO */}
      <div className="flex items-center justify-between p-3 border-b bg-background shadow-sm z-20">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => {setActiveRiskId(null); setActiveWidgetId(null)}}><ArrowLeft className="w-5 h-5" /></Button>
          <div><h2 className="font-bold text-lg leading-tight">{activeRisk?.title}</h2></div>
        </div>
        <Button variant="default" size="sm" onClick={addWidgetToStudio} className="gap-2"><Plus className="w-4 h-4"/> Nouveau Visuel</Button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* PANNEAU 1 : CANVAS */}
        <div className="flex-1 overflow-auto p-6 transition-all" onClick={() => setActiveWidgetId(null)}>
          {activeRisk?.widgets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
              <LayoutDashboard className="w-16 h-16 mb-4" /><p>Le rapport est vide.</p><p className="text-sm mt-2">Cliquez sur "Nouveau Visuel" pour commencer.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {activeRisk?.widgets.map(widget => (
                <Card
                  key={widget.id} onClick={(e) => { e.stopPropagation(); setActiveWidgetId(widget.id); setIsFiltersOpen(true); setIsVisOpen(true); setIsDataOpen(true); }}
                  className={`cursor-pointer transition-all bg-background ${getWidgetGridClass(widget.widgetSize)} ${activeWidgetId === widget.id ? 'ring-2 ring-primary shadow-lg scale-[1.01] z-10 relative' : 'hover:border-primary/50 shadow-sm'}`}
                >
                  <CardHeader className="p-3 border-b flex flex-row items-center justify-between bg-card/50">
                    <CardTitle className="text-xs font-bold uppercase text-muted-foreground truncate">{widget.title}</CardTitle>
                  </CardHeader>
                  <CardContent className={`p-3 ${widget.widgetSize === 'large' ? 'h-[400px]' : 'h-[250px]'}`}>
                    <DashboardWidget widget={widget} datasets={activeRisk.datasets} measures={activeRisk.measures} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* PANNEAU 2 : FILTRES */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-lg transition-all duration-300 overflow-hidden ${isFiltersOpen ? 'w-64' : 'w-10'}`}>
          <div onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="p-3 border-b bg-secondary/30 flex items-center justify-between cursor-pointer hover:bg-secondary/50">
            <div className="flex items-center gap-2"><Filter className="w-4 h-4 text-muted-foreground" /> {isFiltersOpen && <h3 className="font-bold text-xs uppercase tracking-wider">Filtres</h3>}</div>
            {isFiltersOpen && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>

          <div className={`flex-1 overflow-auto p-3 ${!isFiltersOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un visuel.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase text-primary">Sur ce visuel</h4>
                  <Button variant="ghost" size="sm" onClick={addFilter} className="h-6 px-1 text-[10px] text-primary"><Plus className="w-3 h-3 mr-1"/> Ajouter</Button>
                </div>
                {(!activeWidget.filters || activeWidget.filters.length === 0) && <div className="p-3 text-center border border-dashed rounded bg-muted/20 text-[10px] text-muted-foreground">Aucun filtre actif.</div>}
                <div className="space-y-3">
                  {activeWidget.filters?.map(f => (
                    <div key={f.id} className="p-2 border border-primary/20 bg-primary/5 rounded relative group space-y-2 shadow-sm">
                      <button onClick={() => removeFilter(f.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3" /></button>
                      <select value={f.column} onChange={e => updateFilter(f.id, { column: e.target.value, value: '' })} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background">
                        <option value="">Colonne...</option>{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={f.operator} onChange={e => updateFilter(f.id, { operator: e.target.value as FilterOperator })} className="w-full h-7 rounded border px-1 text-[10px] text-muted-foreground bg-background">
                        <option value="eq">Égal à</option><option value="neq">Différent de</option><option value="contains">Contient</option><option value="gt">Supérieur à</option><option value="lt">Inférieur à</option><option value="last_n_days">Derniers X jours</option>
                      </select>
                      <Input
                        type={f.operator === 'last_n_days' ? 'number' : 'text'}
                        value={f.value}
                        onChange={e => updateFilter(f.id, { value: e.target.value })}
                        placeholder={f.operator === 'last_n_days' ? 'Nombre de jours...' : 'Valeur (ex: 01/01/2024)...'}
                        className="h-7 text-xs bg-background"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PANNEAU 3 : VISUALISATIONS */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-xl transition-all duration-300 overflow-hidden ${isVisOpen ? 'w-72' : 'w-10'}`}>
          <div onClick={() => setIsVisOpen(!isVisOpen)} className="p-3 border-b bg-secondary/30 flex items-center justify-between cursor-pointer hover:bg-secondary/50">
            <div className="flex items-center gap-2"><LayoutDashboard className="w-4 h-4 text-muted-foreground" /> {isVisOpen && <h3 className="font-bold text-xs uppercase tracking-wider">Visualisations</h3>}</div>
            {isVisOpen && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>

          <div className={`flex-1 overflow-auto p-4 ${!isVisOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un visuel pour configurer ses axes.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">

                <div className="space-y-2">
                  <div className="flex justify-between items-center"><Input value={activeWidget.title} onChange={e => updateActiveWidget({ title: e.target.value })} className="h-8 text-xs font-bold w-48" /> <button onClick={deleteActiveWidget} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded"><Trash2 className="w-4 h-4"/></button></div>
                  <div className="grid grid-cols-4 gap-1.5 border-b pb-4">
                    <button onClick={() => updateActiveWidget({ type: 'bar' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'bar' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Barres"><BarChart3 className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'area' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'area' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Aires/Courbes"><LineChartIcon className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'pie' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'pie' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Secteurs"><PieChartIcon className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'kpi' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'kpi' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="KPI"><Hash className="w-4 h-4"/></button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Table Source</Label>
                  <select value={activeWidget.datasetId} onChange={e => updateActiveWidget({ datasetId: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-muted/30">{activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                </div>

                {/* DROP ZONE AXE X */}
                {activeWidget.type !== 'kpi' && (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDropOnX}
                    className="p-3 border rounded bg-secondary/10 space-y-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                        {activeWidget.type === 'pie' ? 'Légende / Catégorie' : 'Axe X'}
                      </Label>
                      {activeWidget.type === 'pie' && activeWidget.xAxisCol && (
                         <button onClick={() => updateActiveWidget({ xAxisCol: "" })} className="text-[10px] text-rose-500 font-bold hover:underline">Vider</button>
                      )}
                    </div>
                    <select value={activeWidget.xAxisCol || ''} onChange={e => updateActiveWidget({ xAxisCol: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-background"><option value="">{activeWidget.type === 'pie' ? 'Aucune (Mode Comparaison)' : 'Sélectionner...'}</option>{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}</select>

                    {activeWidget.xAxisCol && (
                      <div className="space-y-1 pt-1 border-t border-muted-foreground/10">
                        <Label className="text-[9px] uppercase font-bold text-primary flex items-center gap-1"><Calendar className="w-3 h-3"/> Filtre Temporel</Label>
                        <select value={activeWidget.dateGrouping || 'none'} onChange={e => updateActiveWidget({ dateGrouping: e.target.value as DateGrouping })} className="w-full h-7 rounded border border-primary/20 px-1 text-[10px] bg-primary/5 text-primary"><option value="none">Aucun (Standard)</option><option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option><option value="quarter">Trimestre</option><option value="year">Année</option></select>
                      </div>
                    )}
                  </div>
                )}

                {/* DROP ZONE AXE Y */}
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDropOnY}
                  className="p-3 border rounded bg-secondary/10 space-y-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                      {activeWidget.type === 'pie' ? 'Valeurs (Taille des parts)' : activeWidget.type === 'kpi' ? 'Valeur' : 'Axe Y'}
                    </Label>
                    <button onClick={addSeries} className="text-[10px] text-primary font-bold hover:underline">+ Ajouter</button>
                  </div>

                  {activeWidget.series.length === 0 && <div className="text-[10px] text-muted-foreground italic text-center">Glissez des données ici.</div>}

                  {activeWidget.series.map((s, index) => (
                    <div key={s.id} className="p-2 bg-background border rounded space-y-2 relative group">
                      <button onClick={() => removeSeries(s.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3" /></button>
                      <select value={s.yAxisCol} onChange={e => { const val = e.target.value; const isMeas = activeRisk?.measures.some(m => m.name === val); updateSeries(s.id, { yAxisCol: val, isMeasure: isMeas }); }} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background">
                        <option value="">Sélectionner...</option>
                        {activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).length! > 0 && <optgroup label="✨ Mesures DAX">{activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</optgroup>}
                        <optgroup label="Colonnes brutes">{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                      </select>

                      {!s.isMeasure && (
                        <select value={s.aggregation} onChange={e => updateSeries(s.id, { aggregation: e.target.value as AggregationType })} className="w-full h-7 rounded border px-1 text-[10px] bg-secondary/30 text-muted-foreground">
                          <option value="SUM">Somme</option><option value="AVERAGE">Moyenne</option><option value="COUNT">Nombre</option><option value="MAX">Maximum</option><option value="MIN">Minimum</option><option value="DISTINCTCOUNT">Comptage distinct</option>
                        </select>
                      )}

                      {activeWidget.type !== 'pie' && (
                        <div className="flex gap-1">{COLORS.slice(0,5).map(c => <button key={c} onClick={() => updateSeries(s.id, { color: c })} className={`w-4 h-4 rounded-full ${s.color === c ? 'ring-1 ring-primary' : ''}`} style={{backgroundColor: c}}/>)}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* NOUVEAU BLOC : APPARENCE (FORMATAGE) */}
                <div className="pt-2 border-t space-y-3">
                  <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-1"><Palette className="w-3 h-3"/> Apparence</h4>

                  {activeWidget.type !== 'kpi' && (
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground"><Tag className="w-3 h-3"/> Étiquettes de données</Label>
                      <input type="checkbox" checked={activeWidget.showLabels !== false} onChange={(e) => updateActiveWidget({ showLabels: e.target.checked })} className="w-4 h-4 accent-primary" />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1 text-muted-foreground"><Maximize className="w-3 h-3"/> Taille du visuel</Label>
                    <select value={activeWidget.widgetSize || 'medium'} onChange={e => updateActiveWidget({ widgetSize: e.target.value as WidgetSize })} className="w-full h-7 rounded border px-1 text-xs bg-background">
                      <option value="small">Petit (1 colonne)</option>
                      <option value="medium">Moyen (2 colonnes)</option>
                      <option value="large">Grand (Largeur complète)</option>
                    </select>
                  </div>

                  {activeWidget.type !== 'kpi' && (
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground"><LayoutPanelLeft className="w-3 h-3"/> Position de la légende</Label>
                      <select value={activeWidget.legendPosition || 'bottom'} onChange={e => updateActiveWidget({ legendPosition: e.target.value as LegendPosition })} className="w-full h-7 rounded border px-1 text-xs bg-background">
                        <option value="bottom">En bas</option>
                        <option value="top">En haut</option>
                        <option value="left">À gauche</option>
                        <option value="right">À droite</option>
                        <option value="none">Masquer la légende</option>
                      </select>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>

        {/* PANNEAU 4 : DONNÉES */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-2xl transition-all duration-300 overflow-hidden ${isDataOpen ? 'w-64' : 'w-10'}`}>
          <div onClick={() => setIsDataOpen(!isDataOpen)} className="p-3 border-b bg-secondary/30 flex items-center justify-between cursor-pointer hover:bg-secondary/50">
            <div className="flex items-center gap-2"><Database className="w-4 h-4 text-muted-foreground" /> {isDataOpen && <h3 className="font-bold text-xs uppercase tracking-wider">Données</h3>}</div>
            {isDataOpen && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>

          <div className={`flex-1 overflow-auto p-2 ${!isDataOpen && 'hidden'}`}>
            {activeRisk?.datasets.map(ds => (
              <div key={ds.id} className="text-sm">
                <div className="flex items-center gap-2 p-2 bg-muted/50 rounded font-bold text-foreground">
                  <Database className="w-3.5 h-3.5 text-muted-foreground"/> {ds.name}
                </div>
                <div className="pl-2 space-y-1 mt-1 border-l ml-3 pb-2">

                  {activeRisk.measures.filter(m => m.datasetId === ds.id).map(m => {
                    const isChecked = activeWidget?.datasetId === ds.id && activeWidget?.series.some(s => s.yAxisCol === m.name);
                    return (
                      <div
                        key={m.id} draggable
                        onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: m.name, isMeasure: true, datasetId: ds.id }))}
                        className="flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground" />
                        <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(m.name, true, ds.id)} className="accent-primary" />
                        <Calculator className="w-3 h-3 text-primary"/> <span className="text-primary font-medium">{m.name}</span>
                      </div>
                    );
                  })}

                  {ds.columns.map(col => {
                    const isChecked = activeWidget?.datasetId === ds.id && (activeWidget?.xAxisCol === col || activeWidget?.series.some(s => s.yAxisCol === col));
                    return (
                      <div
                        key={col} draggable
                        onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: col, isMeasure: false, datasetId: ds.id }))}
                        className="flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground" />
                        <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(col, false, ds.id)} className="accent-primary" />
                        <Sigma className="w-3 h-3 text-muted-foreground"/> <span className="text-muted-foreground">{col}</span>
                      </div>
                    );
                  })}

                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}