import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { KpiDefinition, CATEGORY_COLORS, DATA_SOURCE_LABELS, DATA_SOURCE_COLORS } from "@/types/kpi";
import { TrendingUp, TrendingDown, Minus, Search, Upload, FileSpreadsheet, Keyboard } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import KpiDetailDialog from "./KpiDetailDialog";
import FileUploadDialog from "../data-sources/FileUploadDialog";

interface KpiCardProps {
  kpi: KpiDefinition;
}

export default function KpiCard({ kpi }: KpiCardProps) {
  const { getLatestValue, getPreviousValue, getEntriesForKpi } = useKpi();
  const [detailOpen, setDetailOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const value = getLatestValue(kpi.id);
  const prev = getPreviousValue(kpi.id);
  const allEntries = getEntriesForKpi(kpi.id);
  const sparkData = allEntries.slice(-6).map((e) => ({ v: e.value }));
  const latestEntry = allEntries.length > 0 ? allEntries[allEntries.length - 1] : null;

  const trend = value !== undefined && prev !== undefined ? value - prev : 0;
  const trendPercent = prev ? Math.round((trend / prev) * 100) : 0;

  const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";
  const displayValue = value !== undefined ? (isPercentage ? `${value}%` : value.toLocaleString("fr-FR")) : "—";

  let statusClass = "";
  if (kpi.thresholdDanger !== undefined && value !== undefined) {
    if (isPercentage ? value <= kpi.thresholdDanger : value >= kpi.thresholdDanger) statusClass = "danger";
    else if (kpi.thresholdWarning !== undefined && (isPercentage ? value <= kpi.thresholdWarning : value >= kpi.thresholdWarning)) statusClass = "warning";
    else statusClass = "success";
  }

  const categoryColor = CATEGORY_COLORS[kpi.category];
  const trendColor = trend > 0 ? "hsl(152 60% 45%)" : trend < 0 ? "hsl(0 72% 55%)" : categoryColor;

  // Determine source type for badge
  const sourceType = latestEntry?.source?.type;
  const isFileSource = sourceType === "excel" || sourceType === "csv";
  const isManualSource = !sourceType || sourceType === "manual";

  // Current period
  const currentPeriod = latestEntry?.period || new Date().toISOString().slice(0, 7);

  return (
    <>
      <div
        className="kpi-card animate-slide-up group cursor-pointer relative"
        onClick={() => setDetailOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setDetailOpen(true)}
      >
        {/* Action buttons */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setUploadOpen(true);
            }}
            className="p-1.5 rounded-md hover:bg-primary/10 transition-colors"
            title="Ajouter une source (fichier)"
          >
            <Upload className="w-3.5 h-3.5 text-primary" />
          </button>
          <Search className="w-3.5 h-3.5 text-primary" />
        </div>

        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} />
            <span className="text-xs text-muted-foreground font-medium truncate">{kpi.name}</span>
          </div>
          {statusClass && (
            <span className={`status-badge ${statusClass} shrink-0`}>
              {statusClass === "danger" ? "Critique" : statusClass === "warning" ? "Attention" : "OK"}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="kpi-value mb-1">{displayValue}</div>
            {trend !== 0 ? (
              <div className="flex items-center gap-1 text-xs">
                {trend > 0 ? <TrendingUp className="w-3 h-3 text-success" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
                <span className={trend > 0 ? "text-success" : "text-destructive"}>
                  {trend > 0 ? "+" : ""}{trendPercent}%
                </span>
              </div>
            ) : value !== undefined ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="w-3 h-3" /> Stable
              </div>
            ) : null}
          </div>

          {sparkData.length > 2 && (
            <div className="w-20 h-10 opacity-60 group-hover:opacity-100 transition-opacity">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                  <defs>
                    <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={trendColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={trendColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={trendColor} fill={`url(#spark-${kpi.id})`} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Source badge with type distinction */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isManualSource ? (
              <>
                <Keyboard className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Saisie manuelle</span>
              </>
            ) : latestEntry?.source ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DATA_SOURCE_COLORS[latestEntry.source.type] }} />
                <span className="text-[10px] text-muted-foreground">{DATA_SOURCE_LABELS[latestEntry.source.type]}</span>
                {isFileSource && latestEntry.source.fileName && (
                  <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px]">
                    — {latestEntry.source.fileName}
                  </span>
                )}
              </>
            ) : null}
          </div>
          {isFileSource && (
            <FileSpreadsheet className="w-3 h-3 text-success/60" />
          )}
        </div>

        {kpi.target && isPercentage && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>Obj. {kpi.target}%</span>
              <span>{value ?? 0}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(((value ?? 0) / kpi.target) * 100, 100)}%`,
                  background: `var(--gradient-primary)`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <KpiDetailDialog kpi={kpi} open={detailOpen} onClose={() => setDetailOpen(false)} />
      <FileUploadDialog kpi={kpi} open={uploadOpen} onClose={() => setUploadOpen(false)} period={currentPeriod} />
    </>
  );
}
