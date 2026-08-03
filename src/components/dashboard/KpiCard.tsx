import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { KpiDefinition, CATEGORY_COLORS, DATA_SOURCE_LABELS, DATA_SOURCE_COLORS } from "@/types/kpi";
import { TrendingUp, TrendingDown, Minus, Search, Upload, FileSpreadsheet, Keyboard } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import KpiDetailDialog from "./KpiDetailDialog";
import FileUploadDialog from "../data-sources/FileUploadDialog";

interface KpiCardProps {
  readonly kpi: KpiDefinition;
}

// --- Fonctions extraites pour la lisibilité ---

function getDisplayValue(value: number | undefined, isPercentage: boolean): string {
  if (value === undefined) return "—";
  if (isPercentage) return `${value}%`;
  return value.toLocaleString("fr-FR");
}

function getStatusClass(value: number | undefined, kpi: KpiDefinition, isPercentage: boolean): string {
  if (kpi.thresholdDanger === undefined || value === undefined) return "";
  const isDanger = isPercentage ? value <= kpi.thresholdDanger : value >= kpi.thresholdDanger;
  if (isDanger) return "danger";
  if (kpi.thresholdWarning !== undefined) {
    const isWarning = isPercentage ? value <= kpi.thresholdWarning : value >= kpi.thresholdWarning;
    if (isWarning) return "warning";
  }
  return "success";
}

function getTrendColor(trend: number, categoryColor: string): string {
  if (trend > 0) return "hsl(152 60% 45%)";
  if (trend < 0) return "hsl(0 72% 55%)";
  return categoryColor;
}

function getStatusBadgeText(statusClass: string): string {
  if (statusClass === "danger") return "Critique";
  if (statusClass === "warning") return "Attention";
  if (statusClass === "success") return "OK";
  return "";
}

function SourceBadge({ latestEntry, isManualSource, isFileSource }: Readonly<{ latestEntry: any, isManualSource: boolean, isFileSource: boolean }>) {
  if (isManualSource) {
    return (
      <>
        <Keyboard className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Saisie manuelle</span>
      </>
    );
  }
  if (latestEntry?.source) {
    return (
      <>
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DATA_SOURCE_COLORS[latestEntry.source.type as keyof typeof DATA_SOURCE_COLORS] }} />
        <span className="text-[10px] text-muted-foreground">{DATA_SOURCE_LABELS[latestEntry.source.type as keyof typeof DATA_SOURCE_LABELS]}</span>
        {isFileSource && latestEntry.source.fileName && (
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px]">
            — {latestEntry.source.fileName}
          </span>
        )}
      </>
    );
  }
  return null;
}

function TrendIndicator({ trend, trendPercent, value }: Readonly<{ trend: number, trendPercent: number, value: number | undefined }>) {
  if (trend !== 0) {
    const isPositive = trend > 0;
    const textColor = isPositive ? "text-success" : "text-destructive";
    return (
      <div className="flex items-center gap-1 text-xs">
        {isPositive ? <TrendingUp className="w-3 h-3 text-success" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
        <span className={textColor}>
          {isPositive ? "+" : ""}{trendPercent}%
        </span>
      </div>
    );
  }
  if (value !== undefined) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="w-3 h-3" /> Stable
      </div>
    );
  }
  return null;
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

  const displayValue = getDisplayValue(value, isPercentage);
  const statusClass = getStatusClass(value, kpi, isPercentage);
  const categoryColor = CATEGORY_COLORS[kpi.category];
  const trendColor = getTrendColor(trend, categoryColor);
  const statusBadgeText = getStatusBadgeText(statusClass);

  const sourceType = latestEntry?.source?.type;
  const isFileSource = sourceType === "excel" || sourceType === "csv";
  const isManualSource = !sourceType || sourceType === "manual";

  const currentPeriod = latestEntry?.period || new Date().toISOString().slice(0, 7);

  return (
    <>
      {/*
        Le onClick, le rôle et le tabindex ont été retirés de la div principale
        pour satisfaire les règles SonarQube.
      */}
      <div className="kpi-card animate-slide-up group relative">

        {/* BOUTON OVERLAY INVISIBLE POUR L'ACCESSIBILITÉ */}
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="absolute inset-0 w-full h-full z-10 opacity-0 focus:opacity-100 focus:ring-2 focus:ring-primary rounded-xl cursor-pointer outline-none"
          aria-label={`Afficher les détails de l'indicateur ${kpi.name}`}
        />

        {/* Action buttons (z-20 pour rester cliquables par-dessus le bouton overlay) */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUploadOpen(true);
            }}
            className="p-1.5 rounded-md hover:bg-primary/10 transition-colors"
            title="Ajouter une source (fichier)"
          >
            <Upload className="w-3.5 h-3.5 text-primary" />
          </button>
          <div className="p-1.5">
            <Search className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>

        <div className="flex items-start justify-between mb-1 relative">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} />
            <span className="text-xs text-muted-foreground font-medium truncate">{kpi.name}</span>
          </div>
          {statusClass && (
            <span className={`status-badge ${statusClass} shrink-0`}>
              {statusBadgeText}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between gap-2 relative">
          <div>
            <div className="kpi-value mb-1">{displayValue}</div>
            <TrendIndicator trend={trend} trendPercent={trendPercent} value={value} />
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

        <div className="mt-2 flex items-center justify-between relative">
          <div className="flex items-center gap-1.5">
            <SourceBadge latestEntry={latestEntry} isManualSource={isManualSource} isFileSource={isFileSource} />
          </div>
          {isFileSource && (
            <FileSpreadsheet className="w-3 h-3 text-success/60" />
          )}
        </div>

        {!!kpi.target && isPercentage && (
          <div className="mt-3 relative">
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