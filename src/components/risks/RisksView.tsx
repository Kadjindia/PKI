import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { DaxEngine } from "@/lib/DaxEngine";
import { supabase } from "@/integrations/supabase/client";

import {
  ArrowLeft, Shield, Plus, Trash2, BarChart3, LineChart as LineChartIcon,
  PieChart as PieChartIcon, Hash, Target, LayoutDashboard, Database, CheckSquare,
  Calculator, Sigma, Filter, ChevronRight, ChevronDown, GripVertical, FileSpreadsheet, Loader2,
  Calendar, Palette, Maximize, Tag, LayoutPanelLeft, AlertTriangle, Edit2, Combine
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend
} from "recharts";
import { toast } from "sonner";

// ============================================================================
// CONSTANTES GLOBALES DE SÉCURITÉ
// ============================================================================
const MAX_ROWS_PER_DATASET = 5000; // Limite pour éviter le crash du navigateur et de l'API Supabase
const MAX_PAYLOAD_SIZE = 4500000; // ~4.5MB limite pour l'upsert HTTP

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

interface ChartSeries {
  id: string;
  yAxisCol: string;
  isMeasure: boolean;
  aggregation: AggregationType;
  color: string;
  alias?: string;
}

interface WidgetConfig {
  id: string; title: string; type: WidgetType; datasetId: string;
  xAxisCol?: string; dateGrouping: DateGrouping; series: ChartSeries[]; filters: FilterConfig[];
  showLabels?: boolean;
  legendPosition?: LegendPosition;
  widgetSize?: WidgetSize;
}

