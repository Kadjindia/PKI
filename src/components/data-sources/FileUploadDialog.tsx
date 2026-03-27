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
import { Upload, FileSpreadsheet, X, Check, Calculator, Columns, Calendar, Loader2 } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface Props {
  kpi: KpiDefinition;
  open: boolean;
  onClose: () => void;
  period: string; // Période par défaut si aucune date n'est détectée
}

type AggMethod = "sum" | "average" | "count" | "max" | "min" | "last";

const AGG_LABELS: Record<AggMethod, string> = {
  sum: "Somme",
  average: "Moyenne",
  count: "Comptage (Nombre de lignes)",
  max: "Maximum",
  min: "Minimum",
  last: "Dernière valeur",
};

// Fonction utilitaire pour extraire "YYYY-MM" depuis n'importe quel format de date
function parsePeriod(rawVal: any): string | null {
  if (!rawVal) return null;
  // Format numérique Excel (jours depuis 1900)
  if (typeof rawVal === "number") {
    const d = new Date(Math.round((rawVal - 25569) * 86400 * 1000));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(rawVal).trim();
  // Format JJ/MM/AAAA
  const frMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (frMatch) return `${frMatch[3]}-${frMatch[2]}`;
  // Format YYYY-MM ou YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  // Fallback classique Date JS
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

export default function FileUploadDialog({ kpi, open, onClose, period }: Props) {
  const { refreshData, kpis } = useKpi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"excel" | "csv" | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [selectedDateColumn, setSelectedDateColumn] = useState<string>("none");
  const [aggMethod, setAggMethod] = useState<AggMethod>("sum");

  const [fullData, setFullData] = useState<Record<string, unknown>[]>([]);
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([]);

  // Au lieu d'une seule valeur, on stocke les résultats ventilés par période
  const [groupedResults, setGroupedResults] = useState<Record<string, { value: number; data: Record<string, unknown>[] }>>({});

  const [step, setStep] = useState<"upload" | "configure" | "confirm">("upload");
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setFile(null);
    setFileType(null);
    setSheets([]);
    setSelectedSheet("");
    setColumns([]);
    setSelectedColumn("");
    setSelectedDateColumn("none");
    setAggMethod("sum");
    setRawData([]);
    setFullData([]);
    setGroupedResults({});
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
        setFullData(data);
        setRawData(data.slice(0, 10));
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
    // L'ajout de "raw: false" force l'extraction du texte formaté (ex: 01/05/2024)
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    setFullData(data);
    const cols = data.length > 0 ? Object.keys(data[0]) : [];
    setRawData(data.slice(0, 10));
    setColumns(cols);
  };

  const handleSheetChange = async (sheetName: string) => {
    if (!file) return;
    setSelectedSheet(sheetName);
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    loadSheet(wb, sheetName);
    setSelectedColumn("");
    setSelectedDateColumn("none");
    setGroupedResults({});
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
    if (!selectedColumn || fullData.length === 0) return;

    // 1. Grouper les données par période
    const groups: Record<string, Record<string, unknown>[]> = {};

    fullData.forEach((row) => {
      let p = period; // Par défaut, mois en cours
      if (selectedDateColumn !== "none" && row[selectedDateColumn]) {
        const parsed = parsePeriod(row[selectedDateColumn]);
        if (parsed) p = parsed; // Si on a trouvé une date valide, on écrase
      }
      if (!groups[p]) groups[p] = [];
      groups[p].push(row);
    });

    // 2. Calculer le résultat pour chaque groupe
    const results: Record<string, { value: number; data: Record<string, unknown>[] }> = {};

    Object.entries(groups).forEach(([p, data]) => {
      let result = 0;
      if (aggMethod === "count") {
        result = data.filter(r => r[selectedColumn] !== "" && r[selectedColumn] !== null).length;
      } else {
        const values = data
          .map((r) => Number(String(r[selectedColumn]).replace(',', '.')))
          .filter((v) => !isNaN(v));

        switch (aggMethod) {
          case "sum": result = values.reduce((a, b) => a + b, 0); break;
          case "average": result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
          case "max": result = Math.max(...values); break;
          case "min": result = Math.min(...values); break;
          case "last": result = values[values.length - 1] ?? 0; break;
        }
      }
      results[p] = { value: Math.round(result * 100) / 100, data };
    });

    setGroupedResults(results);
    setStep("confirm");
  }, [selectedColumn, selectedDateColumn, fullData, aggMethod, period]);

  const handleConfirm = async () => {
    if (!file || Object.keys(groupedResults).length === 0) return;
    setUploading(true);

    try {
      const emailCol = columns.find(c => c.toLowerCase() === "email");
      const typeCol = columns.find(c => c.toLowerCase() === "type");
      const dossierCol = columns.find(c => c.toLowerCase() === "dossier");

      // On boucle sur chaque mois détecté pour enregistrer les données séparément
      for (const [p, group] of Object.entries(groupedResults)) {

        // 1. KPI Principal
        await uploadFileForKpi({
          file, kpiId: kpi.id, period: p, selectedColumn, aggregation: aggMethod,
          selectedSheet: fileType === "excel" ? selectedSheet : undefined,
          computedValue: group.value,
          rawData: group.data.slice(0, 100),
          detailRows: group.data.slice(0, 20).map((row) => ({
            label: String(Object.values(row)[0] || ""),
            value: Number(row[selectedColumn]) || 0,
            metadata: {},
          })),
        });

        // 2. Automatisations pour CE mois spécifique
        const kpi1212 = kpis.find(k => k.name.toLowerCase().includes("1212"));
        if (kpi1212 && emailCol) {
          const data1212 = group.data.filter(row => String(row[emailCol] || "").toLowerCase().trim() === "le1212@actionlogement.fr");
          if (data1212.length > 0) {
            await uploadFileForKpi({ file, kpiId: kpi1212.id, period: p, selectedColumn: emailCol, aggregation: "count", computedValue: data1212.length, rawData: data1212.slice(0, 50), detailRows: [] });
          }
        }

        const kpiFraude = kpis.find(k => k.name.toLowerCase().includes("fraude"));
        if (kpiFraude && emailCol) {
          const dataFraude = group.data.filter(row => String(row[emailCol] || "").toLowerCase().trim() === "fraude.als@actionlogement.fr");
          if (dataFraude.length > 0) {
            await uploadFileForKpi({ file, kpiId: kpiFraude.id, period: p, selectedColumn: emailCol, aggregation: "count", computedValue: dataFraude.length, rawData: dataFraude.slice(0, 50), detailRows: [] });
          }
        }

        const kpiExterne = kpis.find(k => k.name.toLowerCase().includes("externe"));
        if (kpiExterne && typeCol) {
          const dataExterne = group.data.filter(row => String(row[typeCol] || "").toUpperCase().trim() === "EXTERNE");
          if (dataExterne.length > 0) {
             await uploadFileForKpi({ file, kpiId: kpiExterne.id, period: p, selectedColumn: typeCol, aggregation: "count", computedValue: dataExterne.length, rawData: dataExterne.slice(0, 50), detailRows: [] });
          }
        }

        const kpiAdressage = kpis.find(k => k.name.toLowerCase().includes("adressage"));
        if (kpiAdressage && dossierCol) {
          const dataAdressage = group.data.filter(row => String(row[dossierCol] || "").trim() === "05 - Erreur d'adressage");
          if (dataAdressage.length > 0) {
             await uploadFileForKpi({ file, kpiId: kpiAdressage.id, period: p, selectedColumn: dossierCol, aggregation: "count", computedValue: dataAdressage.length, rawData: dataAdressage.slice(0, 50), detailRows: [] });
          }
        }
      }

      const nbMois = Object.keys(groupedResults).length;
      toast.success(`Données enregistrées pour ${nbMois} période(s) !`);
      await refreshData();
      handleClose();
    } catch (err: any) {
      console.error("Erreur:", err);
      toast.error(err.message || "Erreur lors de l'enregistrement");
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
            Importer des données — {kpi.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Configurez les colonnes pour calculer automatiquement l'indicateur.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          {["Upload", "Configuration", "Validation"].map((label, i) => {
            const stepIdx = i === 0 ? "upload" : i === 1 ? "configure" : "confirm";
            const isActive = step === stepIdx;
            const isDone = (stepIdx === "upload" && step !== "upload") || (stepIdx === "configure" && step === "confirm");
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-border" />}
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive ? "bg-primary/15 text-primary"
                  : isDone ? "bg-success/15 text-success"
                  : "bg-secondary text-muted-foreground"
                }`}>
                  {isDone ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  {label}
                </div>
              </div>
            );
          })}
        </div>

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
            <p className="text-xs text-muted-foreground">Formats supportés : .xlsx, .xls, .csv</p>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
          </div>
        )}

        {step === "configure" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-secondary/30 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-success" />
                <span className="text-sm font-medium text-foreground">{file?.name}</span>
                <span className="text-xs text-muted-foreground font-semibold text-primary">
                  ({fullData.length} lignes détectées)
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}><X className="w-4 h-4" /></Button>
            </div>

            {fileType === "excel" && sheets.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Columns className="w-3.5 h-3.5" /> Feuille Excel
                </label>
                <Select value={selectedSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-muted/20 p-4 rounded-xl border border-border">
              {/* NOUVEAU : Colonne Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-primary" /> Colonne Date (Optionnel)
                </label>
                <Select value={selectedDateColumn} onValueChange={setSelectedDateColumn}>
                  <SelectTrigger className="w-full bg-background text-xs">
                    <SelectValue placeholder="Ventiler par mois ?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="font-semibold text-muted-foreground">-- Tout assigner à {period} --</SelectItem>
                    {columns.map((c) => (<SelectItem key={`date-${c}`} value={c}>{c}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Columns className="w-3.5 h-3.5" /> Colonne de Valeur
                </label>
                <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                  <SelectTrigger className="w-full bg-background text-xs">
                    <SelectValue placeholder="Choisir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (<SelectItem key={`val-${c}`} value={c}>{c}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5" /> Opération
                </label>
                <Select value={aggMethod} onValueChange={(v) => setAggMethod(v as AggMethod)}>
                  <SelectTrigger className="w-full bg-background text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AGG_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Aperçu (10 premières lignes)</label>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {columns.slice(0, 5).map((col) => (
                        <TableHead key={col} className={`text-[10px] uppercase tracking-wider ${col === selectedDateColumn ? 'text-primary' : ''}`}>
                          {col}{col === selectedColumn && " (Cible)"}{col === selectedDateColumn && " (Date)"}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawData.map((row, i) => (
                      <TableRow key={i}>
                        {columns.slice(0, 5).map((col) => (
                          <TableCell key={col} className={`text-xs py-2 ${col === selectedColumn ? "font-bold" : ""}`}>
                            {String(row[col] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={computeValue} disabled={!selectedColumn} className="gap-2">
                <Calculator className="w-4 h-4" /> Lancer le calcul
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-6 py-4">
            <div className="bg-primary/5 rounded-2xl border border-primary/10 p-6 space-y-4">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest text-center mb-4">
                Résultat de l'analyse : {Object.keys(groupedResults).length} mois détecté(s)
              </p>

              {/* Affichage des résultats mois par mois */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {Object.entries(groupedResults).sort(([a], [b]) => b.localeCompare(a)).map(([p, group]) => (
                  <div key={p} className="bg-background rounded-lg p-4 border border-border text-center shadow-sm">
                    <p className="text-xs text-muted-foreground font-medium mb-1">{p}</p>
                    <p className="text-2xl font-bold text-foreground">
                      {group.value} {(kpi.unit === "pourcentage" || kpi.unit === "taux") && "%"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">{group.data.length} lignes</p>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-success font-medium flex items-center justify-center gap-1 mt-4">
                <Check className="w-3 h-3" /> Ces données seront injectées pour chaque mois correspondant
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("configure")} disabled={uploading}>
                ← Revenir
              </Button>
              <Button onClick={handleConfirm} disabled={uploading} className="gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {uploading ? "Enregistrement en cours..." : "Valider l'importation"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}