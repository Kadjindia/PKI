import { KpiDefinition, KpiEntry, DATA_SOURCE_LABELS, DATA_SOURCE_COLORS, DataSourceType } from "@/types/kpi";
import { useKpi } from "@/context/KpiContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Keyboard, Globe, BarChart3, Database, Trash2, Eye } from "lucide-react";
import { useState } from "react";

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

export default function SourceHistoryDialog({ kpi, open, onClose }: Props) {
  const { getEntriesForKpi, removeEntry } = useKpi();
  const entries = getEntriesForKpi(kpi.id);
  const [previewEntry, setPreviewEntry] = useState<KpiEntry | null>(null);

  const isPercentage = kpi.unit === "pourcentage" || kpi.unit === "taux";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Historique des sources — {kpi.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Liste de toutes les données et sources associées à cet indicateur
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucune donnée disponible pour cet indicateur.
          </p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30">
                  <TableHead className="text-xs">Période</TableHead>
                  <TableHead className="text-xs text-right">Valeur</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...entries].reverse().map((entry) => {
                  const sourceType = entry.source?.type || "manual";
                  const Icon = SOURCE_ICONS[sourceType] || Keyboard;
                  const isFile = sourceType === "excel" || sourceType === "csv";

                  return (
                    <TableRow key={entry.id} className="hover:bg-secondary/20">
                      <TableCell className="text-xs font-medium">
                        {new Date(entry.period + "-01").toLocaleDateString("fr-FR", {
                          month: "long",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono font-bold">
                        {isPercentage ? `${entry.value}%` : entry.value.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            backgroundColor: `${DATA_SOURCE_COLORS[sourceType as DataSourceType]}15`,
                            color: DATA_SOURCE_COLORS[sourceType as DataSourceType],
                          }}
                        >
                          <Icon className="w-3 h-3" />
                          {DATA_SOURCE_LABELS[sourceType as DataSourceType]}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.source?.fileName || entry.source?.label || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isFile && entry.source?.rawData && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setPreviewEntry(previewEntry?.id === entry.id ? null : entry)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => removeEntry(entry.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Inline data preview */}
        {previewEntry?.source?.rawData && previewEntry.source.rawData.length > 0 && (
          <div className="glass-panel p-4 mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground">
                Aperçu — {previewEntry.source.fileName} ({previewEntry.source.rawData.length} lignes)
              </h4>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPreviewEntry(null)}>
                <span className="text-xs">✕</span>
              </Button>
            </div>
            <div className="rounded-lg border border-border overflow-auto max-h-[200px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/30">
                    {previewEntry.source.columns?.map((col) => (
                      <TableHead key={col} className="text-[10px] uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewEntry.source.rawData.map((row, i) => (
                    <TableRow key={i} className="hover:bg-secondary/20">
                      {previewEntry.source!.columns?.map((col) => (
                        <TableCell key={col} className="text-xs font-mono py-1.5">
                          {String((row as Record<string, unknown>)[col] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {previewEntry.source.aggregation && previewEntry.source.selectedColumn && (
              <p className="text-[10px] text-muted-foreground">
                Calcul : <span className="font-medium text-foreground">{previewEntry.source.aggregation}</span> sur la colonne « <span className="font-medium text-foreground">{previewEntry.source.selectedColumn}</span> »
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
