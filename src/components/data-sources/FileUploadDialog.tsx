import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiDefinition } from "@/types/kpi";
import { useKpi } from "@/context/KpiContext";
import { uploadFileForKpi } from "@/lib/supabase-kpi";
import { Upload, FileSpreadsheet, X, Check, Calculator, Columns, Loader2 } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface Props {
  kpi: KpiDefinition;
  open: boolean;
  onClose: () => void;
  period: string;
}

type AggMethod = "sum" | "average" | "count" | "max" | "min" | "last";

const AGG_LABELS: Record<AggMethod, string> = {
  sum: "Somme",
  average: "Moyenne",
  count: "Comptage",
  max: "Maximum",
  min: "Minimum",
  last: "Dernière valeur",
};

export default function FileUploadDialog({ kpi, open, onClose, period }: Props) {
  const { refreshData } = useKpi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"excel" | "csv" | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [aggMethod, setAggMethod] = useState<AggMethod>("sum");
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([]);
  const [computedValue, setComputedValue] = useState<number | null>(null);
  const [step, setStep] = useState<"upload" | "configure" | "confirm">("upload");
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setFile(null);
    setFileType(null);
    setSheets([]);
    setSelectedSheet("");
    setColumns([]);
    setSelectedColumn("");
    setAggMethod("sum");
    setRawData([]);
    setComputedValue(null);
    setStep("upload");
    setUploading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const parseCSV = (f: File) => {
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Record<string, unknown>[];
        const cols = results.meta.fields || [];
        setRawData(data.slice(0, 100));
        setColumns(cols);
        setFileType("csv");
        setStep("configure");
      },
    });
  };

  const parseExcel = async (f: File) => {
    const buffer = await f.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    setSheets(wb.SheetNames);
    setSelectedSheet(wb.SheetNames[0]);
    loadSheet(wb, wb.SheetNames[0]);
    setFileType("excel");
    setStep("configure");
  };

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const cols = data.length > 0 ? Object.keys(data[0]) : [];
    setRawData(data.slice(0, 100));
    setColumns(cols);
  };

  const handleSheetChange = async (sheetName: string) => {
    if (!file) return;
    setSelectedSheet(sheetName);
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    loadSheet(wb, sheetName);
    setSelectedColumn("");
    setComputedValue(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") parseCSV(f);
    else if (ext === "xlsx" || ext === "xls") parseExcel(f);
  };

  const computeValue = useCallback(() => {
    if (!selectedColumn || rawData.length === 0) return;
    const values = rawData.map((r) => Number(r[selectedColumn])).filter((v) => !isNaN(v));
    let result: number;
    switch (aggMethod) {
      case "sum": result = values.reduce((a, b) => a + b, 0); break;
      case "average": result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
      case "count": result = values.length; break;
      case "max": result = Math.max(...values); break;
      case "min": result = Math.min(...values); break;
      case "last": result = values[values.length - 1] ?? 0; break;
      default: result = 0;
    }
    setComputedValue(Math.round(result * 100) / 100);
    setStep("confirm");
  }, [selectedColumn, rawData, aggMethod]);

  const handleConfirm = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const detailRows = rawData.slice(0, 20).map((row) => ({
        label: String(Object.values(row)[0] || ""),
        value: Number(row[selectedColumn]) || 0,
        metadata: Object.fromEntries(
          Object.entries(row)
            .filter(([k]) => k !== selectedColumn)
            .slice(0, 3)
            .map(([k, v]) => [k, String(v)])
        ),
      }));
      await uploadFileForKpi({
        file,
        kpiId: kpi.id,
        period,
        selectedColumn,
        aggregation: aggMethod,
        selectedSheet: fileType === "excel" ? selectedSheet : undefined,
        computedValue: computedValue!,
        rawData,
        detailRows,
      });
      toast.success(`Fichier traité et enregistré en base`);
      await refreshData();
      handleClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erreur lors du traitement du fichier");
      setUploading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setFile(f);
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") parseCSV(f);
    else if (ext === "xlsx" || ext === "xls") parseExcel(f);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Ajouter une source — {kpi.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Le fichier sera uploadé et traité par le serveur. Les données seront persistées en base.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-2">
          {["Upload", "Configuration", "Validation"].map((label, i) => {
            const stepIdx = i === 0 ? "upload" : i === 1 ? "configure" : "confirm";
            const isActive = step === stepIdx;
            const isDone =
              (stepIdx === "upload" && step !== "upload") ||
              (stepIdx === "configure" && step === "confirm");
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-border" />}
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive ? "bg-primary/15 text-primary"
                    : isDone ? "bg-success/15 text-success"
                    : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div
            className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">
              Glissez-déposez un fichier ou cliquez pour sélectionner
            </p>
            <p className="text-xs text-muted-foreground">
              Formats supportés : .xlsx, .xls, .csv — Le fichier sera stocké côté serveur
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between glass-panel p-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-success" />
                <span className="text-sm font-medium text-foreground">{file?.name}</span>
                <span className="text-xs text-muted-foreground">({rawData.length} lignes)</span>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {fileType === "excel" && sheets.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Columns className="w-3.5 h-3.5" /> Feuille
                </label>
                <Select value={selectedSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger className="w-full bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Columns className="w-3.5 h-3.5" /> Colonne de valeur
                </label>
                <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                  <SelectTrigger className="w-full bg-secondary/50">
                    <SelectValue placeholder="Sélectionnez une colonne" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5" /> Méthode de calcul
                </label>
                <Select value={aggMethod} onValueChange={(v) => setAggMethod(v as AggMethod)}>
                  <SelectTrigger className="w-full bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AGG_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {rawData.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Aperçu des données ({Math.min(rawData.length, 10)} premières lignes)
                </label>
                <div className="rounded-lg border border-border overflow-auto max-h-[220px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-secondary/30">
                        {columns.slice(0, 8).map((col) => (
                          <TableHead
                            key={col}
                            className={`text-[10px] uppercase tracking-wider whitespace-nowrap ${col === selectedColumn ? "text-primary font-bold" : ""}`}
                          >
                            {col}{col === selectedColumn && " ✓"}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rawData.slice(0, 10).map((row, i) => (
                        <TableRow key={i} className="hover:bg-secondary/20">
                          {columns.slice(0, 8).map((col) => (
                            <TableCell
                              key={col}
                              className={`text-xs font-mono py-1.5 ${col === selectedColumn ? "text-primary font-bold" : ""}`}
                            >
                              {String(row[col] ?? "")}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={computeValue} disabled={!selectedColumn} className="gap-2">
                <Calculator className="w-4 h-4" />
                Calculer la valeur
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            <div className="glass-panel p-6 text-center space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Valeur calculée ({AGG_LABELS[aggMethod]} de « {selectedColumn} »)
              </p>
              <div className="text-4xl font-bold font-mono" style={{ color: "hsl(var(--primary))" }}>
                {computedValue}
                {(kpi.unit === "pourcentage" || kpi.unit === "taux") && "%"}
              </div>
              <p className="text-xs text-muted-foreground">
                Période : {period} · Source : {file?.name}
              </p>
              <p className="text-xs text-muted-foreground/60">
                📦 Le fichier sera stocké sur le serveur et les données persistées en base PostgreSQL
              </p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("configure")} disabled={uploading}>
                ← Modifier
              </Button>
              <Button onClick={handleConfirm} disabled={uploading} className="gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {uploading ? "Envoi en cours…" : "Valider et enregistrer"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
