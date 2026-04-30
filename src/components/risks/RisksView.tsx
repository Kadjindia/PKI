import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { DaxEngine } from "@/lib/DaxEngine";
import { supabase } from "@/integrations/supabase/client";

import {
  ArrowLeft, Shield, Plus, Trash2, BarChart3, LineChart as LineChartIcon,
  PieChart as PieChartIcon, Hash, Target, LayoutDashboard, Database, CheckSquare,
  Calculator, Sigma, Filter, ChevronRight, ChevronDown, GripVertical, FileSpreadsheet, Loader2,
  Calendar, Palette, Maximize, Tag, LayoutPanelLeft, AlertTriangle, Edit2, Combine,
  Eye, EyeOff, X, AlignLeft, Copy, ChevronLeft, ChevronRight as ChevronRightIcon,
  ChevronUp, RefreshCw, Type, Shapes, Image as ImageIcon, DatabaseZap, TableProperties, MousePointerClick, Settings2,
  MoreVertical, Clipboard, Scissors, Paintbrush, FileEdit, UploadCloud, Save,
  Columns, Table2, ArrowUpToLine, Replace, Wand2, Braces, FunctionSquare, Waypoints, ListOrdered, FileJson
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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================================================
// CONSTANTES GLOBALES DE SÉCURITÉ
// ============================================================================
const MAX_ROWS_PER_DATASET = 5000;
const MAX_PAYLOAD_SIZE = 4500000;

// ============================================================================
// TYPES
// ============================================================================
type AggregationType = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'DISTINCTCOUNT';
type WidgetType = 'kpi' | 'bar' | 'area' | 'pie';
type DateGrouping = 'none' | 'day' | 'week' | 'month' | 'quarter' | 'year';
type FilterOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'last_n_days';
type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'none';
type WidgetSize = 'small' | 'medium' | 'large';
type ChartOrientation = 'vertical' | 'horizontal';

interface FilterConfig { id: string; column: string; operator: FilterOperator; value: string; }

// Type pour les étapes Power Query
type PQStepType = 'PROMOTE_HEADERS' | 'REPLACE_VALUE' | 'DROP_COLUMN';
interface PQTransformStep {
  id: string;
  type: PQStepType;
  name: string;
  params: any;
}

interface Dataset {
  id: string;
  name: string;
  columns: string[];
  data: any[];
  isHidden?: boolean;
  transformations?: PQTransformStep[]; // Liste des étapes de nettoyage
}

interface CustomMeasure {
  id: string;
  datasetId: string;
  name: string;
  formula: string;
}

interface DashboardTab {
  id: string;
  name: string;
}

interface ChartSeries {
  id: string;
  yAxisCol: string;
  isMeasure: boolean;
  aggregation: AggregationType;
  color: string;
  alias?: string;
}

interface WidgetConfig {
  id: string;
  title: string;
  type: WidgetType;
  datasetId: string;
  xAxisCol?: string;
  dateGrouping: DateGrouping;
  series: ChartSeries[];
  filters: FilterConfig[];
  showLabels?: boolean;
  legendPosition?: LegendPosition;
  widgetSize?: WidgetSize;
  tabId?: string;
  orientation?: ChartOrientation;
}

interface TrackedRisk {
  id: string;
  title: string;
  description: string;
  icon: string;
  datasets: Dataset[];
  measures: CustomMeasure[];
  widgets: WidgetConfig[];
  tabs?: DashboardTab[];
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

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  switch (grouping) {
    case 'day': return `${year}-${month}-${day}`;
    case 'month': return `${year}-${month}`;
    case 'year': return `${year}`;
    case 'quarter': return `${year}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    case 'week': {
      const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = d2.getUTCDay() || 7;
      d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${d2.getUTCFullYear()}-S${String(weekNo).padStart(2, '0')}`;
    }
    default: return safeString(rawDate);
  }
};

// ============================================================================
// MOTEUR POWER QUERY (Transformations à la volée)
// ============================================================================
const computeDatasetPreview = (dataset: Dataset | undefined) => {
  if (!dataset) return { columns: [], data: [] };

  let currentData = [...dataset.data];
  let currentColumns = [...dataset.columns];

  (dataset.transformations || []).forEach(step => {
    if (step.type === 'PROMOTE_HEADERS') {
      if (currentData.length > 0) {
        const firstRow = currentData[0];
        const newColumns: string[] = [];
        currentData = currentData.slice(1).map(row => {
          const newRow: any = {};
          currentColumns.forEach(col => {
            const newColName = firstRow[col] !== undefined && firstRow[col] !== null ? String(firstRow[col]).trim() : col;
            if (!newColumns.includes(newColName)) newColumns.push(newColName);
            newRow[newColName] = row[col];
          });
          return newRow;
        });
        currentColumns = Array.from(new Set(newColumns));
      }
    }
    else if (step.type === 'REPLACE_VALUE') {
      const { column, search, replace } = step.params;
      currentData = currentData.map(row => {
        const val = row[column];
        let newVal = val;
        if (val !== undefined && val !== null) {
          const strVal = String(val);
          // Remplacement exact ou partiel
          if (strVal === search) {
            newVal = replace;
          } else if (strVal.includes(search)) {
            newVal = strVal.replaceAll(search, replace);
          }
        }
        return { ...row, [column]: newVal };
      });
    }
  });

  return { columns: currentColumns, data: currentData };
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
          rowDate.setHours(0, 0, 0, 0);
          filterDate.setHours(0, 0, 0, 0);
          const rTime = rowDate.getTime();
          const fTime = filterDate.getTime();
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
          const numRaw = safeNumber(rawVal);
          const numFilt = safeNumber(f.value);
          if (!isNaN(numRaw) && !isNaN(numFilt)) return numRaw > numFilt;
          return strVal > filterVal;
        case 'lt':
          const numRawLt = safeNumber(rawVal);
          const numFiltLt = safeNumber(f.value);
          if (!isNaN(numRawLt) && !isNaN(numFiltLt)) return numRawLt < numFiltLt;
          return strVal < filterVal;
        default: return true;
      }
    });
  });
};