interface TrackedRisk {
  id: string; title: string; description: string; icon: string;
  datasets: Dataset[]; measures: CustomMeasure[]; widgets: WidgetConfig[];
}

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
// COMPOSANT DÉDIÉ AU RENDU DU GRAPHIQUE
// ============================================================================
const DashboardWidget = React.memo(({ widget, datasets, measures }: { widget: WidgetConfig, datasets: Dataset[], measures: CustomMeasure[] }) => {
  const dataset = datasets.find(d => d.id === widget.datasetId);

  const getSeriesName = (s: ChartSeries) => {
    if (s.alias && s.alias.trim() !== "") return s.alias;
    return s.isMeasure ? s.yAxisCol : `${s.aggregation} : ${s.yAxisCol}`;
  };

  const chartData = useMemo(() => {
    if (!dataset || widget.type === 'kpi') return [];
    if (!widget.xAxisCol || widget.series.length === 0) return [];
    return aggregateMultiSeries(dataset.data, widget.xAxisCol, widget.dateGrouping, widget.series, measures, widget.filters || []);
  }, [dataset?.data, widget.xAxisCol, widget.dateGrouping, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  const kpiValues = useMemo(() => {
    if (!dataset || widget.series.length === 0) return [];
    return aggregateGlobal(dataset.data, widget.series, measures, widget.filters || []);
  }, [dataset?.data, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  if (!dataset) return <div className="flex h-full items-center justify-center text-xs text-rose-500 font-bold text-center px-4">Source de données introuvable.</div>;

  if (widget.series.length === 0) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Sélectionnez les données à analyser.</div>;
  }

  if (widget.type !== 'kpi' && widget.type !== 'pie' && !widget.xAxisCol) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Définissez l'Axe de répartition (ex: Mois, Entité).</div>;
  }

  if (widget.type === 'kpi') {
    return (
      <div className="flex flex-col h-full justify-center items-center px-4 gap-6 overflow-y-auto">
        {widget.series.map((s, idx) => (
          <div key={s.id} className="text-center w-full">
            <div className="text-4xl font-black tracking-tight" style={{ color: s.color }}>
              {new Intl.NumberFormat('fr-FR').format(kpiValues[idx] || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-2 font-black uppercase tracking-widest truncate" title={s.yAxisCol}>
              {getSeriesName(s)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const formatLabel = (value: number) => new Intl.NumberFormat('fr-FR').format(value);

  const renderPieLabel = (props: any) => {
    const { value, percent } = props;
    if (!value) return null;
    const formattedValue = new Intl.NumberFormat('fr-FR').format(value);
    const formattedPercent = (percent * 100).toFixed(1).replace('.', ',');
    return `${formattedValue} (${formattedPercent}%)`;
  };

  const renderPieTooltip = (value: number, name: string, props: any) => {
    const percentStr = props.payload.percent !== undefined ? ` (${(props.payload.percent * 100).toFixed(1).replace('.', ',')}%)` : '';
    return [`${new Intl.NumberFormat('fr-FR').format(value)}${percentStr}`, name];
  };

  const legendPos = widget.legendPosition || 'bottom';
  const renderLegend = () => {
    if (legendPos === 'none') return null;
    if (legendPos === 'left') return <Legend layout="vertical" verticalAlign="middle" align="left" wrapperStyle={{ fontSize: '11px', paddingRight: '10px' }}/>;
    if (legendPos === 'right') return <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px', paddingLeft: '10px' }}/>;
    if (legendPos === 'top') return <Legend layout="horizontal" verticalAlign="top" align="center" wrapperStyle={{ fontSize: '11px', paddingBottom: '10px' }}/>;
    return <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}/>;
  };

  if (widget.type === 'pie') {
    const pieData = !widget.xAxisCol
      ? widget.series.map((s, idx) => ({ name: getSeriesName(s), value: kpiValues[idx] || 0, color: s.color })).filter(d => d.value > 0)
      : chartData.map((d, index) => ({ name: d[widget.xAxisCol!], value: d[widget.series[0].id], color: COLORS[index % COLORS.length] })).filter(d => d.value > 0);

    if (pieData.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center">Aucune donnée exploitable.</div>;

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 20, right: 30, left: 30, bottom: 20 }}>
          <Pie
            data={pieData} cx="50%" cy="50%"
            innerRadius={widget.widgetSize === 'large' ? 80 : 50}
            outerRadius={widget.widgetSize === 'large' ? 120 : 80}
            paddingAngle={2} dataKey="value" nameKey="name"
            label={widget.showLabels !== false ? renderPieLabel : false}
            labelLine={widget.showLabels !== false}
            stroke="hsl(var(--background))" strokeWidth={2}
          >
            {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={renderPieTooltip} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
          {renderLegend()}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartData.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center">Aucune donnée correspondant aux filtres.</div>;

  const marginConfig = { top: 30, right: 20, left: -15, bottom: legendPos === 'bottom' ? 10 : 0 };

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {widget.type === 'bar' ? (
          <BarChart data={chartData} margin={marginConfig}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={widget.xAxisCol} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
            {renderLegend()}
            {widget.series.map(s => (
                <Bar key={`bar-${s.id}`} dataKey={s.id} name={getSeriesName(s)} fill={s.color} radius={[2, 2, 0, 0]}
                     label={widget.showLabels !== false ? { position: 'top', fontSize: 10, fill: 'currentColor', formatter: formatLabel } : false} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={chartData} margin={marginConfig}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={widget.xAxisCol} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
            {renderLegend()}
            {widget.series.map(s => (
              <Area
                key={s.id} type="monotone" dataKey={s.id} name={getSeriesName(s)} stroke={s.color} fill={s.color} fillOpacity={0.1} strokeWidth={2}
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

  const [risks, setRisks] = useState<TrackedRisk[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const [collapsedDatasets, setCollapsedDatasets] = useState<Set<string>>(new Set());

  const [riskToDelete, setRiskToDelete] = useState<string | null>(null);
  const [widgetToDelete, setWidgetToDelete] = useState<string | null>(null);
  const [datasetToDelete, setDatasetToDelete] = useState<string | null>(null);

  // 1. CHARGEMENT INITIAL DEPUIS SUPABASE
  useEffect(() => {
    const fetchRisks = async () => {
      try {
        const { data, error } = await supabase.from('risk_dashboards' as any).select('*');
        if (error) throw error;

        if (data && data.length > 0) {
          const formattedRisks = data.map((row: any) => ({
            id: row.id,
            title: row.title,
            description: row.description || "",
            icon: row.icon || "shield",
            datasets: row.datasets || [],
            measures: row.measures || [],
            widgets: row.widgets || []
          }));
          setRisks(formattedRisks);
        }
      } catch (error) {
        console.error("Erreur de chargement depuis Supabase :", error);
        toast.error("Impossible de charger les données depuis le cloud.");
      } finally {
        setIsInitialized(true);
      }
    };
    fetchRisks();
  }, []);

  // 2. SAUVEGARDE AUTOMATIQUE DANS SUPABASE
  useEffect(() => {
    if (!isInitialized) return;
    const timer = setTimeout(async () => {
      try {
        const recordsToUpsert = risks.map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          icon: r.icon,
          datasets: r.datasets,
          measures: r.measures,
          widgets: r.widgets,
          updated_at: new Date().toISOString()
        }));

        // PROTECTION "RANGE ERROR" AVANT L'ENVOI
        const payloadString = JSON.stringify(recordsToUpsert);
        if (payloadString.length > MAX_PAYLOAD_SIZE) {
          throw new Error("Payload too large");
        }

        if (recordsToUpsert.length > 0) {
          const { error } = await supabase.from('risk_dashboards' as any).upsert(recordsToUpsert);
          if (error) throw error;
        }
      } catch (err: any) {
        console.error("Erreur de sauvegarde Cloud :", err);

        if (err.message === "Payload too large" || String(err).includes("Invalid string length")) {
           toast.error("Volume de données trop important pour la synchronisation Cloud.");
        }

        // Sauvegarde de secours ultra-réduite
        try {
          const safeBackup = risks.map(r => ({
            ...r,
            datasets: r.datasets.map(d => ({ ...d, data: d.data.slice(0, 100) }))
          }));
          localStorage.setItem("pbi_risks_backup", JSON.stringify(safeBackup));
        } catch(e) {}
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [risks, isInitialized]);

  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isVisOpen, setIsVisOpen] = useState(false);
  const [isDataOpen, setIsDataOpen] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);

  const [isAppendOpen, setIsAppendOpen] = useState(false);
  const [appendSource1, setAppendSource1] = useState<string>("");
  const [appendSource2, setAppendSource2] = useState<string>("");
  const [appendNewName, setAppendNewName] = useState<string>("");

  const [wizardStep, setWizardStep] = useState<1|2>(1);
  const [isImporting, setIsImporting] = useState(false);
  const [newRiskTitle, setNewRiskTitle] = useState("");
  const [newRiskDesc, setNewRiskDesc] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Dataset[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  // ============================================================================
  // LOGIQUE WIZARD : IMPORTATION SÉCURISÉE (FILTRE STRICT SUR LA COLONNE "DATE")
  // ============================================================================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = (event) => {
      setTimeout(() => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetsData: Dataset[] = [];

          wb.SheetNames.forEach(sheetName => {
            const rawData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { blankrows: false });
            if (!rawData || rawData.length === 0) return;

            // 1. Chercher dynamiquement s'il y a une colonne "Date" dans la table
            // (Insensible à la casse : "Date", "DATE", "date_creation", etc.)
            const sampleRow = rawData[0] as object;
            const dateColumn = Object.keys(sampleRow).find(key => key.toUpperCase().includes('DATE'));

            // 2. FILTRAGE STRICT DES LIGNES
            let cleanData = rawData.filter((row: any) => {
              if (dateColumn) {
                // RÈGLE ABSOLUE : Si on a une colonne Date, la ligne n'est gardée QUE si la date est remplie
                const val = row[dateColumn];
                return val !== null && val !== undefined && String(val).trim() !== "";
              } else {
                // (Fallback) Si c'est un tableau sans aucune colonne Date (ex: un référentiel Actifs),
                // on garde la ligne si elle contient au moins une vraie info.
                return Object.values(row).some(val => val !== null && val !== undefined && String(val).trim() !== "");
              }
            });

            // Si la feuille n'est pas vide après ce nettoyage drastique
            if (cleanData.length > 0) {

              // 3. MINIFICATION ET NETTOYAGE DES COLONNES INVISIBLES
              cleanData = cleanData.map((row: any) => {
                const minifiedRow: any = {};
                Object.keys(row).forEach(key => {
                  // On ignore les fausses colonnes générées par Excel (__EMPTY) et les cases vides
                  if (!key.includes('__EMPTY') && row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== "") {
                    minifiedRow[key] = row[key];
                  }
                });
                return minifiedRow;
              });

              // 4. SÉCURITÉ DE VOLUME (Capping)
              if (cleanData.length > MAX_ROWS_PER_DATASET) {
                toast.warning(`⚠️ La feuille "${sheetName}" contient trop de lignes avec des dates valides (${cleanData.length}). Seules les ${MAX_ROWS_PER_DATASET} premières ont été conservées.`);
                cleanData = cleanData.slice(0, MAX_ROWS_PER_DATASET);
              }

              // On récupère les colonnes finales et propres
              const validColumns = Array.from(new Set(cleanData.flatMap(r => Object.keys(r))));

              sheetsData.push({
                id: `ds_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: sheetName,
                columns: validColumns,
                data: cleanData
              });
            }
          });

          if (sheetsData.length === 0) {
            throw new Error("Le fichier ne contient aucune ligne valide (Colonne 'Date' vide ou fichier inexploitable).");
          }

          setAvailableSheets(sheetsData);
          setSelectedSheets(sheetsData.map(sheet => sheet.id)); // On pré-coche tout
          setWizardStep(2);

        } catch(err: any) {
          toast.error(err.message || "Erreur de lecture du fichier.");
        } finally {
          setIsImporting(false);
        }
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
    toast.success(`Analyse créée avec succès !`);
    setActiveRiskId(newRisk.id);
  };

  const finalizeAddData = () => {
    if (selectedSheets.length === 0) return toast.error("Sélectionnez au moins une table.");
    const newDatasets = availableSheets.filter(s => selectedSheets.includes(s.id));
    updateActiveRisk({ datasets: [...(activeRisk?.datasets || []), ...newDatasets] });
    setIsAddDataOpen(false); resetWizard();
    toast.success(`${newDatasets.length} source(s) ajoutée(s) au modèle.`);
  };

  const confirmDeleteRisk = async (id: string) => {
    setRisks(risks.filter(r => r.id !== id));
    if (activeRiskId === id) setActiveRiskId(null);
    try {
      await supabase.from('risk_dashboards' as any).delete().eq('id', id);
      toast.success("Analyse supprimée définitivement.");
    } catch(err) { console.error(err); }
    setRiskToDelete(null);
  };

  const activeRisk = risks.find(r => r.id === activeRiskId);
  const activeWidget = activeRisk?.widgets.find(w => w.id === activeWidgetId);
  const activeDataset = activeWidget ? activeRisk?.datasets.find(d => d.id === activeWidget.datasetId) : null;

  const updateActiveRisk = (updates: Partial<TrackedRisk>) => { setRisks(risks.map(r => r.id === activeRiskId ? { ...r, ...updates } : r)); };

  const confirmRemoveDataset = (datasetId: string) => {
    if (!activeRisk) return;
    updateActiveRisk({ datasets: activeRisk.datasets.filter(d => d.id !== datasetId) });
    toast.success("Source de données supprimée.");
    setDatasetToDelete(null);
  };

  const toggleDatasetCollapse = (datasetId: string) => {
    setCollapsedDatasets(prev => {
      const next = new Set(prev);
      if (next.has(datasetId)) next.delete(datasetId);
      else next.add(datasetId);
      return next;
    });
  };

  const handleAppendDatasets = () => {
    if (!activeRisk) return;
    if (!appendSource1 || !appendSource2) return toast.error("Sélectionnez deux tables à fusionner.");
    if (appendSource1 === appendSource2) return toast.error("Sélectionnez deux tables différentes.");
    if (!appendNewName) return toast.error("Donnez un nom à la nouvelle table.");

    const ds1 = activeRisk.datasets.find(d => d.id === appendSource1);
    const ds2 = activeRisk.datasets.find(d => d.id === appendSource2);

    if (!ds1 || !ds2) return toast.error("Table introuvable.");

    const combinedColumns = Array.from(new Set([...ds1.columns, ...ds2.columns]));
    let combinedData = [...ds1.data, ...ds2.data];

    // Capping lors de la fusion
    if (combinedData.length > MAX_ROWS_PER_DATASET) {
        toast.warning(`⚠️ La fusion dépasse la limite. Seules les ${MAX_ROWS_PER_DATASET} premières lignes sont conservées.`);
        combinedData = combinedData.slice(0, MAX_ROWS_PER_DATASET);
    }

    const newDataset: Dataset = {
      id: `ds_${Date.now()}`,
      name: appendNewName,
      columns: combinedColumns,
      data: combinedData
    };

    updateActiveRisk({ datasets: [...activeRisk.datasets, newDataset] });
    setIsAppendOpen(false);
    setAppendSource1("");
    setAppendSource2("");
    setAppendNewName("");
    toast.success(`Table "${appendNewName}" fusionnée avec succès (${combinedData.length} lignes).`);
  };

  // ============================================================================
  // LOGIQUE STUDIO BI
  // ============================================================================
  const addWidgetToStudio = () => {
    if (!activeRisk || activeRisk.datasets.length === 0) return toast.error("Veuillez charger des données.");
    const newWidget: WidgetConfig = {
      id: `w_${Date.now()}`, title: "Nouvel Indicateur", type: "bar", datasetId: activeRisk.datasets[0].id,
      dateGrouping: "none", series: [], filters: [],
      showLabels: true, legendPosition: 'bottom', widgetSize: 'medium'
    };
    updateActiveRisk({ widgets: [...activeRisk.widgets, newWidget] });
    setActiveWidgetId(newWidget.id);
    setIsVisOpen(true); setIsDataOpen(true);
  };

  const updateActiveWidget = (updates: Partial<WidgetConfig>) => {
    if (!activeRisk || !activeWidgetId) return;
    if (updates.datasetId && updates.datasetId !== activeWidget?.datasetId) { updates.xAxisCol = ""; updates.series = []; updates.filters = []; }
    updateActiveRisk({ widgets: activeRisk.widgets.map(w => w.id === activeWidgetId ? { ...w, ...updates } : w) });
  };

  const confirmDeleteWidget = () => {
    if (!activeRisk || !widgetToDelete) return;
    updateActiveRisk({ widgets: activeRisk.widgets.filter(w => w.id !== widgetToDelete) });
    if (activeWidgetId === widgetToDelete) setActiveWidgetId(null);
    setWidgetToDelete(null);
    toast.success("Indicateur supprimé.");
  };

  const addSeriesWithData = (colName: string, isMeasure: boolean) => {
    if (!activeWidget) return;
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

  const toggleColumnInWidget = (colName: string, isMeasure: boolean, datasetId: string) => {
    if (!activeWidget) return toast.info("Sélectionnez un indicateur d'abord.");
    if (activeWidget.datasetId !== datasetId) return toast.error("Cette donnée appartient à une autre source.");

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
      if (data.datasetId !== activeWidget?.datasetId) return toast.error("Source différente.");
      if (data.isMeasure) return toast.error("Impossible d'utiliser une mesure comme Catégorie.");
      updateActiveWidget({ xAxisCol: data.colName });
    } catch {}
  };

  const handleDropOnY = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.datasetId !== activeWidget?.datasetId) return toast.error("Source différente.");
      addSeriesWithData(data.colName, data.isMeasure);
    } catch {}
  };

  const getWidgetGridClass = (size?: WidgetSize) => {
    if (size === 'small') return 'col-span-1';
    if (size === 'large') return 'md:col-span-2 xl:col-span-3';
    return 'md:col-span-2';
  };

  if (!isInitialized) {
    return (
      <div className="flex h-[calc(100vh-6rem)] items-center justify-center -m-4">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Chargement de vos analyses...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // VUE 1 : ACCUEIL
  // ============================================================================
  if (!activeRiskId) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/50">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><AlertTriangle className="w-6 h-6 text-primary" /> Suivi des Risques</h1>
            <p className="text-sm text-muted-foreground mt-1">Gérez vos modèles d'analyse et suivez vos indicateurs de risques.</p>
          </div>
          <Dialog open={isAddOpen} onOpenChange={(o) => { setIsAddOpen(o); if(!o) resetWizard(); }}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Nouvelle Analyse</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Configuration de l'Analyse de Risques</DialogTitle></DialogHeader>
              {wizardStep === 1 && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2"><Label>Nom de l'analyse (ex: Risques Cybersécurité Q3)</Label><Input value={newRiskTitle} onChange={e => setNewRiskTitle(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Description de l'objectif</Label><Input value={newRiskDesc} onChange={e => setNewRiskDesc(e.target.value)} /></div>
                  <div className="space-y-2 pt-4 border-t">
                    <Label className="text-primary font-bold">Source de données (.xlsx, .csv)</Label>
                    {isImporting ? <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/10"><Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" /></div> : <div className="relative"><input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={!newRiskTitle} /><Button variant="outline" className="w-full h-24 border-dashed border-2 flex-col gap-2" disabled={!newRiskTitle}><FileSpreadsheet className="w-6 h-6" /><span>Sélectionner le fichier</span></Button></div>}
                  </div>
                </div>
              )}
              {wizardStep === 2 && (
                <div className="space-y-6 py-4">
                  <div className="bg-primary/10 text-primary p-3 rounded-lg flex items-center gap-3"><Database className="w-6 h-6 shrink-0"/><div><h4 className="font-bold text-sm">Données analysées</h4><p className="text-xs">Sélectionnez les tables à inclure dans l'analyse.</p></div></div>
                  <div className="max-h-[200px] overflow-y-auto space-y-2 border p-2 rounded-md">
                    {availableSheets.map(sheet => (
                      <div key={sheet.id} onClick={() => toggleSheetSelection(sheet.id)} className={`flex justify-between p-3 rounded border cursor-pointer ${selectedSheets.includes(sheet.id) ? 'bg-primary/5 border-primary shadow-sm' : 'hover:bg-muted'}`}>
                        <div className="flex items-center gap-3"><CheckSquare className={`w-5 h-5 ${selectedSheets.includes(sheet.id) ? 'text-primary' : 'opacity-30'}`} /><p className="font-bold text-sm">{sheet.name}</p></div><Badge variant="secondary">{sheet.data.length} entrées</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-4"><Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">Retour</Button><Button onClick={finalizeRiskCreation} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={selectedSheets.length === 0}>Créer le Tableau de bord</Button></div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2">
          {risks.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">Ce module de suivi est vide. Ajoutez une première analyse de risques.</div>}
          {risks.map((risk) => (
            <Card key={risk.id} onClick={() => { setActiveRiskId(risk.id); setIsFiltersOpen(false); setIsVisOpen(false); setIsDataOpen(false); setActiveWidgetId(null); }} className="group cursor-pointer border-l-4 border-l-primary hover:-translate-y-1 shadow-sm relative">
              <button
                onClick={(e) => { e.stopPropagation(); setRiskToDelete(risk.id); }}
                className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-rose-100 hover:text-rose-600 z-10 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4 pr-8"><div className="p-2.5 rounded-lg bg-primary/10 text-primary"><Shield className="w-6 h-6" /></div><div className="min-w-0"><h3 className="font-bold text-lg truncate">{risk.title}</h3></div></div>
                <div className="flex gap-2 mb-4"><Badge variant="outline" className="text-[10px] bg-secondary/50"><Database className="w-3 h-3 mr-1"/> {risk.datasets.length} Sources</Badge><Badge variant="outline" className="text-[10px] bg-secondary/50"><BarChart3 className="w-3 h-3 mr-1"/> {risk.widgets.length} Indicateurs</Badge></div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ALERTE DE CONFIRMATION POUR SUPPRESSION DE RAPPORT */}
        <AlertDialog open={!!riskToDelete} onOpenChange={(open) => !open && setRiskToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Êtes-vous absolument sûr ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est irréversible. Cela supprimera définitivement l'analyse et toutes les configurations associées.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => riskToDelete && confirmDeleteRisk(riskToDelete)}>Supprimer définitivement</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    );
  }

  // ============================================================================
  // VUE 2 : STUDIO BI
  // ============================================================================
  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] animate-in fade-in duration-300 -m-4 bg-slate-50 dark:bg-slate-900/50">

      <div className="flex items-center justify-between p-3 border-b bg-background shadow-sm z-20">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => {setActiveRiskId(null); setActiveWidgetId(null)}}><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0"><h2 className="font-bold text-lg leading-tight truncate">{activeRisk?.title}</h2></div>
        </div>
        <Button variant="default" size="sm" onClick={addWidgetToStudio} className="gap-2 shrink-0"><Plus className="w-4 h-4"/> Nouvel Indicateur</Button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* PANNEAU 1 : CANVAS */}
        <div className="flex-1 overflow-auto p-6 transition-all" onClick={() => setActiveWidgetId(null)}>
          {activeRisk?.widgets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
              <LayoutDashboard className="w-16 h-16 mb-4" /><p>Le tableau de bord est vide.</p><p className="text-sm mt-2">Cliquez sur "Nouvel Indicateur" pour commencer.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {activeRisk?.widgets.map(widget => (
                <Card
                  key={widget.id} onClick={(e) => { e.stopPropagation(); setActiveWidgetId(widget.id); }}
                  className={`cursor-pointer transition-all bg-background min-w-0 ${getWidgetGridClass(widget.widgetSize)} ${activeWidgetId === widget.id ? 'ring-2 ring-primary shadow-lg scale-[1.01] z-10 relative' : 'hover:border-primary/50 shadow-sm'}`}
                >
                  <CardHeader className="p-3 border-b flex flex-row items-center justify-between bg-card/50 min-w-0">
                    <CardTitle className="text-xs font-bold uppercase text-muted-foreground truncate w-full pr-2">{widget.title}</CardTitle>
                  </CardHeader>
                  <CardContent className={`p-3 min-w-0 overflow-hidden ${widget.widgetSize === 'large' ? 'h-[400px]' : 'h-[250px]'}`}>
                    <DashboardWidget widget={widget} datasets={activeRisk.datasets} measures={activeRisk.measures} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* PANNEAU 2 : FILTRES */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-lg transition-all duration-300 overflow-hidden ${isFiltersOpen ? 'w-64' : 'w-10'}`}>
          <div className="p-3 border-b bg-secondary/30 flex items-center justify-between min-w-0">
            <div onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="flex items-center gap-2 truncate cursor-pointer hover:text-primary transition-colors flex-1">
              <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
              {isFiltersOpen && <h3 className="font-bold text-xs uppercase tracking-wider truncate">Filtres</h3>}
            </div>
            {isFiltersOpen ? <button onClick={() => setIsFiltersOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground shrink-0"><ChevronRight className="w-4 h-4" /></button> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsFiltersOpen(true)} />}
          </div>

          <div className={`flex-1 overflow-y-auto p-3 ${!isFiltersOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un indicateur.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between min-w-0">
                  <h4 className="text-[10px] font-black uppercase text-primary truncate">Sur cet indicateur</h4>
                  <Button variant="ghost" size="sm" onClick={addFilter} className="h-6 px-1 text-[10px] text-primary shrink-0"><Plus className="w-3 h-3 mr-1"/> Ajouter</Button>
                </div>
                {(!activeWidget.filters || activeWidget.filters.length === 0) && <div className="p-3 text-center border border-dashed rounded bg-muted/20 text-[10px] text-muted-foreground">Aucun filtre actif.</div>}
                <div className="space-y-3">
                  {activeWidget.filters?.map(f => (
                    <div key={f.id} className="p-2 border border-primary/20 bg-primary/5 rounded relative group flex flex-col gap-2 shadow-sm min-w-0">
                      <button onClick={() => removeFilter(f.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"><Trash2 className="w-3 h-3" /></button>
                      <select value={f.column} onChange={e => updateFilter(f.id, { column: e.target.value, value: '' })} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background truncate">
                        <option value="">Donnée...</option>{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={f.operator} onChange={e => updateFilter(f.id, { operator: e.target.value as FilterOperator })} className="w-full h-7 rounded border px-1 text-[10px] text-muted-foreground bg-background truncate">
                        <option value="eq">Égal à</option><option value="neq">Différent de</option><option value="contains">Contient</option><option value="gt">Supérieur à</option><option value="lt">Inférieur à</option><option value="last_n_days">Derniers X jours</option>
                      </select>
                      <Input
                        type={f.operator === 'last_n_days' ? 'number' : 'text'}
                        value={f.value}
                        onChange={e => updateFilter(f.id, { value: e.target.value })}
                        placeholder={f.operator === 'last_n_days' ? 'Nombre de jours...' : 'Valeur...'}
                        className="h-7 text-xs bg-background w-full"
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
          <div className="p-3 border-b bg-secondary/30 flex items-center justify-between min-w-0">
            <div onClick={() => setIsVisOpen(!isVisOpen)} className="flex items-center gap-2 truncate cursor-pointer hover:text-primary transition-colors flex-1">
              <LayoutDashboard className="w-4 h-4 text-muted-foreground shrink-0" />
              {isVisOpen && <h3 className="font-bold text-xs uppercase tracking-wider truncate">Apparence</h3>}
            </div>
            {isVisOpen ? <button onClick={() => setIsVisOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground shrink-0"><ChevronRight className="w-4 h-4" /></button> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsVisOpen(true)} />}
          </div>

          <div className={`flex-1 overflow-y-auto p-4 ${!isVisOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un indicateur pour configurer ses axes.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">

                {/* BLOC 1 : TYPE */}
                <div className="space-y-2 flex flex-col min-w-0">
                  <div className="flex justify-between items-center min-w-0 gap-2">
                    <Input value={activeWidget.title} onChange={e => updateActiveWidget({ title: e.target.value })} className="h-8 text-xs font-bold w-full truncate" />
                    <button onClick={() => setWidgetToDelete(activeWidget.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded shrink-0"><Trash2 className="w-4 h-4"/></button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 border-b pb-4">
                    <button onClick={() => updateActiveWidget({ type: 'bar' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'bar' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Barres"><BarChart3 className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'area' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'area' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Aires/Courbes"><LineChartIcon className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'pie' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'pie' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Secteurs (Répartition)"><PieChartIcon className="w-4 h-4"/></button>
                    <button onClick={() => updateActiveWidget({ type: 'kpi' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'kpi' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`} title="Valeur globale (KPI)"><Hash className="w-4 h-4"/></button>
                  </div>
                </div>

                <div className="space-y-1 flex flex-col min-w-0">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">Source de données</Label>
                  <select value={activeWidget.datasetId} onChange={e => updateActiveWidget({ datasetId: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-muted/30 truncate">{activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                </div>

                {/* DROP ZONE AXE X */}
                {activeWidget.type !== 'kpi' && (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDropOnX}
                    className="p-3 border rounded bg-secondary/10 flex flex-col gap-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors min-w-0"
                  >
                    <div className="flex items-center justify-between min-w-0 gap-2">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">
                        {activeWidget.type === 'pie' ? 'Catégorie de découpage' : 'Axe d\'analyse (X)'}
                      </Label>
                      {activeWidget.type === 'pie' && activeWidget.xAxisCol && (
                         <button onClick={() => updateActiveWidget({ xAxisCol: "" })} className="text-[10px] text-rose-500 font-bold hover:underline shrink-0">Vider</button>
                      )}
                    </div>
                    <select value={activeWidget.xAxisCol || ''} onChange={e => updateActiveWidget({ xAxisCol: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-background truncate"><option value="">{activeWidget.type === 'pie' ? 'Aucun (Comparaison globale)' : 'Glisser ou sélectionner...'}</option>{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}</select>

                    {activeWidget.xAxisCol && (
                      <div className="flex flex-col gap-1 pt-1 border-t border-muted-foreground/10 min-w-0">
                        <Label className="text-[9px] uppercase font-bold text-primary flex items-center gap-1 truncate"><Calendar className="w-3 h-3 shrink-0"/> Format Date</Label>
                        <select value={activeWidget.dateGrouping || 'none'} onChange={e => updateActiveWidget({ dateGrouping: e.target.value as DateGrouping })} className="w-full h-7 rounded border border-primary/20 px-1 text-[10px] bg-primary/5 text-primary truncate"><option value="none">Ne pas regrouper</option><option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option><option value="quarter">Trimestre</option><option value="year">Année</option></select>
                      </div>
                    )}
                  </div>
                )}

                {/* DROP ZONE AXE Y */}
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDropOnY}
                  className="p-3 border rounded bg-secondary/10 flex flex-col gap-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors min-w-0"
                >
                  <div className="flex items-center justify-between min-w-0 gap-2">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">
                      {activeWidget.type === 'pie' ? 'Données évaluées' : activeWidget.type === 'kpi' ? 'Valeur du KPI' : 'Mesure de l\'Axe Y'}
                    </Label>
                    <button onClick={addSeries} className="text-[10px] text-primary font-bold hover:underline shrink-0">+ Ajouter</button>
                  </div>

                  {activeWidget.series.length === 0 && <div className="text-[10px] text-muted-foreground italic text-center w-full">Déposez vos données ici.</div>}

                  {activeWidget.series.map((s, index) => (
                    <div key={s.id} className="p-2 bg-background border rounded flex flex-col gap-2 relative group min-w-0">
                      <button onClick={() => removeSeries(s.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"><Trash2 className="w-3 h-3" /></button>
                      <select value={s.yAxisCol} onChange={e => { const val = e.target.value; const isMeas = activeRisk?.measures.some(m => m.name === val); updateSeries(s.id, { yAxisCol: val, isMeasure: isMeas }); }} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background truncate">
                        <option value="">Sélectionner...</option>
                        {activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).length! > 0 && <optgroup label="✨ Règles d'analyse personnalisées">{activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</optgroup>}
                        <optgroup label="Données sources">{activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                      </select>

                      {!s.isMeasure && (
                        <select value={s.aggregation} onChange={e => updateSeries(s.id, { aggregation: e.target.value as AggregationType })} className="w-full h-7 rounded border px-1 text-[10px] bg-secondary/30 text-muted-foreground truncate">
                          <option value="SUM">Faire la Somme</option><option value="AVERAGE">Calculer la Moyenne</option><option value="COUNT">Compter le nombre</option><option value="MAX">Valeur Maximum</option><option value="MIN">Valeur Minimum</option><option value="DISTINCTCOUNT">Valeurs Uniques</option>
                        </select>
                      )}

                      <div className="flex items-center gap-1 mt-1">
                        <Edit2 className="w-3 h-3 text-muted-foreground shrink-0"/>
                        <Input
                          value={s.alias || ''}
                          onChange={e => updateSeries(s.id, { alias: e.target.value })}
                          placeholder="Renommer l'étiquette (Optionnel)..."
                          className="h-6 text-[10px] bg-background w-full placeholder:italic"
                        />
                      </div>

                      {!(activeWidget.type === 'pie' && activeWidget.xAxisCol) && (
                        <div className="flex gap-1 overflow-x-auto pb-1 pt-1">{COLORS.map(c => <button key={c} onClick={() => updateSeries(s.id, { color: c })} className={`w-4 h-4 shrink-0 rounded-full ${s.color === c ? 'ring-2 ring-primary ring-offset-1' : ''}`} style={{backgroundColor: c}}/>)}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* BLOC APPARENCE */}
                <div className="pt-2 border-t flex flex-col gap-3 min-w-0">
                  <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-1 truncate"><Palette className="w-3 h-3 shrink-0"/> Options de Rendu</h4>

                  {activeWidget.type !== 'kpi' && (
                    <div className="flex items-center justify-between min-w-0 gap-2">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><Tag className="w-3 h-3 shrink-0"/> Valeurs sur le graphique</Label>
                      <input type="checkbox" checked={activeWidget.showLabels !== false} onChange={(e) => updateActiveWidget({ showLabels: e.target.checked })} className="w-4 h-4 accent-primary shrink-0" />
                    </div>
                  )}

                  <div className="flex flex-col gap-1 min-w-0">
                    <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><Maximize className="w-3 h-3 shrink-0"/> Taille du panneau</Label>
                    <select value={activeWidget.widgetSize || 'medium'} onChange={e => updateActiveWidget({ widgetSize: e.target.value as WidgetSize })} className="w-full h-7 rounded border px-1 text-xs bg-background truncate">
                      <option value="small">Tiers de page (Petit)</option>
                      <option value="medium">Deux Tiers (Standard)</option>
                      <option value="large">Pleine page (Détail)</option>
                    </select>
                  </div>

                  {activeWidget.type !== 'kpi' && (
                    <div className="flex flex-col gap-1 min-w-0">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><LayoutPanelLeft className="w-3 h-3 shrink-0"/> Position de la légende</Label>
                      <select value={activeWidget.legendPosition || 'bottom'} onChange={e => updateActiveWidget({ legendPosition: e.target.value as LegendPosition })} className="w-full h-7 rounded border px-1 text-xs bg-background truncate">
                        <option value="bottom">En dessous</option>
                        <option value="top">Au dessus</option>
                        <option value="left">À gauche</option>
                        <option value="right">À droite</option>
                        <option value="none">Cacher la légende</option>
                      </select>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>

        {/* PANNEAU 4 : DONNÉES & APPEND */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-2xl transition-all duration-300 overflow-hidden ${isDataOpen ? 'w-64' : 'w-10'}`}>
          <div className="p-3 border-b bg-secondary/30 flex items-center justify-between min-w-0">
            <div
              onClick={() => setIsDataOpen(!isDataOpen)}
              className="flex items-center gap-2 truncate cursor-pointer hover:text-primary transition-colors flex-1"
            >
              <Database className="w-4 h-4 text-muted-foreground shrink-0" />
              {isDataOpen && <h3 className="font-bold text-xs uppercase tracking-wider truncate">Modèle de Données</h3>}
            </div>
            {isDataOpen ? (
               <div className="flex items-center gap-1 shrink-0">
                 {/* Bonton FUSIONNER DES TABLES (APPEND) */}
                 <Button variant="ghost" size="sm" onClick={() => setIsAppendOpen(true)} className="h-6 px-1.5 text-primary hover:bg-primary/10" title="Fusionner deux tables (Append)">
                   <Combine className="w-3.5 h-3.5" />
                 </Button>
                 {/* Bonton AJOUTER DES DONNÉES */}
                 <Button variant="ghost" size="sm" onClick={() => setIsAddDataOpen(true)} className="h-6 px-1.5 text-primary hover:bg-primary/10" title="Ajouter une source">
                   <Plus className="w-3.5 h-3.5" />
                 </Button>
                 <button onClick={() => setIsDataOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
               </div>
            ) : (
               <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsDataOpen(true)} />
            )}
          </div>

          <div className={`flex-1 overflow-y-auto p-2 ${!isDataOpen && 'hidden'}`}>
            {activeRisk?.datasets.map(ds => (
              <div key={ds.id} className="text-sm min-w-0 group/dataset mb-2">
                <div
                  className="flex items-center justify-between p-2 bg-muted/50 rounded font-bold text-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => toggleDatasetCollapse(ds.id)}
                >
                  <div className="flex items-center gap-2 truncate">
                     {collapsedDatasets.has(ds.id) ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                     <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0"/> <span className="truncate">{ds.name}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setDatasetToDelete(ds.id); }} className="opacity-0 group-hover/dataset:opacity-100 text-rose-500 hover:text-rose-700 transition-opacity shrink-0 p-1" title="Retirer cette table">
                     <Trash2 className="w-3 h-3"/>
                  </button>
                </div>

                {/* BLOC COLLAPSIBLE : COLONNES ET MESURES */}
                {!collapsedDatasets.has(ds.id) && (
                  <div className="pl-2 flex flex-col gap-1 mt-1 border-l ml-3 pb-2 min-w-0 animate-in slide-in-from-top-1">

                    {activeRisk.measures.filter(m => m.datasetId === ds.id).map(m => {
                      const isChecked = activeWidget?.datasetId === ds.id && activeWidget?.series.some(s => s.yAxisCol === m.name);
                      return (
                        <div
                          key={m.id} draggable
                          onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: m.name, isMeasure: true, datasetId: ds.id }))}
                          className="flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing min-w-0"
                        >
                          <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
                          <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(m.name, true, ds.id)} className="accent-primary shrink-0" />
                          <Calculator className="w-3 h-3 text-primary shrink-0"/> <span className="text-primary font-medium truncate">{m.name}</span>
                        </div>
                      );
                    })}

                    {ds.columns.map(col => {
                      const isChecked = activeWidget?.datasetId === ds.id && (activeWidget?.xAxisCol === col || activeWidget?.series.some(s => s.yAxisCol === col));
                      return (
                        <div
                          key={col} draggable
                          onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: col, isMeasure: false, datasetId: ds.id }))}
                          className="flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing min-w-0"
                        >
                          <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
                          <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(col, false, ds.id)} className="accent-primary shrink-0" />
                          <Sigma className="w-3 h-3 text-muted-foreground shrink-0"/> <span className="text-muted-foreground truncate" title={col}>{col}</span>
                        </div>
                      );
                    })}

                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* MODAL POUR AJOUTER DES DONNÉES AU RAPPORT EXISTANT */}
        <Dialog open={isAddDataOpen} onOpenChange={(o) => { setIsAddDataOpen(o); if(!o) resetWizard(); }}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Ajouter des sources au modèle</DialogTitle></DialogHeader>
            {wizardStep === 1 && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-primary font-bold">Fichier source (.xlsx, .csv)</Label>
                  {isImporting ? (
                     <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/10"><Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" /></div>
                  ) : (
                    <div className="relative">
                      <input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      <Button variant="outline" className="w-full h-24 border-dashed border-2 flex-col gap-2"><FileSpreadsheet className="w-6 h-6" /><span>Sélectionner le fichier</span></Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {wizardStep === 2 && (
              <div className="space-y-6 py-4">
                <div className="bg-primary/10 text-primary p-3 rounded-lg flex items-center gap-3"><Database className="w-6 h-6 shrink-0"/><div><h4 className="font-bold text-sm">Fichier analysé</h4><p className="text-xs">Cochez les tables à importer.</p></div></div>
                <div className="max-h-[200px] overflow-y-auto space-y-2 border p-2 rounded-md">
                  {availableSheets.map(sheet => (
                    <div key={sheet.id} onClick={() => toggleSheetSelection(sheet.id)} className={`flex justify-between p-3 rounded border cursor-pointer ${selectedSheets.includes(sheet.id) ? 'bg-primary/5 border-primary shadow-sm' : 'hover:bg-muted'}`}>
                      <div className="flex items-center gap-3"><CheckSquare className={`w-5 h-5 ${selectedSheets.includes(sheet.id) ? 'text-primary' : 'opacity-30'}`} /><p className="font-bold text-sm">{sheet.name}</p></div><Badge variant="secondary">{sheet.data.length} entrées</Badge>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">Retour</Button>
                  <Button onClick={finalizeAddData} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={selectedSheets.length === 0}>Ajouter au modèle</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* MODAL POUR FUSIONNER (APPEND) DEUX TABLES */}
        <Dialog open={isAppendOpen} onOpenChange={(o) => {
          setIsAppendOpen(o);
          if(!o) { setAppendSource1(""); setAppendSource2(""); setAppendNewName(""); }
        }}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Combine className="w-5 h-5 text-primary" /> Fusionner des tables (Append)
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-xs text-muted-foreground">
                Cette action va empiler les lignes de deux tables. (Si votre deuxième table se trouve dans un autre fichier Excel, fermez cette fenêtre et utilisez le bouton "+" pour importer le fichier d'abord).
              </p>

              <div className="space-y-2">
                <Label>Première table</Label>
                <select value={appendSource1} onChange={e => setAppendSource1(e.target.value)} className="w-full h-10 rounded border px-3 text-sm bg-background">
                  <option value="">Sélectionner la table de base...</option>
                  {activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="flex justify-center"><Plus className="w-4 h-4 text-muted-foreground" /></div>

              <div className="space-y-2">
                <Label>Table à empiler</Label>
                <select value={appendSource2} onChange={e => setAppendSource2(e.target.value)} className="w-full h-10 rounded border px-3 text-sm bg-background">
                  <option value="">Sélectionner la table à ajouter...</option>
                  {activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <Label className="text-primary font-bold">Nom de la nouvelle table générée</Label>
                <Input value={appendNewName} onChange={e => setAppendNewName(e.target.value)} placeholder="ex: Risques Globaux Q1+Q2" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAppendOpen(false)}>Annuler</Button>
              <Button onClick={handleAppendDatasets} disabled={!appendSource1 || !appendSource2 || !appendNewName}>Fusionner</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ALERTES DE CONFIRMATIONS POUR LE STUDIO BI */}
        <AlertDialog open={!!widgetToDelete} onOpenChange={(open) => !open && setWidgetToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer cet indicateur ?</AlertDialogTitle>
              <AlertDialogDescription>Vous allez supprimer ce graphique de votre tableau de bord.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={confirmDeleteWidget}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!datasetToDelete} onOpenChange={(open) => !open && setDatasetToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retirer cette source de données ?</AlertDialogTitle>
              <AlertDialogDescription>Les indicateurs utilisant cette table risquent de ne plus fonctionner.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => datasetToDelete && confirmRemoveDataset(datasetToDelete)}>Retirer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </div>
  );
}