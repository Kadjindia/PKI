import { useState } from "react";
import { useKpi } from "@/context/KpiContext";
import { KpiDefinition, DATA_SOURCE_LABELS, DATA_SOURCE_COLORS, DataSourceType } from "@/types/kpi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  FileSpreadsheet,
  Globe,
  Keyboard,
  BarChart3,
  ExternalLink,
  Download,
  Database,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Upload,
  History,
} from "lucide-react";
import FileUploadDialog from "../data-sources/FileUploadDialog";
import SourceHistoryDialog from "../data-sources/SourceHistoryDialog";

interface Props {
  kpi: KpiDefinition;
  open: boolean;
  onClose: () => void;
}

const SOURCE_ICONS: Record<string, typeof FileSpreadsheet> = {
  manual: Keyboard,
  excel: FileSpreadsheet,
  csv: FileSpreadsheet,
  powerbi: BarChart3,
  api: Globe,
  sharepoint: Database,
};

export default function KpiDetailDialog({ kpi, open, onClose }: Props) {
  const { getEntriesForKpi, getPreviousValue, getLatestValue } = useKpi();
  const entries = getEntriesForKpi(kpi.id);
  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const latestValue = getLatestValue(kpi.id);
  const prevValue = getPreviousValue(kpi.id);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const trend = latestValue !== undefined && prevValue !== undefined ? latestValue - prevValue : 0;
  const trendPercent = prevValue ? Math.round((trend / prevValue) * 100) : 0;
  const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";

  const chartData = entries.map((e) => ({
    period: new Date(e.period + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    value: e.value,
  }));

  const source = latestEntry?.source;
  const details = latestEntry?.details;
  const SourceIcon = source ? SOURCE_ICONS[source.type] || Globe : Keyboard;

  // Count source types
  const sourceCounts = entries.reduce<Record<string, number>>((acc, e) => {
    const t = e.source?.type || "manual";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const currentPeriod = latestEntry?.period || new Date().toISOString().slice(0, 7);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-foreground flex items-center gap-2 text-lg">
                  {kpi.name}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {kpi.description}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="w-3.5 h-3.5" />
                  Sources
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Ajouter fichier
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Valeur actuelle"
              value={latestValue !== undefined ? (isPercentage ? `${latestValue}%` : latestValue.toLocaleString("fr-FR")) : "—"}
            />
            <SummaryCard
              label="Tendance"
              value={trend !== 0 ? `${trend > 0 ? "+" : ""}${trendPercent}%` : "Stable"}
              icon={trend > 0 ? <TrendingUp className="w-3.5 h-3.5 text-success" /> : trend < 0 ? <TrendingDown className="w-3.5 h-3.5 text-destructive" /> : <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
            />
            <SummaryCard label="Périodes" value={`${entries.length}`} />
            <SummaryCard
              label="Source"
              value={source ? DATA_SOURCE_LABELS[source.type] : "—"}
              icon={<SourceIcon className="w-3.5 h-3.5" style={{ color: source ? DATA_SOURCE_COLORS[source.type] : undefined }} />}
            />
          </div>

          {/* Source types breakdown */}
          {Object.keys(sourceCounts).length > 1 && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Sources utilisées :</span>
              {Object.entries(sourceCounts).map(([type, count]) => {
                const Icon = SOURCE_ICONS[type] || Keyboard;
                return (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      backgroundColor: `${DATA_SOURCE_COLORS[type as DataSourceType]}15`,
                      color: DATA_SOURCE_COLORS[type as DataSourceType],
                    }}
                  >
                    <Icon className="w-3 h-3" />
                    {DATA_SOURCE_LABELS[type as DataSourceType]} ({count})
                  </span>
                );
              })}
            </div>
          )}

          <Tabs defaultValue="evolution" className="mt-2">
            <TabsList className="bg-secondary/50 w-full justify-start">
              <TabsTrigger value="evolution" className="text-xs">📈 Évolution</TabsTrigger>
              <TabsTrigger value="details" className="text-xs">📋 Détail données</TabsTrigger>
              <TabsTrigger value="source" className="text-xs">🔗 Source</TabsTrigger>
              <TabsTrigger value="history" className="text-xs">🕐 Historique</TabsTrigger>
            </TabsList>

            {/* Evolution chart */}
            <TabsContent value="evolution">
              <div className="h-[250px] mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="detail-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(187 80% 48%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(187 80% 48%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 15%)" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(215 20% 55%)" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222 44% 9%)",
                        border: "1px solid hsl(222 30% 18%)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "hsl(210 40% 92%)",
                      }}
                    />
                    <Area type="monotone" dataKey="value" name={kpi.name} stroke="hsl(187 80% 48%)" fill="url(#detail-grad)" strokeWidth={2} dot={{ r: 4, fill: "hsl(187 80% 48%)", strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {kpi.target && (
                <p className="text-xs text-muted-foreground mt-2">
                  🎯 Objectif : <span className="font-mono font-bold text-foreground">{kpi.target}{isPercentage ? "%" : ""}</span>
                </p>
              )}
            </TabsContent>

            {/* Detail breakdown */}
            <TabsContent value="details">
              {details && details.length > 0 ? (
                <div className="space-y-2">
                  {source?.aggregation && source.selectedColumn && (
                    <p className="text-xs text-muted-foreground">
                      Calcul : <span className="font-medium text-foreground">{source.aggregation}</span> sur « <span className="font-medium text-foreground">{source.selectedColumn}</span> »
                    </p>
                  )}
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-secondary/30">
                          <TableHead className="text-xs">Libellé</TableHead>
                          <TableHead className="text-xs text-right">Valeur</TableHead>
                          {details[0]?.metadata && Object.keys(details[0].metadata).map((key) => (
                            <TableHead key={key} className="text-xs capitalize">{key}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {details.map((row, i) => (
                          <TableRow key={i} className="hover:bg-secondary/20">
                            <TableCell className="text-xs font-medium">{row.label}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{row.value}</TableCell>
                            {row.metadata && Object.values(row.metadata).map((val, j) => (
                              <TableCell key={j} className="text-xs text-muted-foreground">{val}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">Aucune donnée détaillée disponible pour cet indicateur.</p>
              )}
            </TabsContent>

            {/* Source info */}
            <TabsContent value="source">
              {source ? (
                <div className="space-y-4 mt-2">
                  <div className="glass-panel p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${DATA_SOURCE_COLORS[source.type]}20` }}>
                        <SourceIcon className="w-5 h-5" style={{ color: DATA_SOURCE_COLORS[source.type] }} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{source.label}</div>
                        <div className="text-xs text-muted-foreground">{DATA_SOURCE_LABELS[source.type]}</div>
                      </div>
                    </div>

                    {source.lastSync && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        Dernière synchro : {new Date(source.lastSync).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}

                    {source.aggregation && source.selectedColumn && (
                      <div className="text-xs text-muted-foreground bg-secondary/50 rounded px-3 py-2">
                        Méthode : <span className="font-medium text-foreground">{source.aggregation}</span> sur colonne « <span className="font-medium text-foreground">{source.selectedColumn}</span> »
                        {source.selectedSheet && <> · Feuille « <span className="font-medium text-foreground">{source.selectedSheet}</span> »</>}
                      </div>
                    )}

                    {source.fileName && (
                      <button className="flex items-center gap-2 text-xs text-primary hover:underline">
                        <Download className="w-3 h-3" />
                        Télécharger {source.fileName}
                      </button>
                    )}

                    {source.fileUrl && source.type === "powerbi" && (
                      <a href={source.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline">
                        <ExternalLink className="w-3 h-3" />
                        Ouvrir dans Power BI
                      </a>
                    )}

                    {source.apiEndpoint && (
                      <div className="text-xs text-muted-foreground font-mono bg-secondary/50 rounded px-3 py-2 break-all">
                        {source.apiEndpoint}
                      </div>
                    )}
                  </div>

                  {source.type === "powerbi" && source.embedUrl && (
                    <div className="glass-panel p-4">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Aperçu Power BI</h4>
                      <div className="aspect-video rounded-lg bg-secondary/30 border border-border flex items-center justify-center">
                        <div className="text-center space-y-2">
                          <BarChart3 className="w-8 h-8 text-accent mx-auto" />
                          <p className="text-xs text-muted-foreground">Le rapport Power BI s'affichera ici une fois connecté.</p>
                          <a href={source.fileUrl || source.embedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="w-3 h-3" /> Ouvrir le rapport
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {source.rawData && source.rawData.length > 0 && (
                    <div className="glass-panel p-4">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">
                        Aperçu du fichier source ({source.rawData.length} lignes)
                      </h4>
                      <div className="rounded-lg border border-border overflow-auto max-h-[200px]">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-secondary/30">
                              {source.columns?.map((col) => (
                                <TableHead key={col} className={`text-[10px] uppercase tracking-wider whitespace-nowrap ${col === source.selectedColumn ? "text-primary font-bold" : ""}`}>
                                  {col}{col === source.selectedColumn && " ✓"}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {source.rawData.map((row, i) => (
                              <TableRow key={i} className="hover:bg-secondary/20">
                                {source.columns?.map((col) => (
                                  <TableCell key={col} className={`text-xs font-mono py-1.5 ${col === source.selectedColumn ? "text-primary font-bold" : ""}`}>
                                    {String((row as Record<string, unknown>)[col] ?? "")}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-muted-foreground">Aucune source associée.</p>
                  <Button size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                    <Upload className="w-3.5 h-3.5" />
                    Importer un fichier
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* History */}
            <TabsContent value="history">
              <div className="rounded-lg border border-border overflow-hidden mt-2">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/30">
                      <TableHead className="text-xs">Période</TableHead>
                      <TableHead className="text-xs text-right">Valeur</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Date de saisie</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...entries].reverse().map((entry) => {
                      const EntryIcon = entry.source ? SOURCE_ICONS[entry.source.type] || Globe : Keyboard;
                      return (
                        <TableRow key={entry.id} className="hover:bg-secondary/20">
                          <TableCell className="text-xs font-medium">
                            {new Date(entry.period + "-01").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold">
                            {isPercentage ? `${entry.value}%` : entry.value.toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="inline-flex items-center gap-1">
                              <EntryIcon className="w-3 h-3" style={{ color: entry.source ? DATA_SOURCE_COLORS[entry.source.type] : undefined }} />
                              {entry.source ? DATA_SOURCE_LABELS[entry.source.type] : "—"}
                              {entry.source?.fileName && (
                                <span className="text-muted-foreground/60 text-[10px]">({entry.source.fileName})</span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleDateString("fr-FR")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <FileUploadDialog kpi={kpi} open={uploadOpen} onClose={() => setUploadOpen(false)} period={currentPeriod} />
      <SourceHistoryDialog kpi={kpi} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="glass-panel p-3 space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-bold font-mono text-foreground">{value}</span>
      </div>
    </div>
  );
}