const aggregateMultiSeries = (rawData: any[], xAxisCol: string, dateGrouping: DateGrouping, series: ChartSeries[], measures: CustomMeasure[], filters: FilterConfig[]) => {
  const filteredData = applyFiltersToData(rawData, filters);
  if (!filteredData || filteredData.length === 0) return [];
  const groups = new Map<string, any[]>();

  filteredData.forEach(row => {
    let key = row[xAxisCol];
    if (dateGrouping !== 'none') {
      key = formatTimeGrouping(key, dateGrouping);
    } else {
      key = safeString(key || 'N/A');
    }

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
        if (m) {
          try {
            outRow[s.id] = new DaxEngine(rows).evaluateMeasure(m.formula);
          } catch {
            outRow[s.id] = 0;
          }
        }
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
      try { return new DaxEngine(filteredData).evaluateMeasure(m.formula); } catch { return 0; }
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
// SOUS-COMPOSANTS : AMÉLIORATION DE L'AFFICHAGE DES GRAPHIQUES
// ============================================================================
const truncateText = (text: string, maxLength: number) => {
  const str = String(text || "");
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + "...";
};

const CustomXAxisTick = ({ x, y, payload }: any) => {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0} y={0} dy={14}
        textAnchor="end" fill="currentColor" className="text-muted-foreground"
        transform="rotate(-40)" fontSize={10}
      >
        {truncateText(payload.value, 15)}
        <title>{payload.value}</title>
      </text>
    </g>
  );
};

// ============================================================================
// COMPOSANT DÉDIÉ AU RENDU DES WIDGETS
// ============================================================================
const DashboardWidget = React.memo(({ widget, datasets, measures }: { widget: WidgetConfig, datasets: Dataset[], measures: CustomMeasure[] }) => {
  const dataset = datasets.find(d => d.id === widget.datasetId);

  const getSeriesName = (s: ChartSeries) => {
    if (s.alias && s.alias.trim() !== "") return s.alias;
    return s.isMeasure ? s.yAxisCol : `${s.aggregation} : ${s.yAxisCol}`;
  };

  const chartData = useMemo(() => {
    if (!dataset || widget.type === 'kpi' || !widget.xAxisCol || widget.series.length === 0) return [];

    // Utiliser les données TRANSFORMÉES pour les graphiques !
    const processedDataset = computeDatasetPreview(dataset);

    return aggregateMultiSeries(
      processedDataset.data,
      widget.xAxisCol,
      widget.dateGrouping,
      widget.series,
      measures,
      widget.filters || []
    );
  }, [dataset, widget.xAxisCol, widget.dateGrouping, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  const kpiValues = useMemo(() => {
    if (!dataset || widget.series.length === 0) return [];
    const processedDataset = computeDatasetPreview(dataset);
    return aggregateGlobal(processedDataset.data, widget.series, measures, widget.filters || []);
  }, [dataset, JSON.stringify(widget.series), JSON.stringify(widget.filters), measures]);

  if (!dataset) return <div className="flex h-full items-center justify-center text-xs text-rose-500 font-bold text-center px-4">Source de données introuvable.</div>;
  if (widget.series.length === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Sélectionnez les données à analyser.</div>;
  if (widget.type !== 'kpi' && widget.type !== 'pie' && !widget.xAxisCol) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground text-center px-4">Définissez l'Axe de répartition.</div>;

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

  const renderCustomizedPieLabel = (props: any) => {
    const { cx, cy, midAngle, outerRadius, percent, index, name, fill } = props;
    if (percent < 0.02) return null;
    const RADIAN = Math.PI / 180;
    const sin = Math.sin(-RADIAN * midAngle);
    const cos = Math.cos(-RADIAN * midAngle);
    const sx = cx + (outerRadius) * cos;
    const sy = cy + (outerRadius) * sin;
    const distanceCassure = index % 2 === 0 ? 15 : 35;
    const mx = cx + (outerRadius + distanceCassure) * cos;
    const my = cy + (outerRadius + distanceCassure) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 20;
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';
    const formattedPercent = (percent * 100).toFixed(1).replace('.', ',');

    return (
      <g>
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" strokeWidth={1} />
        <circle cx={ex} cy={ey} r={2.5} fill={fill} stroke="none" />
        <text
          x={ex + (cos >= 0 ? 1 : -1) * 8} y={ey}
          textAnchor={textAnchor} fill="currentColor" className="text-muted-foreground"
          dominantBaseline="central" fontSize={10} fontWeight="600"
        >
          {`${truncateText(name, 12)} : ${formattedPercent}%`}
        </text>
      </g>
    );
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
            innerRadius={widget.widgetSize === 'large' ? "40%" : "30%"}
            outerRadius={widget.widgetSize === 'large' ? "65%" : "55%"}
            paddingAngle={2} dataKey="value" nameKey="name"
            labelLine={false} label={widget.showLabels !== false ? renderCustomizedPieLabel : false}
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

  const isHorizontal = widget.orientation === 'horizontal';
  const marginConfig = { top: 20, right: isHorizontal ? 30 : 10, left: isHorizontal ? 0 : 0, bottom: legendPos === 'bottom' ? 0 : 0 };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {widget.type === 'bar' ? (
        <BarChart data={chartData} margin={marginConfig} layout={isHorizontal ? "vertical" : "horizontal"}>
          <CartesianGrid strokeDasharray="3 3" horizontal={!isHorizontal} vertical={isHorizontal} stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis type={isHorizontal ? "number" : "category"} dataKey={isHorizontal ? undefined : widget.xAxisCol} tick={isHorizontal ? { fontSize: 10 } : <CustomXAxisTick />} height={isHorizontal ? 30 : 80} axisLine={false} tickLine={false} interval={0} />
          <YAxis type={isHorizontal ? "category" : "number"} dataKey={isHorizontal ? widget.xAxisCol : undefined} tick={{ fontSize: 10 }} width={isHorizontal ? 250 : 70} axisLine={false} tickLine={false} tickFormatter={(val) => isHorizontal ? truncateText(val, 40) : val} />
          <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
          {renderLegend()}
          {widget.series.map(s => (
            <Bar key={`bar-${s.id}`} dataKey={s.id} name={getSeriesName(s)} fill={s.color} radius={isHorizontal ? [0, 2, 2, 0] : [2, 2, 0, 0]} label={widget.showLabels !== false ? { position: isHorizontal ? 'right' : 'top', fontSize: 10, fill: 'currentColor', formatter: formatLabel } : false} />
          ))}
        </BarChart>
      ) : (
        <AreaChart data={chartData} margin={marginConfig}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey={widget.xAxisCol} tick={<CustomXAxisTick />} height={80} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
          <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
          {renderLegend()}
          {widget.series.map(s => (
            <Area key={s.id} type="monotone" dataKey={s.id} name={getSeriesName(s)} stroke={s.color} fill={s.color} fillOpacity={0.1} strokeWidth={2} label={widget.showLabels !== false ? { position: 'top', fontSize: 10, fill: 'currentColor', formatter: formatLabel } : false} />
          ))}
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
});

// ============================================================================
// COMPOSANT PRINCIPAL (VIEW)
// ============================================================================
export default function RisksView() {

  const [risks, setRisks] = useState<TrackedRisk[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const [isRibbonCollapsed, setIsRibbonCollapsed] = useState(false);
  const [activeRibbonTab, setActiveRibbonTab] = useState<string>('Accueil');

  // ETATS DE L'EDITEUR POWER QUERY
  const [isPowerQueryOpen, setIsPowerQueryOpen] = useState(false);
  const [pqRibbonTab, setPqRibbonTab] = useState<string>('Transformer');
  const [pqSelectedDatasetId, setPqSelectedDatasetId] = useState<string>("");
  const [pqSelectedColumn, setPqSelectedColumn] = useState<string | null>(null);

  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [replaceSearchValue, setReplaceSearchValue] = useState("");
  const [replaceNewValue, setReplaceNewValue] = useState("");

  const [collapsedDatasets, setCollapsedDatasets] = useState<Set<string>>(new Set());
  const [showHiddenDatasets, setShowHiddenDatasets] = useState(false);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isVisOpen, setIsVisOpen] = useState(false);
  const [isDataOpen, setIsDataOpen] = useState(false);

  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState("");

  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);

  const [riskToDelete, setRiskToDelete] = useState<string | null>(null);
  const [widgetToDelete, setWidgetToDelete] = useState<string | null>(null);
  const [datasetToDelete, setDatasetToDelete] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);
  const [isAppendOpen, setIsAppendOpen] = useState(false);

  const [appendSource1, setAppendSource1] = useState<string>("");
  const [appendSource2, setAppendSource2] = useState<string>("");
  const [appendNewName, setAppendNewName] = useState<string>("");

  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [isImporting, setIsImporting] = useState(false);
  const [newRiskTitle, setNewRiskTitle] = useState("");
  const [newRiskDesc, setNewRiskDesc] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Dataset[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  useEffect(() => {
    const fetchRisks = async () => {
      try {
        const { data, error } = await supabase.from('risk_dashboards' as any).select('*');
        if (error) throw error;

        if (data && data.length > 0) {
          const formattedRisks = data.map((row: any) => {
            const defaultTabId = `tab_${row.id}_default`;
            const existingTabs = (row.tabs && row.tabs.length > 0) ? row.tabs : [{ id: defaultTabId, name: 'Page 1' }];

            const existingWidgets = (row.widgets || []).map((w: any) => ({
               ...w,
               tabId: w.tabId || existingTabs[0].id
            }));

            return {
              id: row.id,
              title: row.title,
              description: row.description || "",
              icon: row.icon || "shield",
              datasets: row.datasets || [],
              measures: row.measures || [],
              widgets: existingWidgets,
              tabs: existingTabs
            };
          });
          setRisks(formattedRisks);
        }
      } catch (error) {
        toast.error("Impossible de charger les données depuis le cloud.");
      } finally {
        setIsInitialized(true);
      }
    };
    fetchRisks();
  }, []);

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
          tabs: r.tabs,
          updated_at: new Date().toISOString()
        }));

        if (JSON.stringify(recordsToUpsert).length > MAX_PAYLOAD_SIZE) {
          throw new Error("Payload too large");
        }

        if (recordsToUpsert.length > 0) {
          const { error } = await supabase.from('risk_dashboards' as any).upsert(recordsToUpsert);
          if (error) throw error;
        }
      } catch (err: any) {
        if (err.message === "Payload too large") {
          toast.error("Volume de données trop important pour le Cloud.");
        }
        try {
          const safeBackup = risks.map(r => ({ ...r, datasets: r.datasets.map(d => ({ ...d, data: d.data.slice(0, 100) })) }));
          localStorage.setItem("pbi_risks_backup", JSON.stringify(safeBackup));
        } catch(e) {}
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [risks, isInitialized]);

  // FONCTIONS DE BASE
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

            const sampleRow = rawData[0] as object;
            const dateColumn = Object.keys(sampleRow).find(key => key.toUpperCase().includes('DATE'));

            let cleanData = rawData.filter((row: any) => {
              if (dateColumn) {
                return row[dateColumn] !== null && row[dateColumn] !== undefined && String(row[dateColumn]).trim() !== "";
              } else {
                return Object.values(row).some(val => val !== null && val !== undefined && String(val).trim() !== "");
              }
            });

            if (cleanData.length > 0) {
              cleanData = cleanData.map((row: any) => {
                const minifiedRow: any = {};
                Object.keys(row).forEach(key => {
                  if (!key.includes('__EMPTY') && row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== "") {
                    minifiedRow[key] = row[key];
                  }
                });
                return minifiedRow;
              });

              if (cleanData.length > MAX_ROWS_PER_DATASET) {
                toast.warning(`⚠️ La feuille "${sheetName}" contient trop de lignes. Seules les ${MAX_ROWS_PER_DATASET} premières ont été conservées.`);
                cleanData = cleanData.slice(0, MAX_ROWS_PER_DATASET);
              }

              const validColumns = Array.from(new Set(cleanData.flatMap(r => Object.keys(r))));

              sheetsData.push({
                id: `ds_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: sheetName,
                columns: validColumns,
                data: cleanData,
                isHidden: false,
                transformations: [] // Initialisation des étapes Power Query
              });
            }
          });

          if (sheetsData.length === 0) {
            throw new Error("Le fichier ne contient aucune ligne valide.");
          }

          setAvailableSheets(sheetsData);
          setSelectedSheets(sheetsData.map(sheet => sheet.id));
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

  const toggleSheetSelection = (id: string) => {
    setSelectedSheets(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const resetWizard = () => {
    setWizardStep(1);
    setNewRiskTitle("");
    setNewRiskDesc("");
    setAvailableSheets([]);
    setSelectedSheets([]);
  };

  const finalizeRiskCreation = () => {
    if (selectedSheets.length === 0) return toast.error("Sélectionnez au moins une table.");

    const datasets = availableSheets.filter(s => selectedSheets.includes(s.id));
    const defaultTab = { id: `tab_${Date.now()}`, name: 'Page 1' };

    const newRisk: TrackedRisk = {
      id: `risk_${Date.now()}`,
      title: newRiskTitle,
      description: newRiskDesc,
      icon: "shield",
      datasets,
      measures: [],
      widgets: [],
      tabs: [defaultTab]
    };

    setRisks([...risks, newRisk]);
    setIsAddOpen(false);
    resetWizard();
    toast.success(`Analyse créée !`);
    setActiveRiskId(newRisk.id);
    setActiveTabId(defaultTab.id);
  };

  const finalizeAddData = () => {
    if (selectedSheets.length === 0) return toast.error("Sélectionnez au moins une table.");
    const newDatasets = availableSheets.filter(s => selectedSheets.includes(s.id));
    updateActiveRisk({ datasets: [...(activeRisk?.datasets || []), ...newDatasets] });
    setIsAddDataOpen(false);
    resetWizard();
    toast.success(`${newDatasets.length} source(s) ajoutée(s).`);
  };

  const activeRisk = risks.find(r => r.id === activeRiskId);
  const activeWidget = activeRisk?.widgets.find(w => w.id === activeWidgetId);
  const activeDataset = activeWidget ? activeRisk?.datasets.find(d => d.id === activeWidget.datasetId) : null;

  const visibleWidgets = activeRisk?.widgets.filter(w => w.tabId === activeTabId) || [];

  const updateActiveRisk = (updates: Partial<TrackedRisk>) => {
    setRisks(risks.map(r => r.id === activeRiskId ? { ...r, ...updates } : r));
  };

  const confirmDeleteRisk = async (id: string) => {
    setRisks(risks.filter(r => r.id !== id));
    if (activeRiskId === id) setActiveRiskId(null);
    try {
      await supabase.from('risk_dashboards' as any).delete().eq('id', id);
      toast.success("Analyse supprimée.");
    } catch(err) {}
    setRiskToDelete(null);
  };

  // ============================================================================
  // LOGIQUE POWER QUERY
  // ============================================================================
  const pqSelectedDatasetObj = activeRisk?.datasets.find(d => d.id === pqSelectedDatasetId);

  // Utilisation de notre moteur pour générer l'aperçu en direct
  const pqPreview = useMemo(() => {
    return computeDatasetPreview(pqSelectedDatasetObj);
  }, [pqSelectedDatasetObj, pqSelectedDatasetObj?.transformations]);

  const handleAddTransformation = (step: PQTransformStep) => {
    if (!activeRisk || !pqSelectedDatasetId) return;
    const updatedDatasets = activeRisk.datasets.map(d => {
      if (d.id === pqSelectedDatasetId) {
        return { ...d, transformations: [...(d.transformations || []), step] };
      }
      return d;
    });
    updateActiveRisk({ datasets: updatedDatasets });
  };

  const handleRemoveTransformation = (stepId: string) => {
    if (!activeRisk || !pqSelectedDatasetId) return;
    const updatedDatasets = activeRisk.datasets.map(d => {
      if (d.id === pqSelectedDatasetId) {
        return { ...d, transformations: (d.transformations || []).filter(s => s.id !== stepId) };
      }
      return d;
    });
    updateActiveRisk({ datasets: updatedDatasets });
  };

  // Action : Promouvoir les en-têtes
  const executePromoteHeaders = () => {
    if (!pqSelectedDatasetId) return toast.error("Sélectionnez une requête à gauche.");
    handleAddTransformation({
      id: `step_${Date.now()}`,
      type: 'PROMOTE_HEADERS',
      name: 'En-têtes promus',
      params: {}
    });
    toast.success("En-têtes promus avec succès.");
  };

  // Action : Remplacer les valeurs
  const openReplaceValues = () => {
    if (!pqSelectedDatasetId) return toast.error("Sélectionnez une requête à gauche.");
    if (!pqSelectedColumn) return toast.error("Cliquez sur l'en-tête d'une colonne d'abord.");
    setIsReplaceModalOpen(true);
  };

  const executeReplaceValues = () => {
    if (!pqSelectedColumn) return;
    handleAddTransformation({
      id: `step_${Date.now()}`,
      type: 'REPLACE_VALUE',
      name: `Valeur remplacée (${pqSelectedColumn})`,
      params: { column: pqSelectedColumn, search: replaceSearchValue, replace: replaceNewValue }
    });
    setIsReplaceModalOpen(false);
    setReplaceSearchValue("");
    setReplaceNewValue("");
    toast.success(`Les valeurs "${replaceSearchValue}" ont été remplacées par "${replaceNewValue}".`);
  };

  // ONGLETS ET WIDGETS
  const handleAddNewTab = () => {
    if (!activeRisk) return;
    const newTab = { id: `tab_${Date.now()}`, name: `Page ${(activeRisk.tabs?.length || 0) + 1}` };
    updateActiveRisk({ tabs: [...(activeRisk.tabs || []), newTab] });
    setActiveTabId(newTab.id);
  };

  const handleRenameTab = (tabId: string, newName: string) => {
    if (!activeRisk || !newName.trim()) return;
    updateActiveRisk({
      tabs: activeRisk.tabs?.map(t => t.id === tabId ? { ...t, name: newName.trim() } : t)
    });
  };

  const handleDeleteTab = (tabId: string) => {
    if (!activeRisk || (activeRisk.tabs && activeRisk.tabs.length <= 1)) {
      return toast.error("Vous devez conserver au moins une page.");
    }
    const updatedTabs = activeRisk.tabs!.filter(t => t.id !== tabId);
    const updatedWidgets = activeRisk.widgets.filter(w => w.tabId !== tabId);
    updateActiveRisk({ tabs: updatedTabs, widgets: updatedWidgets });

    if (activeTabId === tabId) {
      setActiveTabId(updatedTabs[0].id);
    }
    toast.success("Page supprimée.");
  };

  const handleDuplicateTab = (tabId: string) => {
    if (!activeRisk) return;
    const tabToCopy = activeRisk.tabs?.find(t => t.id === tabId);
    if (!tabToCopy) return;

    const newTabId = `tab_${Date.now()}`;
    const newTab = { id: newTabId, name: `${tabToCopy.name} (Copie)` };

    const widgetsToCopy = activeRisk.widgets.filter(w => w.tabId === tabId);
    const clonedWidgets = widgetsToCopy.map(w => ({
      ...w,
      id: `w_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      tabId: newTabId
    }));

    updateActiveRisk({
      tabs: [...(activeRisk.tabs || []), newTab],
      widgets: [...activeRisk.widgets, ...clonedWidgets]
    });

    setActiveTabId(newTabId);
    toast.success("Page dupliquée !");
  };

  const handleMoveTab = (tabId: string, direction: 'left' | 'right') => {
    if (!activeRisk || !activeRisk.tabs) return;
    const tabs = [...activeRisk.tabs];
    const currentIndex = tabs.findIndex(t => t.id === tabId);
    if (currentIndex < 0) return;

    if (direction === 'left' && currentIndex > 0) {
      const temp = tabs[currentIndex - 1];
      tabs[currentIndex - 1] = tabs[currentIndex];
      tabs[currentIndex] = temp;
    } else if (direction === 'right' && currentIndex < tabs.length - 1) {
      const temp = tabs[currentIndex + 1];
      tabs[currentIndex + 1] = tabs[currentIndex];
      tabs[currentIndex] = temp;
    } else {
      return;
    }

    updateActiveRisk({ tabs });
  };

  const addWidgetToStudio = () => {
    if (!activeRisk || activeRisk.datasets.length === 0) {
      return toast.error("Veuillez charger des données.");
    }

    const defaultDataset = activeRisk.datasets.find(d => !d.isHidden) || activeRisk.datasets[0];

    const newWidget: WidgetConfig = {
      id: `w_${Date.now()}`,
      title: "Nouvel Indicateur",
      type: "bar",
      datasetId: defaultDataset.id,
      dateGrouping: "none",
      series: [],
      filters: [],
      showLabels: true,
      legendPosition: 'bottom',
      widgetSize: 'medium',
      tabId: activeTabId!,
      orientation: 'vertical'
    };

    updateActiveRisk({ widgets: [...activeRisk.widgets, newWidget] });
    setActiveWidgetId(newWidget.id);
    setIsVisOpen(true);
    setIsDataOpen(true);
  };

  const updateActiveWidget = (updates: Partial<WidgetConfig>) => {
    if (!activeRisk || !activeWidgetId) return;
    if (updates.datasetId && updates.datasetId !== activeWidget?.datasetId) {
      updates.xAxisCol = "";
      updates.series = [];
      updates.filters = [];
    }
    updateActiveRisk({
      widgets: activeRisk.widgets.map(w => w.id === activeWidgetId ? { ...w, ...updates } : w)
    });
  };

  const confirmDeleteWidget = () => {
    updateActiveRisk({ widgets: activeRisk!.widgets.filter(w => w.id !== widgetToDelete) });
    if (activeWidgetId === widgetToDelete) setActiveWidgetId(null);
    setWidgetToDelete(null);
  };

  const toggleDatasetCollapse = (datasetId: string) => {
    setCollapsedDatasets(prev => {
      const next = new Set(prev);
      if (next.has(datasetId)) {
        next.delete(datasetId);
      } else {
        next.add(datasetId);
      }
      return next;
    });
  };

  const toggleDatasetVisibility = (e: React.MouseEvent, datasetId: string) => {
    e.stopPropagation();
    if (!activeRisk) return;
    updateActiveRisk({
      datasets: activeRisk.datasets.map(d => d.id === datasetId ? { ...d, isHidden: !d.isHidden } : d)
    });
  };

  const confirmRemoveDataset = (datasetId: string) => {
    if (!activeRisk) return;
    updateActiveRisk({ datasets: activeRisk.datasets.filter(d => d.id !== datasetId) });
    setDatasetToDelete(null);
  };

  const handleAppendDatasets = () => {
    if (!activeRisk || !appendSource1 || !appendSource2 || !appendNewName) {
      return toast.error("Complétez le formulaire de fusion.");
    }

    const ds1 = activeRisk.datasets.find(d => d.id === appendSource1);
    const ds2 = activeRisk.datasets.find(d => d.id === appendSource2);

    if (!ds1 || !ds2) return;

    let combinedData = [...ds1.data, ...ds2.data];
    if (combinedData.length > MAX_ROWS_PER_DATASET) {
      combinedData = combinedData.slice(0, MAX_ROWS_PER_DATASET);
    }

    const newDataset: Dataset = {
      id: `ds_${Date.now()}`,
      name: appendNewName,
      columns: Array.from(new Set([...ds1.columns, ...ds2.columns])),
      data: combinedData,
      isHidden: false,
      transformations: []
    };

    updateActiveRisk({ datasets: [...activeRisk.datasets, newDataset] });
    setIsAppendOpen(false);
    setAppendSource1("");
    setAppendSource2("");
    setAppendNewName("");
    toast.success(`Table "${appendNewName}" créée.`);
  };

  const addSeriesWithData = (colName: string, isMeasure: boolean) => {
    updateActiveWidget({
      series: [...activeWidget!.series, { id: `s_${Date.now()}`, yAxisCol: colName, isMeasure, aggregation: "SUM", color: COLORS[activeWidget!.series.length % COLORS.length] }]
    });
  };

  const addSeries = () => {
    updateActiveWidget({
      series: [...activeWidget!.series, { id: `s_${Date.now()}`, yAxisCol: "", isMeasure: false, aggregation: "SUM", color: COLORS[activeWidget!.series.length % COLORS.length] }]
    });
  };

  const updateSeries = (seriesId: string, updates: Partial<ChartSeries>) => {
    updateActiveWidget({
      series: activeWidget!.series.map(s => s.id === seriesId ? { ...s, ...updates } : s)
    });
  };

  const removeSeries = (seriesId: string) => {
    updateActiveWidget({ series: activeWidget!.series.filter(s => s.id !== seriesId) });
  };

  const addFilter = () => {
    updateActiveWidget({ filters: [...(activeWidget!.filters || []), { id: `f_${Date.now()}`, column: "", operator: "eq", value: "" }] });
    setIsFiltersOpen(true);
  };

  const updateFilter = (filterId: string, updates: Partial<FilterConfig>) => {
    updateActiveWidget({ filters: activeWidget!.filters.map(f => f.id === filterId ? { ...f, ...updates } : f) });
  };

  const removeFilter = (filterId: string) => {
    updateActiveWidget({ filters: activeWidget!.filters.filter(f => f.id !== filterId) });
  };

  const toggleColumnInWidget = (colName: string, isMeasure: boolean, datasetId: string) => {
    if (!activeWidget) return toast.info("Sélectionnez un indicateur.");
    if (activeWidget.datasetId !== datasetId) return toast.error("Source différente.");

    const isX = activeWidget.xAxisCol === colName;
    const seriesMatch = activeWidget.series.find(s => s.yAxisCol === colName);

    if (isX) {
      updateActiveWidget({ xAxisCol: "" });
    } else if (seriesMatch) {
      removeSeries(seriesMatch.id);
    } else {
      if (!activeWidget.xAxisCol && !isMeasure && activeWidget.type !== 'kpi') {
        updateActiveWidget({ xAxisCol: colName });
      } else {
        addSeriesWithData(colName, isMeasure);
      }
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

  const renderDatasetItem = (ds: Dataset, isHiddenList: boolean = false) => {
    // Calcul des colonnes APRES transformation pour le panneau de droite
    const previewCols = computeDatasetPreview(ds).columns;

    return (
      <div key={ds.id} className="text-sm min-w-0 group/dataset mb-2">
        <div
          className={`flex items-center justify-between p-2 rounded font-bold cursor-pointer transition-colors ${isHiddenList ? 'bg-muted/30 text-muted-foreground italic' : 'bg-muted/50 text-foreground hover:bg-muted/80'}`}
          onClick={() => toggleDatasetCollapse(ds.id)}
        >
          <div className="flex items-center gap-2 truncate">
             {collapsedDatasets.has(ds.id) ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
             <Database className={`w-3.5 h-3.5 shrink-0 ${isHiddenList ? 'opacity-40' : 'text-muted-foreground'}`}/>
             <span className="truncate">{ds.name}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
             <button
               onClick={(e) => toggleDatasetVisibility(e, ds.id)}
               className="opacity-0 group-hover/dataset:opacity-100 text-muted-foreground hover:text-primary transition-opacity p-1"
               title={isHiddenList ? "Restaurer la table" : "Masquer la table"}
             >
               {isHiddenList ? <Eye className="w-3.5 h-3.5"/> : <EyeOff className="w-3 h-3"/>}
             </button>
             {!isHiddenList && (
               <button
                 onClick={(e) => { e.stopPropagation(); setDatasetToDelete(ds.id); }}
                 className="opacity-0 group-hover/dataset:opacity-100 text-rose-500 hover:text-rose-700 transition-opacity p-1"
                 title="Supprimer"
               >
                 <Trash2 className="w-3 h-3"/>
               </button>
             )}
          </div>
        </div>

        {(!collapsedDatasets.has(ds.id)) && (
          <div className="pl-2 flex flex-col gap-1 mt-1 border-l ml-3 pb-2 min-w-0 animate-in slide-in-from-top-1">
            {activeRisk?.measures.filter(m => m.datasetId === ds.id).map(m => {
              const isChecked = activeWidget?.datasetId === ds.id && activeWidget?.series.some(s => s.yAxisCol === m.name);
              return (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: m.name, isMeasure: true, datasetId: ds.id }))}
                  className={`flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing min-w-0 ${isHiddenList ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
                  <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(m.name, true, ds.id)} className="accent-primary shrink-0" />
                  <Calculator className="w-3 h-3 text-primary shrink-0"/>
                  <span className="text-primary font-medium truncate">{m.name}</span>
                </div>
              );
            })}

            {/* On utilise previewCols pour afficher les colonnes dynamiquement après PQ */}
            {previewCols.map(col => {
              const isChecked = activeWidget?.datasetId === ds.id && (activeWidget?.xAxisCol === col || activeWidget?.series.some(s => s.yAxisCol === col));
              return (
                <div
                  key={col}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ colName: col, isMeasure: false, datasetId: ds.id }))}
                  className={`flex items-center gap-2 text-xs py-1 hover:bg-muted rounded px-1 group cursor-grab active:cursor-grabbing min-w-0 ${isHiddenList ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
                  <input type="checkbox" checked={!!isChecked} onChange={() => toggleColumnInWidget(col, false, ds.id)} className="accent-primary shrink-0" />
                  <Sigma className="w-3 h-3 text-muted-foreground shrink-0"/>
                  <span className="text-muted-foreground truncate" title={col}>{col}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (!isInitialized) {
    return (
      <div className="flex h-[calc(100vh-6rem)] items-center justify-center -m-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium ml-4">Chargement...</p>
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
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-primary" /> Suivi des Risques
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gérez vos modèles d'analyse et suivez vos indicateurs de risques.</p>
          </div>

          <Dialog open={isAddOpen} onOpenChange={(o) => { setIsAddOpen(o); if(!o) resetWizard(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Nouvelle Analyse</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Configuration de l'Analyse</DialogTitle></DialogHeader>

              {wizardStep === 1 && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Nom de l'analyse</Label>
                    <Input value={newRiskTitle} onChange={e => setNewRiskTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description de l'objectif</Label>
                    <Input value={newRiskDesc} onChange={e => setNewRiskDesc(e.target.value)} />
                  </div>
                  <div className="space-y-2 pt-4 border-t">
                    <Label className="text-primary font-bold">Source de données (.xlsx, .csv)</Label>
                    {isImporting ? (
                      <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/10">
                        <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                      </div>
                    ) : (
                      <div className="relative">
                        <input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={!newRiskTitle} />
                        <Button variant="outline" className="w-full h-24 border-dashed border-2 flex-col gap-2" disabled={!newRiskTitle}>
                          <FileSpreadsheet className="w-6 h-6" /><span>Sélectionner le fichier</span>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-6 py-4">
                  <div className="bg-primary/10 text-primary p-3 rounded-lg flex items-center gap-3">
                    <Database className="w-6 h-6 shrink-0"/>
                    <div>
                      <h4 className="font-bold text-sm">Données analysées</h4>
                      <p className="text-xs">Sélectionnez les tables à inclure.</p>
                    </div>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto space-y-2 border p-2 rounded-md">
                    {availableSheets.map(sheet => (
                      <div
                        key={sheet.id}
                        onClick={() => toggleSheetSelection(sheet.id)}
                        className={`flex justify-between p-3 rounded border cursor-pointer ${selectedSheets.includes(sheet.id) ? 'bg-primary/5 border-primary shadow-sm' : 'hover:bg-muted'}`}
                      >
                        <div className="flex items-center gap-3">
                          <CheckSquare className={`w-5 h-5 ${selectedSheets.includes(sheet.id) ? 'text-primary' : 'opacity-30'}`} />
                          <p className="font-bold text-sm">{sheet.name}</p>
                        </div>
                        <Badge variant="secondary">{sheet.data.length} entrées</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">Retour</Button>
                    <Button onClick={finalizeRiskCreation} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={selectedSheets.length === 0}>Créer</Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2">
          {risks.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">Ce module de suivi est vide. Ajoutez une première analyse de risques.</div>}

          {risks.map((risk) => (
            <Card
              key={risk.id}
              onClick={() => {
                setActiveRiskId(risk.id);
                setActiveTabId(risk.tabs?.[0]?.id || null);
                setIsFiltersOpen(false);
                setIsVisOpen(false);
                setIsDataOpen(false);
                setActiveWidgetId(null);
                setShowHiddenDatasets(false);
              }}
              className="group cursor-pointer border-l-4 border-l-primary hover:-translate-y-1 shadow-sm relative"
            >
              <button
                onClick={(e) => { e.stopPropagation(); setRiskToDelete(risk.id); }}
                className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-rose-100 hover:text-rose-600 z-10 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4 pr-8">
                  <div className="p-2.5 rounded-lg bg-primary/10 text-primary"><Shield className="w-6 h-6" /></div>
                  <div className="min-w-0"><h3 className="font-bold text-lg truncate">{risk.title}</h3></div>
                </div>
                <div className="flex gap-2 mb-4">
                  <Badge variant="outline" className="text-[10px] bg-secondary/50"><Database className="w-3 h-3 mr-1"/> {risk.datasets.length} Sources</Badge>
                  <Badge variant="outline" className="text-[10px] bg-secondary/50"><BarChart3 className="w-3 h-3 mr-1"/> {risk.widgets.length} Indicateurs</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <AlertDialog open={!!riskToDelete} onOpenChange={(open) => !open && setRiskToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Êtes-vous absolument sûr ?</AlertDialogTitle>
              <AlertDialogDescription>Cette action est irréversible. Cela supprimera définitivement l'analyse.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => riskToDelete && confirmDeleteRisk(riskToDelete)}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ============================================================================
  // VUE 2 : STUDIO BI (LAYOUT FAÇON POWER BI AVEC RUBAN RÉTRACTABLE)
  // ============================================================================
  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] animate-in fade-in duration-300 -m-4 bg-slate-50 dark:bg-slate-900/50">

      {/* =================================================================== */}
      {/* LE RUBAN (RIBBON) POWER BI AVEC FONCTION DE RÉDUCTION               */}
      {/* =================================================================== */}
      <div className="flex flex-col bg-background shadow-sm z-20 relative">

        {/* Ligne 1 : Titre et Menu textuel (Onglets du Ruban) */}
        <div className="flex items-end justify-between px-2 pt-2 text-sm border-b bg-muted/20">
          <div className="flex items-end gap-4">
            <div className="flex items-center gap-2 pr-4 border-r pb-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {setActiveRiskId(null); setActiveWidgetId(null)}}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <span className="font-bold truncate max-w-[200px]">{activeRisk?.title}</span>
            </div>

            <div className="flex gap-1">
              {['Fichier', 'Accueil', 'Insérer', 'Modélisation', 'Affichage', 'Optimiser', 'Aide'].map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveRibbonTab(tab);
                    if (isRibbonCollapsed) setIsRibbonCollapsed(false);
                  }}
                  className={`px-4 py-1.5 rounded-t-md transition-colors border-b-2 -mb-[1px] ${
                    activeRibbonTab === tab && !isRibbonCollapsed
                      ? 'border-primary text-primary bg-background font-bold shadow-[0_-2px_5px_rgba(0,0,0,0.02)]'
                      : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Bouton pour Réduire/Agrandir le ruban */}
          <div className="pb-1 pr-2">
            <button
              onClick={() => setIsRibbonCollapsed(!isRibbonCollapsed)}
              className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground rounded transition-colors"
              title={isRibbonCollapsed ? "Développer le ruban" : "Réduire le ruban"}
            >
               {isRibbonCollapsed ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
            </button>
          </div>
        </div>

        {/* Ligne 2 : Les Outils (Le Ruban Actif - Masqué si isRibbonCollapsed est true) */}
        <div className={`transition-all duration-300 overflow-hidden ${isRibbonCollapsed ? 'h-0 border-0' : 'h-auto border-b'}`}>
          <div className="flex items-center px-2 py-2 gap-4 bg-background min-h-[85px] overflow-x-auto">

            {activeRibbonTab === 'Fichier' && (
              <div className="flex items-center text-xs text-muted-foreground px-4 italic">
                Menu fichier (Enregistrer, Exporter, Imprimer...)
              </div>
            )}

            {activeRibbonTab === 'Accueil' && (
              <>
                {/* Groupe : Presse-papiers */}
                <div className="flex gap-1 border-r pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[50px] opacity-40 cursor-not-allowed">
                    <Clipboard className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Coller</span>
                  </button>
                  <div className="flex flex-col justify-center gap-1">
                    <button className="flex items-center gap-1 px-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                      <Scissors className="w-3 h-3" /> Couper
                    </button>
                    <button className="flex items-center gap-1 px-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                      <Copy className="w-3 h-3" /> Copier
                    </button>
                    <button className="flex items-center gap-1 px-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                      <Paintbrush className="w-3 h-3" /> Reproduire
                    </button>
                  </div>
                </div>

                {/* Groupe : Données */}
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={() => setIsAddDataOpen(true)} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <DatabaseZap className="w-6 h-6 text-yellow-600" />
                    <span className="text-[10px] leading-tight text-center text-foreground font-medium">Obtenir<br/>les données</span>
                  </button>
                  <button onClick={() => setIsAddDataOpen(true)} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Classeur<br/>Excel</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Database className="w-6 h-6 text-blue-600" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Hub de<br/>données</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <TableProperties className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Entrer les<br/>données</span>
                  </button>
                </div>

                {/* Groupe : Requêtes */}
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={() => setIsPowerQueryOpen(true)} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] bg-orange-50 hover:bg-orange-100 border border-orange-200">
                    <FileEdit className="w-6 h-6 text-orange-600" />
                    <span className="text-[10px] leading-tight text-center text-orange-700 font-bold">Transformer<br/>les données</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <RefreshCw className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Actualiser</span>
                  </button>
                </div>

                {/* Groupe : Insérer */}
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={addWidgetToStudio} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <BarChart3 className="w-6 h-6 text-blue-600" />
                    <span className="text-[10px] leading-tight text-center text-foreground font-medium">Nouveau<br/>visuel</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Type className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Zone de<br/>texte</span>
                  </button>
                </div>

                {/* Groupe : Calculs */}
                <div className="flex gap-1 border-r pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Calculator className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Nouvelle<br/>mesure</span>
                  </button>
                </div>

                {/* Groupe : Partager */}
                <div className="flex gap-1 pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <UploadCloud className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Publier</span>
                  </button>
                </div>
              </>
            )}

            {activeRibbonTab === 'Insérer' && (
              <>
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={handleAddNewTab} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <Plus className="w-6 h-6 text-emerald-600" />
                    <span className="text-[10px] leading-tight text-center text-foreground font-medium">Nouvelle<br/>page</span>
                  </button>
                </div>
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={addWidgetToStudio} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <PieChartIcon className="w-6 h-6 text-primary" />
                    <span className="text-[10px] leading-tight text-center text-foreground font-medium">Nouveaux<br/>visuels</span>
                  </button>
                </div>
                <div className="flex gap-1 border-r pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Type className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Zone de<br/>texte</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <MousePointerClick className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Boutons</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Shapes className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Formes</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Images</span>
                  </button>
                </div>
              </>
            )}

            {activeRibbonTab === 'Modélisation' && (
              <>
                <div className="flex gap-1 border-r pr-4">
                  <button onClick={() => setIsAppendOpen(true)} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                    <Combine className="w-6 h-6 text-purple-600" />
                    <span className="text-[10px] leading-tight text-center text-foreground font-medium">Gérer les<br/>relations</span>
                  </button>
                </div>
                <div className="flex gap-1 border-r pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Calculator className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Nouvelle<br/>mesure</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Sigma className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Nouvelle<br/>colonne</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <TableProperties className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Nouvelle<br/>table</span>
                  </button>
                </div>
              </>
            )}

            {activeRibbonTab === 'Affichage' && (
              <>
                <div className="flex gap-1 border-r pr-4">
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Palette className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Thèmes</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                    <Maximize className="w-6 h-6 text-muted-foreground" />
                    <span className="text-[10px] leading-tight text-center text-muted-foreground">Vue Page</span>
                  </button>
                </div>
              </>
            )}

            {(activeRibbonTab === 'Optimiser' || activeRibbonTab === 'Aide') && (
              <div className="flex items-center text-xs text-muted-foreground px-4 italic">
                Options spécifiques à venir...
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* =================================================================== */}
        {/* ZONE GAUCHE : LE CANVAS ET LES ONGLETS EN BAS                       */}
        {/* =================================================================== */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#f3f2f1] dark:bg-slate-900/50">

          {/* PANNEAU 1 : CANVAS DES WIDGETS */}
          <div className="flex-1 overflow-auto p-6 transition-all" onClick={() => setActiveWidgetId(null)}>
            {visibleWidgets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                <LayoutDashboard className="w-16 h-16 mb-4" />
                <p>Cette page est vide.</p>
                <p className="text-sm mt-2">Cliquez sur "Nouveau visuel" dans le ruban en haut.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {visibleWidgets.map(widget => (
                  <Card
                    key={widget.id}
                    onClick={(e) => { e.stopPropagation(); setActiveWidgetId(widget.id); }}
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

          {/* BARRE DES ONGLETS (TABS) PLACÉE TOUT EN BAS AVEC MENU DROPDOWN */}
          <div className="flex items-center gap-1 px-4 bg-background border-t shadow-sm z-10 overflow-x-auto h-12 shrink-0 custom-scrollbar">
            {activeRisk?.tabs?.map(tab => (
              <div
                key={tab.id}
                onClick={() => { setActiveTabId(tab.id); setActiveWidgetId(null); }}
                className={`flex items-center px-4 h-full border-t-2 cursor-pointer transition-colors whitespace-nowrap group ${activeTabId === tab.id ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
              >
                {editingTabId === tab.id ? (
                  <Input
                    value={editingTabName}
                    onChange={e => setEditingTabName(e.target.value)}
                    onBlur={() => { handleRenameTab(tab.id, editingTabName); setEditingTabId(null); }}
                    onKeyDown={e => { if(e.key === 'Enter') { handleRenameTab(tab.id, editingTabName); setEditingTabId(null); } }}
                    autoFocus
                    className="h-7 text-sm w-32 font-bold px-2 py-0 border-primary"
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingTabId(tab.id); setEditingTabName(tab.name); }}
                    className="font-bold text-sm select-none mr-1"
                    title="Double-cliquez pour renommer"
                  >
                    {tab.name}
                  </span>
                )}

                {/* MENU DÉROULANT (TROIS POINTS) SUR L'ONGLET ACTIF */}
                {activeTabId === tab.id && editingTabId !== tab.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors ml-1 shrink-0 outline-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); handleMoveTab(tab.id, 'left'); }}
                        disabled={activeRisk.tabs?.findIndex(t => t.id === tab.id) === 0}
                        className="text-xs cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5 mr-2" /> Déplacer à gauche
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); handleMoveTab(tab.id, 'right'); }}
                        disabled={activeRisk.tabs?.findIndex(t => t.id === tab.id) === (activeRisk.tabs?.length || 1) - 1}
                        className="text-xs cursor-pointer"
                      >
                        <ChevronRightIcon className="w-3.5 h-3.5 mr-2" /> Déplacer à droite
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); handleDuplicateTab(tab.id); }}
                        className="text-xs cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 mr-2" /> Dupliquer la page
                      </DropdownMenuItem>

                      {activeRisk.tabs!.length > 1 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                            className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
            <div className="px-2 border-l ml-2 pl-4">
              <Button variant="ghost" size="sm" onClick={handleAddNewTab} className="h-8 px-2 text-muted-foreground hover:text-primary">
                <Plus className="w-4 h-4 mr-1"/> Page
              </Button>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* ZONE DROITE : PANNEAUX LATÉRAUX                                     */}
        {/* =================================================================== */}

        {/* PANNEAU 2 : FILTRES */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-lg transition-all duration-300 overflow-hidden ${isFiltersOpen ? 'w-64' : 'w-10'}`}>
          <div className="p-3 border-b bg-secondary/30 flex items-center justify-between min-w-0">
            <div onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="flex items-center gap-2 truncate cursor-pointer hover:text-primary transition-colors flex-1">
              <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
              {isFiltersOpen && <h3 className="font-bold text-xs uppercase tracking-wider truncate">Filtres</h3>}
            </div>
            {isFiltersOpen ? (
              <button onClick={() => setIsFiltersOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground shrink-0">
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsFiltersOpen(true)} />
            )}
          </div>

          <div className={`flex-1 overflow-y-auto p-3 ${!isFiltersOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un indicateur.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between min-w-0">
                  <h4 className="text-[10px] font-black uppercase text-primary truncate">Sur cet indicateur</h4>
                  <Button variant="ghost" size="sm" onClick={addFilter} className="h-6 px-1 text-[10px] text-primary shrink-0">
                    <Plus className="w-3 h-3 mr-1"/> Ajouter
                  </Button>
                </div>

                {(!activeWidget.filters || activeWidget.filters.length === 0) && (
                  <div className="p-3 text-center border border-dashed rounded bg-muted/20 text-[10px] text-muted-foreground">Aucun filtre actif.</div>
                )}

                <div className="space-y-3">
                  {activeWidget.filters?.map(f => (
                    <div key={f.id} className="p-2 border border-primary/20 bg-primary/5 rounded relative group flex flex-col gap-2 shadow-sm min-w-0">
                      <button onClick={() => removeFilter(f.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <select value={f.column} onChange={e => updateFilter(f.id, { column: e.target.value, value: '' })} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background truncate">
                        <option value="">Donnée...</option>
                        {activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={f.operator} onChange={e => updateFilter(f.id, { operator: e.target.value as FilterOperator })} className="w-full h-7 rounded border px-1 text-[10px] text-muted-foreground bg-background truncate">
                        <option value="eq">Égal à</option>
                        <option value="neq">Différent de</option>
                        <option value="contains">Contient</option>
                        <option value="gt">Supérieur à</option>
                        <option value="lt">Inférieur à</option>
                        <option value="last_n_days">Derniers X jours</option>
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
            {isVisOpen ? (
              <button onClick={() => setIsVisOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground shrink-0">
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsVisOpen(true)} />
            )}
          </div>

          <div className={`flex-1 overflow-y-auto p-4 ${!isVisOpen && 'hidden'}`}>
            {!activeWidget ? (
              <div className="text-center py-8 text-muted-foreground opacity-50 text-xs">Sélectionnez un indicateur pour configurer ses axes.</div>
            ) : (
              <div className="space-y-4 animate-in fade-in">

                <div className="space-y-2 flex flex-col min-w-0">
                  <div className="flex justify-between items-center min-w-0 gap-2">
                    <Input value={activeWidget.title} onChange={e => updateActiveWidget({ title: e.target.value })} className="h-8 text-xs font-bold w-full truncate" />
                    <button onClick={() => setWidgetToDelete(activeWidget.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded shrink-0">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 border-b pb-4">
                    <button onClick={() => updateActiveWidget({ type: 'bar' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'bar' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`}>
                      <BarChart3 className="w-4 h-4"/>
                    </button>
                    <button onClick={() => updateActiveWidget({ type: 'area' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'area' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`}>
                      <LineChartIcon className="w-4 h-4"/>
                    </button>
                    <button onClick={() => updateActiveWidget({ type: 'pie' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'pie' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`}>
                      <PieChartIcon className="w-4 h-4"/>
                    </button>
                    <button onClick={() => updateActiveWidget({ type: 'kpi' })} className={`p-2 flex items-center justify-center rounded border transition-colors ${activeWidget.type === 'kpi' ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted text-muted-foreground'}`}>
                      <Hash className="w-4 h-4"/>
                    </button>
                  </div>
                </div>

                <div className="space-y-1 flex flex-col min-w-0">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">Source de données</Label>
                  <select value={activeWidget.datasetId} onChange={e => updateActiveWidget({ datasetId: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-muted/30 truncate">
                    {activeRisk?.datasets.filter(d => !d.isHidden || d.id === activeWidget.datasetId).map(d => (
                      <option key={d.id} value={d.id}>{d.name} {d.isHidden ? '(Masqué)' : ''}</option>
                    ))}
                  </select>
                </div>

                {activeWidget.type !== 'kpi' && (
                  <div onDragOver={e => e.preventDefault()} onDrop={handleDropOnX} className="p-3 border rounded bg-secondary/10 flex flex-col gap-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors min-w-0">
                    <div className="flex items-center justify-between min-w-0 gap-2">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">{activeWidget.type === 'pie' ? 'Catégorie de découpage' : 'Axe d\'analyse (X)'}</Label>
                      {activeWidget.type === 'pie' && activeWidget.xAxisCol && (
                        <button onClick={() => updateActiveWidget({ xAxisCol: "" })} className="text-[10px] text-rose-500 font-bold hover:underline shrink-0">Vider</button>
                      )}
                    </div>
                    <select value={activeWidget.xAxisCol || ''} onChange={e => updateActiveWidget({ xAxisCol: e.target.value })} className="w-full h-8 rounded border px-2 text-xs bg-background truncate">
                      <option value="">Sélectionner...</option>
                      {activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {activeWidget.xAxisCol && (
                      <div className="flex flex-col gap-1 pt-1 border-t border-muted-foreground/10 min-w-0">
                        <Label className="text-[9px] uppercase font-bold text-primary flex items-center gap-1 truncate">
                          <Calendar className="w-3 h-3 shrink-0"/> Format Date
                        </Label>
                        <select value={activeWidget.dateGrouping || 'none'} onChange={e => updateActiveWidget({ dateGrouping: e.target.value as DateGrouping })} className="w-full h-7 rounded border border-primary/20 px-1 text-[10px] bg-primary/5 text-primary truncate">
                          <option value="none">Ne pas regrouper</option>
                          <option value="day">Jour</option>
                          <option value="week">Semaine</option>
                          <option value="month">Mois</option>
                          <option value="quarter">Trimestre</option>
                          <option value="year">Année</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <div onDragOver={e => e.preventDefault()} onDrop={handleDropOnY} className="p-3 border rounded bg-secondary/10 flex flex-col gap-3 shadow-sm border-dashed hover:bg-primary/5 transition-colors min-w-0">
                  <div className="flex items-center justify-between min-w-0 gap-2">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground truncate">{activeWidget.type === 'pie' ? 'Données évaluées' : activeWidget.type === 'kpi' ? 'Valeur du KPI' : 'Mesure de l\'Axe Y'}</Label>
                    <button onClick={addSeries} className="text-[10px] text-primary font-bold hover:underline shrink-0">+ Ajouter</button>
                  </div>

                  {activeWidget.series.length === 0 && <div className="text-[10px] text-muted-foreground italic text-center w-full">Déposez vos données ici.</div>}

                  {activeWidget.series.map((s) => (
                    <div key={s.id} className="p-2 bg-background border rounded flex flex-col gap-2 relative group min-w-0">
                      <button onClick={() => removeSeries(s.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <select value={s.yAxisCol} onChange={e => { const val = e.target.value; const isMeas = activeRisk?.measures.some(m => m.name === val); updateSeries(s.id, { yAxisCol: val, isMeasure: isMeas }); }} className="w-full h-7 rounded border px-1 text-xs font-bold bg-background truncate">
                        <option value="">Sélectionner...</option>
                        {activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).length! > 0 && (
                          <optgroup label="✨ Règles d'analyse personnalisées">
                            {activeRisk?.measures.filter(m => m.datasetId === activeWidget.datasetId).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Données sources">
                          {activeDataset?.columns.map(c => <option key={c} value={c}>{c}</option>)}
                        </optgroup>
                      </select>

                      {!s.isMeasure && (
                        <select value={s.aggregation} onChange={e => updateSeries(s.id, { aggregation: e.target.value as AggregationType })} className="w-full h-7 rounded border px-1 text-[10px] bg-secondary/30 text-muted-foreground truncate">
                          <option value="SUM">Faire la Somme</option>
                          <option value="AVERAGE">Calculer la Moyenne</option>
                          <option value="COUNT">Compter le nombre</option>
                          <option value="MAX">Valeur Maximum</option>
                          <option value="MIN">Valeur Minimum</option>
                          <option value="DISTINCTCOUNT">Valeurs Uniques</option>
                        </select>
                      )}

                      <div className="flex items-center gap-1 mt-1">
                        <Edit2 className="w-3 h-3 text-muted-foreground shrink-0"/>
                        <Input value={s.alias || ''} onChange={e => updateSeries(s.id, { alias: e.target.value })} placeholder="Renommer l'étiquette..." className="h-6 text-[10px] bg-background w-full placeholder:italic"/>
                      </div>

                      {!(activeWidget.type === 'pie' && activeWidget.xAxisCol) && (
                        <div className="flex gap-1 overflow-x-auto pb-1 pt-1">
                          {COLORS.map(c => <button key={c} onClick={() => updateSeries(s.id, { color: c })} className={`w-4 h-4 shrink-0 rounded-full ${s.color === c ? 'ring-2 ring-primary ring-offset-1' : ''}`} style={{backgroundColor: c}}/>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t flex flex-col gap-3 min-w-0">
                  <h4 className="text-[10px] font-black uppercase text-primary flex items-center gap-1 truncate"><Palette className="w-3 h-3 shrink-0"/> Options de Rendu</h4>

                  {activeWidget.type === 'bar' && (
                    <div className="flex flex-col gap-1 min-w-0">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><AlignLeft className="w-3 h-3 shrink-0"/> Orientation</Label>
                      <select value={activeWidget.orientation || 'vertical'} onChange={e => updateActiveWidget({ orientation: e.target.value as ChartOrientation })} className="w-full h-7 rounded border px-1 text-xs bg-background truncate">
                        <option value="vertical">Colonnes (Verticales)</option>
                        <option value="horizontal">Barres (Horizontales)</option>
                      </select>
                    </div>
                  )}

                  {activeWidget.type !== 'kpi' && (
                    <div className="flex items-center justify-between min-w-0 gap-2">
                      <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><Tag className="w-3 h-3 shrink-0"/> Valeurs sur le graphique</Label>
                      <input type="checkbox" checked={activeWidget.showLabels !== false} onChange={(e) => updateActiveWidget({ showLabels: e.target.checked })} className="w-4 h-4 accent-primary shrink-0" />
                    </div>
                  )}

                  <div className="flex flex-col gap-1 min-w-0">
                    <Label className="text-xs flex items-center gap-1 text-muted-foreground truncate"><Maximize className="w-3 h-3 shrink-0"/> Taille du panneau</Label>
                    <select value={activeWidget.widgetSize || 'medium'} onChange={e => updateActiveWidget({ widgetSize: e.target.value as WidgetSize })} className="w-full h-7 rounded border px-1 text-xs bg-background truncate">
                      <option value="small">Tiers de page</option>
                      <option value="medium">Deux Tiers</option>
                      <option value="large">Pleine page</option>
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

        {/* PANNEAU 4 : DONNÉES ET CORBEILLE */}
        <div className={`border-l bg-background flex flex-col shrink-0 z-20 shadow-2xl transition-all duration-300 overflow-hidden ${isDataOpen ? 'w-64' : 'w-10'}`}>
          <div className="p-3 border-b bg-secondary/30 flex items-center justify-between min-w-0">
            <div onClick={() => setIsDataOpen(!isDataOpen)} className="flex items-center gap-2 truncate cursor-pointer hover:text-primary transition-colors flex-1">
              <Database className="w-4 h-4 text-muted-foreground shrink-0" />
              {isDataOpen && <h3 className="font-bold text-xs uppercase tracking-wider truncate">Données</h3>}
            </div>
            {isDataOpen ? (
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setIsAppendOpen(true)} className="h-6 px-1.5 text-primary hover:bg-primary/10" title="Fusionner (Append)">
                  <Combine className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsAddDataOpen(true)} className="h-6 px-1.5 text-primary hover:bg-primary/10" title="Ajouter une source">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
                <button onClick={() => setIsDataOpen(false)} className="p-1 hover:bg-secondary rounded text-muted-foreground">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 cursor-pointer" onClick={() => setIsDataOpen(true)} />
            )}
          </div>

          <div className={`flex-1 overflow-y-auto p-2 ${!isDataOpen && 'hidden'}`}>

            {/* 1. LISTE DES TABLES VISIBLES */}
            {activeRisk?.datasets.filter(ds => !ds.isHidden).map(ds => renderDatasetItem(ds, false))}

            {/* 2. BOUTON CORBEILLE */}
            {activeRisk && activeRisk.datasets.some(ds => ds.isHidden) && (
              <div className="mt-4 pt-2 border-t border-dashed">
                <Button variant="ghost" className="w-full h-8 text-[10px] uppercase font-bold tracking-wider text-muted-foreground hover:bg-muted/50" onClick={() => setShowHiddenDatasets(!showHiddenDatasets)}>
                  {showHiddenDatasets ? <EyeOff className="w-3 h-3 mr-2" /> : <Eye className="w-3 h-3 mr-2" />}
                  {showHiddenDatasets ? "Masquer les tables retirées" : `Voir ${activeRisk.datasets.filter(d => d.isHidden).length} table(s) retirée(s)`}
                </Button>
              </div>
            )}

            {/* 3. LISTE DES TABLES MASQUÉES */}
            {showHiddenDatasets && (
              <div className="mt-2 pl-2 border-l-2 border-muted">
                {activeRisk?.datasets.filter(ds => ds.isHidden).map(ds => renderDatasetItem(ds, true))}
              </div>
            )}

          </div>
        </div>

        {/* =================================================================== */}
        {/* ÉDITEUR POWER QUERY (POP-UP PLEIN ÉCRAN)                            */}
        {/* =================================================================== */}
        <Dialog open={isPowerQueryOpen} onOpenChange={setIsPowerQueryOpen}>
          <DialogContent className="max-w-[98vw] h-[95vh] p-0 overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-900 rounded-lg">

            {/* CORRECTION ACCESSIBILITÉ : DialogTitle masqué nativement avec Tailwind "sr-only" */}
            <DialogTitle className="sr-only">Éditeur Power Query</DialogTitle>

            {/* Header de la fenêtre */}
            <div className="bg-[#f3f2f1] dark:bg-slate-800 border-b flex items-center justify-between px-3 py-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-semibold">Éditeur Power Query</span>
              </div>
              <button onClick={() => setIsPowerQueryOpen(false)} className="p-1 hover:bg-rose-500 hover:text-white rounded transition-colors text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Ruban Power Query */}
            <div className="flex flex-col bg-background shadow-sm border-b shrink-0">
              <div className="flex items-end px-2 pt-2 text-sm bg-muted/20">
                <div className="flex gap-1">
                  {['Accueil', 'Transformer', 'Ajouter une colonne', 'Affichage'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setPqRibbonTab(tab)}
                      className={`px-4 py-1.5 rounded-t-md transition-colors border-b-2 -mb-[1px] ${
                        pqRibbonTab === tab
                          ? 'border-primary text-primary bg-background font-bold shadow-[0_-2px_5px_rgba(0,0,0,0.02)]'
                          : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center px-2 py-2 gap-4 bg-background min-h-[85px] overflow-x-auto">
                {pqRibbonTab === 'Accueil' && (
                  <div className="flex gap-1 border-r pr-4">
                    <button onClick={() => setIsPowerQueryOpen(false)} className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px]">
                      {/* CORRECTION ICÔNE : On utilise bien l'icône Save importée */}
                      <Save className="w-6 h-6 text-emerald-600" />
                      <span className="text-[10px] leading-tight text-center text-foreground font-medium">Fermer et<br/>appliquer</span>
                    </button>
                  </div>
                )}

                {pqRibbonTab === 'Transformer' && (
                  <>
                    <div className="flex gap-1 border-r pr-4">
                      <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                        <Columns className="w-6 h-6 text-blue-600" />
                        <span className="text-[10px] leading-tight text-center text-foreground font-medium">Fractionner<br/>la colonne</span>
                      </button>
                      <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                        <Table2 className="w-6 h-6 text-emerald-600" />
                        <span className="text-[10px] leading-tight text-center text-foreground font-medium">Regrouper<br/>par</span>
                      </button>
                    </div>

                    <div className="flex flex-col gap-1 border-r pr-4 justify-center">
                      <button className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                        <Type className="w-4 h-4 text-blue-500" /> Type de données : Texte
                      </button>

                      {/* BOUTON ACTIF : Promouvoir les en-têtes */}
                      <button
                        onClick={executePromoteHeaders}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-emerald-50 text-emerald-700 font-medium rounded text-[10px] transition-colors"
                      >
                        <ArrowUpToLine className="w-4 h-4 text-emerald-500" /> Utiliser la première ligne pour les en-têtes
                      </button>

                      {/* BOUTON ACTIF : Remplacer les valeurs */}
                      <button
                        onClick={openReplaceValues}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-yellow-50 text-yellow-700 font-medium rounded text-[10px] transition-colors"
                      >
                        <Replace className="w-4 h-4 text-yellow-600" /> Remplacer les valeurs
                      </button>
                    </div>
                  </>
                )}

                {pqRibbonTab === 'Ajouter une colonne' && (
                  <>
                    <div className="flex gap-1 border-r pr-4">
                      <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                        <Wand2 className="w-6 h-6 text-yellow-600" />
                        <span className="text-[10px] leading-tight text-center text-foreground font-medium">Colonne à partir<br/>d'exemples</span>
                      </button>
                      <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                        <Braces className="w-6 h-6 text-yellow-600" />
                        <span className="text-[10px] leading-tight text-center text-foreground font-medium">Colonne<br/>personnalisée</span>
                      </button>
                      <button className="flex flex-col items-center justify-center p-2 hover:bg-muted rounded-md gap-1.5 min-w-[72px] opacity-40 cursor-not-allowed">
                        <FunctionSquare className="w-6 h-6 text-blue-600" />
                        <span className="text-[10px] leading-tight text-center text-foreground font-medium">Appeler une fonction<br/>personnalisée</span>
                      </button>
                    </div>
                    <div className="flex flex-col gap-1 border-r pr-4 justify-center">
                      <button className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                        <Waypoints className="w-4 h-4 text-emerald-500" /> Colonne conditionnelle
                      </button>
                      <button className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                        <ListOrdered className="w-4 h-4 text-blue-500" /> Colonne d'index
                      </button>
                      <button className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded opacity-40 cursor-not-allowed text-[10px]">
                        <Copy className="w-4 h-4 text-muted-foreground" /> Duplication de la colonne
                      </button>
                    </div>
                  </>
                )}

                {pqRibbonTab === 'Affichage' && (
                  <div className="flex items-center text-xs text-muted-foreground px-4 italic">
                    Paramètres d'affichage (Qualité des colonnes, Distribution, Profil...)
                  </div>
                )}
              </div>
            </div>

            {/* Corps de l'éditeur */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* Barre latérale gauche (Requêtes) */}
              <div className="w-48 border-r bg-background flex flex-col">
                <div className="bg-secondary/30 p-2 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Requêtes</div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {activeRisk?.datasets.map(d => (
                    <div
                      key={d.id}
                      onClick={() => { setPqSelectedDatasetId(d.id); setPqSelectedColumn(null); }}
                      className={`text-xs p-2 rounded cursor-pointer truncate flex items-center gap-2 ${pqSelectedDatasetId === d.id ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-muted text-muted-foreground'}`}
                    >
                      <Table2 className="w-3.5 h-3.5 shrink-0" />
                      {d.name}
                    </div>
                  ))}
                </div>
              </div>

              {/* Zone principale (Aperçu des données calculé en direct) */}
              <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
                <div className="bg-muted/10 p-2 border-b text-xs flex items-center justify-between text-muted-foreground">
                  <div className="flex items-center gap-2"><DatabaseZap className="w-3.5 h-3.5" /> Aperçu des données transformées</div>
                  {pqSelectedColumn && <Badge variant="secondary" className="bg-primary/10 text-primary">Colonne sélectionnée : {pqSelectedColumn}</Badge>}
                </div>

                <div className="flex-1 overflow-auto bg-[#f3f2f1] dark:bg-slate-900 p-4">
                  {pqSelectedDatasetId && pqSelectedDatasetObj ? (
                    <div className="bg-white border rounded shadow-sm overflow-auto max-h-full">
                      <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                        <thead className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="p-2 border-b border-r bg-muted/50 w-8 text-center text-muted-foreground">#</th>
                            {pqPreview.columns.map(col => (
                              <th
                                key={col}
                                onClick={() => setPqSelectedColumn(col)}
                                className={`p-2 border-b border-r font-semibold cursor-pointer transition-colors ${pqSelectedColumn === col ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-muted/80'}`}
                              >
                                <div className="flex items-center gap-1"><Type className="w-3 h-3 text-muted-foreground" /> {col}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pqPreview.data.slice(0, 100).map((row, i) => (
                            <tr key={i} className="hover:bg-muted/30">
                              <td className="p-2 border-b border-r bg-muted/10 text-center text-muted-foreground font-mono">{i + 1}</td>
                              {pqPreview.columns.map(col => (
                                <td
                                  key={col}
                                  onClick={() => setPqSelectedColumn(col)}
                                  className={`p-2 border-b border-r truncate max-w-[200px] cursor-pointer ${pqSelectedColumn === col ? 'bg-primary/5 text-primary font-medium' : 'text-muted-foreground'}`}
                                  title={String(row[col] || '')}
                                >
                                  {String(row[col] || '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                      <FileJson className="w-12 h-12 mb-2" />
                      <p>Sélectionnez une requête à gauche pour l'analyser.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Barre latérale droite (Étapes Appliquées Dynamiques) */}
              <div className="w-64 border-l bg-background flex flex-col">
                <div className="bg-secondary/30 p-2 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paramètres d'une requête</div>

                <div className="p-3 border-b">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Nom</Label>
                  <Input value={pqSelectedDatasetObj?.name || ""} disabled className="h-7 text-xs font-bold mt-1 bg-muted/30" />
                </div>

                <div className="bg-secondary/10 p-2 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Étapes appliquées</div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <div className="text-xs p-2 bg-muted/20 rounded border flex items-center justify-between text-muted-foreground">
                    <span>Source initiale</span>
                  </div>

                  {pqSelectedDatasetObj?.transformations?.map((step, idx) => (
                    <div key={step.id} className="text-xs p-2 bg-white rounded border flex items-center justify-between group shadow-sm">
                      <span className="truncate pr-2 font-medium">{step.name}</span>
                      <button onClick={() => handleRemoveTransformation(step.id)} className="opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-50 p-1 rounded transition-all">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal de remplacement de valeurs imbriqué */}
            {isReplaceModalOpen && (
              <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                <div className="bg-background rounded-xl shadow-2xl w-[400px] border overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                    <Replace className="w-4 h-4 text-yellow-600" />
                    <h3 className="font-bold text-sm">Remplacer les valeurs</h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Valeur à rechercher</Label>
                      <Input value={replaceSearchValue} onChange={e => setReplaceSearchValue(e.target.value)} autoFocus placeholder="Ex: NULL, vide, ou texte spécifique..." className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Remplacer par</Label>
                      <Input value={replaceNewValue} onChange={e => setReplaceNewValue(e.target.value)} placeholder="Nouvelle valeur..." className="text-sm" />
                    </div>
                  </div>
                  <div className="px-4 py-3 bg-muted/30 border-t flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIsReplaceModalOpen(false)}>Annuler</Button>
                    <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700 text-white" onClick={executeReplaceValues}>OK</Button>
                  </div>
                </div>
              </div>
            )}

          </DialogContent>
        </Dialog>

        {/* MODALES D'IMPORT DE DONNÉES */}
        <Dialog open={isAddDataOpen} onOpenChange={(o) => { setIsAddDataOpen(o); if(!o) resetWizard(); }}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Ajouter des sources au modèle</DialogTitle></DialogHeader>
            {wizardStep === 1 && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-primary font-bold">Fichier source (.xlsx, .csv)</Label>
                  {isImporting ? (
                    <div className="border-2 border-dashed rounded-xl p-8 text-center bg-muted/10">
                      <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                    </div>
                  ) : (
                    <div className="relative">
                      <input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      <Button variant="outline" className="w-full h-24 border-dashed border-2 flex-col gap-2">
                        <FileSpreadsheet className="w-6 h-6" /><span>Sélectionner le fichier</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {wizardStep === 2 && (
              <div className="space-y-6 py-4">
                <div className="max-h-[200px] overflow-y-auto space-y-2 border p-2 rounded-md">
                  {availableSheets.map(sheet => (
                    <div key={sheet.id} onClick={() => toggleSheetSelection(sheet.id)} className={`flex justify-between p-3 rounded border cursor-pointer ${selectedSheets.includes(sheet.id) ? 'bg-primary/5 border-primary shadow-sm' : 'hover:bg-muted'}`}>
                      <div className="flex items-center gap-3">
                        <CheckSquare className={`w-5 h-5 ${selectedSheets.includes(sheet.id) ? 'text-primary' : 'opacity-30'}`} />
                        <p className="font-bold text-sm">{sheet.name}</p>
                      </div>
                      <Badge variant="secondary">{sheet.data.length} entrées</Badge>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">Retour</Button>
                  <Button onClick={finalizeAddData} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={selectedSheets.length === 0}>Ajouter</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isAppendOpen} onOpenChange={(o) => { setIsAppendOpen(o); if(!o) { setAppendSource1(""); setAppendSource2(""); setAppendNewName(""); }}}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Combine className="w-5 h-5 text-primary" /> Fusionner des tables</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Première table</Label>
                <select value={appendSource1} onChange={e => setAppendSource1(e.target.value)} className="w-full h-10 rounded border px-3 text-sm bg-background">
                  <option value="">Sélectionner...</option>
                  {activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name} {d.isHidden ? '(Masqué)' : ''}</option>)}
                </select>
              </div>
              <div className="flex justify-center"><Plus className="w-4 h-4 text-muted-foreground" /></div>
              <div className="space-y-2">
                <Label>Table à empiler</Label>
                <select value={appendSource2} onChange={e => setAppendSource2(e.target.value)} className="w-full h-10 rounded border px-3 text-sm bg-background">
                  <option value="">Sélectionner...</option>
                  {activeRisk?.datasets.map(d => <option key={d.id} value={d.id}>{d.name} {d.isHidden ? '(Masqué)' : ''}</option>)}
                </select>
              </div>
              <div className="space-y-2 pt-4 border-t">
                <Label className="text-primary font-bold">Nom de la table fusionnée</Label>
                <Input value={appendNewName} onChange={e => setAppendNewName(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAppendOpen(false)}>Annuler</Button>
              <Button onClick={handleAppendDatasets} disabled={!appendSource1 || !appendSource2 || !appendNewName}>Fusionner</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!widgetToDelete} onOpenChange={(open) => !open && setWidgetToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Supprimer cet indicateur ?</AlertDialogTitle></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={confirmDeleteWidget}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!datasetToDelete} onOpenChange={(open) => !open && setDatasetToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Retirer cette source ?</AlertDialogTitle></AlertDialogHeader>
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