import { useState, useMemo, useRef } from "react";
import { useKpi } from "@/context/KpiContext";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Line, ComposedChart } from "recharts";
import { addKpiEntry } from "@/lib/supabase-kpi";
import * as XLSX from "xlsx";
import Papa from "papaparse";

// --- COMPOSANTS UI ---
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// --- ICÔNES ---
import { Mail, AlertTriangle, ShieldCheck, Inbox, Plus, Activity, AlertCircle, ArrowUpRight, ArrowDownRight, Globe, Upload, Loader2, CalendarDays } from "lucide-react";

// --- FONCTIONS UTILITAIRES ---
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const calculatePercentage = (part: number, total: number) => {
  const p = safeNum(part);
  const t = safeNum(total);
  if (t === 0) return 0;
  return Math.round((p / t) * 100);
};

// Analyseur universel de dates (extrait YYYY-MM)
function parsePeriod(rawVal: any): string | null {
  if (!rawVal) return null;
  if (typeof rawVal === "number") {
    const d = new Date(Math.round((rawVal - 25569) * 86400 * 1000));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(rawVal).trim();
  const frMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (frMatch) return `${frMatch[3]}-${frMatch[2]}`;
  const isoMatch = s.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

export default function MessagerieView() {
  const { entries } = useKpi();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- ÉTATS ---
  const [isAddStatsOpen, setIsAddStatsOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // État pour la saisie manuelle (1 mois)
  const [newStats, setNewStats] = useState({
    period: new Date().toISOString().substring(0, 7),
    total: 0, fraude: 0, interne1212: 0, externe: 0, erreur: 0
  });

  // NOUVEAU : État pour l'import de fichier (Plusieurs mois)
  const [parsedMonths, setParsedMonths] = useState<Record<string, typeof newStats>>({});

  // --- PRÉPARATION DES DONNÉES GLOBALES ---
  const msgEntries = entries.filter(e => e.kpiId.startsWith('msg-'));
  const availablePeriods = useMemo(() => {
    return [...new Set(msgEntries.map((e) => e.period))].sort();
  }, [msgEntries]);

  const monthlyData = useMemo(() => {
    return availablePeriods.map(period => {
      const getVal = (id: string) => safeNum(msgEntries.find(e => e.kpiId === id && e.period === period)?.value);

      const total = getVal('msg-total');
      const fraude = getVal('msg-fraude');
      const interne = getVal('msg-1212');
      const externe = getVal('msg-externe');
      const erreur = getVal('msg-erreur');

      return {
        period,
        formatPeriod: new Date(period + "-01").toLocaleDateString("fr-FR", { month: "short", year: "numeric" }),
        total, fraude, interne, externe, erreur,
        tauxFraude: calculatePercentage(fraude, total),
        tauxInterne: calculatePercentage(interne, total)
      };
    });
  }, [availablePeriods, msgEntries]);

  const currentMonthData = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;
  const previousMonthData = monthlyData.length > 1 ? monthlyData[monthlyData.length - 2] : null;

  const getTrend = (current: number, previous: number) => {
    if (!previous) return null;
    const diff = current - previous;
    const percent = Math.round((Math.abs(diff) / previous) * 100);
    if (diff > 0) return <span className="text-rose-500 flex items-center text-xs"><ArrowUpRight className="w-3 h-3 mr-0.5"/>+{percent}%</span>;
    if (diff < 0) return <span className="text-emerald-500 flex items-center text-xs"><ArrowDownRight className="w-3 h-3 mr-0.5"/>-{percent}%</span>;
    return <span className="text-slate-500 text-xs">=</span>;
  };

  // ============================================================================
  // LOGIQUE D'ANALYSE DU FICHIER (VENTILATION PAR MOIS)
  // ============================================================================
  const processRawData = (data: Record<string, unknown>[]) => {
    if (data.length === 0) {
      toast.error("Le fichier est vide.");
      setIsAnalyzing(false);
      return;
    }

    const columns = Object.keys(data[0]);
    // Détection des colonnes
    const dateCol = columns.find(c => c.toLowerCase().includes("date") || c.toLowerCase().includes("reçu") || c.toLowerCase().includes("time"));
    const emailCol = columns.find(c => c.toLowerCase().includes("email") || c.toLowerCase().includes("mail"));
    const typeCol = columns.find(c => c.toLowerCase() === "type");
    const dossierCol = columns.find(c => c.toLowerCase().includes("dossier"));

    const groups: Record<string, typeof newStats> = {};

    data.forEach(row => {
      // 1. Déterminer la période de cette ligne
      let period = newStats.period; // Par défaut : le mois sélectionné dans l'interface
      if (dateCol && row[dateCol]) {
        const extracted = parsePeriod(row[dateCol]);
        if (extracted) period = extracted;
      }

      // 2. Initialiser le compteur du mois s'il n'existe pas encore
      if (!groups[period]) {
        groups[period] = { period, total: 0, fraude: 0, interne1212: 0, externe: 0, erreur: 0 };
      }

      // 3. Incrémenter les compteurs
      groups[period].total++; // +1 message

      if (emailCol) {
        const email = String(row[emailCol] || "").toLowerCase().trim();
        if (email === "le1212@actionlogement.fr") groups[period].interne1212++;
        if (email === "fraude.als@actionlogement.fr") groups[period].fraude++;
      }

      if (typeCol) {
        const type = String(row[typeCol] || "").toUpperCase().trim();
        if (type === "EXTERNE") groups[period].externe++;
      }

      if (dossierCol) {
        const dossier = String(row[dossierCol] || "").trim();
        if (dossier === "05 - Erreur d'adressage") groups[period].erreur++;
      }
    });

    setParsedMonths(groups);
    toast.success(`Fichier analysé ! ${Object.keys(groups).length} mois détecté(s).`);
    setIsAnalyzing(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processRawData(results.data as Record<string, unknown>[]),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        // Important: raw: false permet de récupérer le texte des dates Excel
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
        processRawData(data);
      } catch (error) {
        toast.error("Impossible de lire le fichier Excel.");
        setIsAnalyzing(false);
      }
    } else {
      toast.error("Format de fichier non supporté (.csv ou .xlsx uniquement).");
      setIsAnalyzing(false);
    }
    e.target.value = '';
  };

  // ============================================================================
  // SAUVEGARDE DANS LA BASE DE DONNÉES
  // ============================================================================
  const saveStatsMutation = useMutation({
    mutationFn: async () => {
      const sourceLabel = "Bilan Messagerie (Import)";
      const promises: Promise<any>[] = [];

      // Si on a un fichier analysé avec plusieurs mois :
      if (Object.keys(parsedMonths).length > 0) {
        Object.values(parsedMonths).forEach((stats) => {
          promises.push(addKpiEntry({ kpiId: 'msg-total', value: stats.total, period: stats.period, sourceLabel }));
          promises.push(addKpiEntry({ kpiId: 'msg-fraude', value: stats.fraude, period: stats.period, sourceLabel }));
          promises.push(addKpiEntry({ kpiId: 'msg-1212', value: stats.interne1212, period: stats.period, sourceLabel }));
          promises.push(addKpiEntry({ kpiId: 'msg-externe', value: stats.externe, period: stats.period, sourceLabel }));
          promises.push(addKpiEntry({ kpiId: 'msg-erreur', value: stats.erreur, period: stats.period, sourceLabel }));
        });
      }
      // Si saisie manuelle d'un seul mois :
      else {
        promises.push(addKpiEntry({ kpiId: 'msg-total', value: newStats.total, period: newStats.period, sourceLabel: "Saisie Manuelle" }));
        promises.push(addKpiEntry({ kpiId: 'msg-fraude', value: newStats.fraude, period: newStats.period, sourceLabel: "Saisie Manuelle" }));
        promises.push(addKpiEntry({ kpiId: 'msg-1212', value: newStats.interne1212, period: newStats.period, sourceLabel: "Saisie Manuelle" }));
        promises.push(addKpiEntry({ kpiId: 'msg-externe', value: newStats.externe, period: newStats.period, sourceLabel: "Saisie Manuelle" }));
        promises.push(addKpiEntry({ kpiId: 'msg-erreur', value: newStats.erreur, period: newStats.period, sourceLabel: "Saisie Manuelle" }));
      }

      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-entries'] });
      toast.success("Bilan(s) enregistré(s) avec succès !");

      // RESET TOTAL
      setIsAddStatsOpen(false);
      setParsedMonths({});
      setNewStats({
        period: new Date().toISOString().substring(0, 7),
        total: 0, fraude: 0, interne1212: 0, externe: 0, erreur: 0
      });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Erreur lors de l'enregistrement des données.");
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mail className="w-6 h-6 text-primary" />
            Supervision Boîte SSI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyse des flux, menaces qualifiées et erreurs d'adressage
          </p>
        </div>
        <Button onClick={() => setIsAddStatsOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Intégrer des données
        </Button>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase flex items-center justify-between">
              <span className="flex items-center gap-2"><Inbox className="w-4 h-4 text-blue-500" /> Volume Total</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-foreground">{currentMonthData?.total || 0}</div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Mails traités ce mois</p>
              {currentMonthData && previousMonthData && getTrend(currentMonthData.total, previousMonthData.total)}
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${currentMonthData && currentMonthData.tauxFraude > 20 ? 'border-l-rose-500 bg-rose-50/50 dark:bg-rose-900/10' : 'border-l-amber-500'}`}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase flex items-center justify-between">
              <span className="flex items-center gap-2"><AlertTriangle className={`w-4 h-4 ${currentMonthData && currentMonthData.tauxFraude > 20 ? 'text-rose-500' : 'text-amber-500'}`} /> Menaces (Fraude)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className={`text-2xl font-bold ${currentMonthData && currentMonthData.tauxFraude > 20 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-500'}`}>
              {currentMonthData?.fraude || 0} <span className="text-sm font-normal opacity-70">({currentMonthData?.tauxFraude || 0}%)</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Mails qualifiés malveillants</p>
              {currentMonthData && previousMonthData && getTrend(currentMonthData.fraude, previousMonthData.fraude)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase flex items-center justify-between">
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Signalements 1212</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {currentMonthData?.interne || 0} <span className="text-sm font-normal opacity-70">({currentMonthData?.tauxInterne || 0}%)</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Remontées collaborateurs</p>
              {currentMonthData && previousMonthData && getTrend(currentMonthData.interne, previousMonthData.interne)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-slate-400 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase flex items-center justify-between">
              <span className="flex items-center gap-2"><Globe className="w-4 h-4 text-slate-500" /> Sollicitations Ext.</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{currentMonthData?.externe || 0}</div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Provenant de l'extérieur</p>
              {currentMonthData && previousMonthData && getTrend(currentMonthData.externe, previousMonthData.externe)}
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${currentMonthData && currentMonthData.erreur > 25 ? 'border-l-rose-600 bg-rose-50/50 dark:bg-rose-900/10' : currentMonthData && currentMonthData.erreur > 10 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase flex items-center justify-between">
              <span className="flex items-center gap-2">
                {currentMonthData && currentMonthData.erreur > 10 ? <AlertCircle className="w-4 h-4 text-rose-500" /> : <Activity className="w-4 h-4 text-emerald-500" />}
                Erreurs Adressage
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className={`text-2xl font-bold ${currentMonthData && currentMonthData.erreur > 25 ? 'text-rose-600 dark:text-rose-400' : currentMonthData && currentMonthData.erreur > 10 ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {currentMonthData?.erreur || 0}
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">Mails non justifiés</p>
              {currentMonthData && previousMonthData && getTrend(currentMonthData.erreur, previousMonthData.erreur)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* GRAPHIQUE */}
      <Card className="shadow-sm">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Évolution des flux et menaces (Sur l'année)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {monthlyData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground italic">Aucune donnée de messagerie disponible.</div>
          ) : (
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.2)" />
                  <XAxis dataKey="formatPeriod" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "8px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    itemStyle={{ color: "hsl(var(--foreground))", fontSize: "12px", fontWeight: 500 }}
                  />
                  <Legend wrapperStyle={{ paddingTop: "20px", fontSize: "12px" }} />

                  <Bar dataKey="interne" name="Signalements 1212" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="fraude" name="Menaces (Fraude)" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="externe" name="Externe" stackId="a" fill="#64748b" radius={[4, 4, 0, 0]} />

                  <Line type="monotone" dataKey="total" name="Volume Total" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TABLEAU */}
      <Card className="shadow-sm">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Inbox className="w-4 h-4 text-primary" /> Registre Mensuel Détaillé
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Période</TableHead>
                <TableHead>Volume Total</TableHead>
                <TableHead>Fraude</TableHead>
                <TableHead>Signalements 1212</TableHead>
                <TableHead>Externe</TableHead>
                <TableHead className="text-right">Erreurs (Bruit)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...monthlyData].reverse().map((row) => (
                <TableRow key={row.period} className="hover:bg-muted/50">
                  <TableCell className="font-medium capitalize">{row.formatPeriod}</TableCell>
                  <TableCell className="font-bold text-blue-600 dark:text-blue-400">{row.total}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{row.fraude}</span>
                      {row.tauxFraude > 0 && <Badge variant="outline" className={`text-[10px] py-0 h-4 ${row.tauxFraude > 20 ? 'text-rose-600 border-rose-200 bg-rose-50' : 'text-amber-600 border-amber-200 bg-amber-50'}`}>{row.tauxFraude}%</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{row.interne}</span>
                      {row.tauxInterne > 0 && <Badge variant="outline" className="text-[10px] py-0 h-4 text-emerald-600 border-emerald-200 bg-emerald-50">{row.tauxInterne}%</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.externe}</TableCell>
                  <TableCell className="text-right">
                    {row.erreur > 25 ? (
                      <Badge variant="destructive" className="font-bold">{row.erreur}</Badge>
                    ) : row.erreur > 10 ? (
                      <Badge variant="outline" className="bg-amber-500 text-white border-transparent">{row.erreur}</Badge>
                    ) : (
                      <span className="text-emerald-600 font-medium">{row.erreur}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {monthlyData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center p-8 text-muted-foreground">Aucun bilan enregistré.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ============================================================================ */}
      {/* MODALE D'AJOUT ET D'IMPORT AUTOMATIQUE                                        */}
      {/* ============================================================================ */}
      <Dialog open={isAddStatsOpen} onOpenChange={(open) => {
        setIsAddStatsOpen(open);
        if (!open) setParsedMonths({}); // Reset l'import si on ferme
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Intégrer les données de Messagerie SSI</DialogTitle>
            <DialogDescription>Glissez un export brut (Excel/CSV) pour que l'algorithme ventile les données par mois, ou saisissez-les manuellement.</DialogDescription>
          </DialogHeader>

          {/* VUE 1 : RÉSULTAT DE L'IMPORT (Plusieurs mois détectés) */}
          {Object.keys(parsedMonths).length > 0 ? (
            <div className="space-y-4 mt-2">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4" />
                  Bilan de l'analyse ({Object.keys(parsedMonths).length} mois détectés)
                </h4>
                <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Mois</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Fraude</TableHead>
                        <TableHead>1212</TableHead>
                        <TableHead>Ext.</TableHead>
                        <TableHead>Erreurs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.values(parsedMonths).sort((a, b) => b.period.localeCompare(a.period)).map((s) => (
                        <TableRow key={s.period}>
                          <TableCell className="font-medium text-xs">{s.period}</TableCell>
                          <TableCell className="font-bold text-xs">{s.total}</TableCell>
                          <TableCell className="text-xs text-amber-600">{s.fraude}</TableCell>
                          <TableCell className="text-xs text-emerald-600">{s.interne1212}</TableCell>
                          <TableCell className="text-xs text-slate-500">{s.externe}</TableCell>
                          <TableCell className="text-xs text-rose-500">{s.erreur}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setParsedMonths({})}>
                  Annuler le fichier
                </Button>
                <Button onClick={() => saveStatsMutation.mutate()} disabled={saveStatsMutation.isPending}>
                  {saveStatsMutation.isPending ? "Enregistrement..." : "Valider l'importation de ces mois"}
                </Button>
              </DialogFooter>
            </div>
          ) : (

            /* VUE 2 : ZONE D'IMPORT ET SAISIE MANUELLE */
            <>
              <div className="mt-4 mb-2">
                <Label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-primary/50 rounded-lg cursor-pointer bg-primary/5 hover:bg-primary/10 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                    {isAnalyzing ? (
                      <Loader2 className="w-6 h-6 text-primary mb-2 animate-spin" />
                    ) : (
                      <Upload className="w-6 h-6 text-primary mb-2" />
                    )}
                    <p className="text-sm font-semibold text-primary">{isAnalyzing ? "Analyse en cours..." : "Glissez votre export brut (CSV / XLSX)"}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">L'algorithme lira la colonne Date et ventilera les compteurs mois par mois.</p>
                  </div>
                  <Input type="file" accept=".csv, .xlsx, .xls" className="hidden" disabled={isAnalyzing} onChange={handleFileUpload} />
                </Label>
              </div>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-border"></div>
                <span className="flex-shrink-0 mx-4 text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Ou Saisie Manuelle (1 mois)</span>
                <div className="flex-grow border-t border-border"></div>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); saveStatsMutation.mutate(); }} className="space-y-4">
                <div className="space-y-2">
                  <Label>Mois concerné</Label>
                  <Input type="month" required value={newStats.period} onChange={(e) => setNewStats({...newStats, period: e.target.value})} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-blue-600 dark:text-blue-400">Volume Total</Label>
                    <Input type="number" min="0" required value={newStats.total} onChange={(e) => setNewStats({...newStats, total: parseInt(e.target.value) || 0})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-amber-600 dark:text-amber-500">Menaces Fraude</Label>
                    <Input type="number" min="0" required value={newStats.fraude} onChange={(e) => setNewStats({...newStats, fraude: parseInt(e.target.value) || 0})} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-emerald-600 dark:text-emerald-400">Signalements 1212</Label>
                    <Input type="number" min="0" required value={newStats.interne1212} onChange={(e) => setNewStats({...newStats, interne1212: parseInt(e.target.value) || 0})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-600 dark:text-slate-400">Mails Externes</Label>
                    <Input type="number" min="0" required value={newStats.externe} onChange={(e) => setNewStats({...newStats, externe: parseInt(e.target.value) || 0})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-rose-600 dark:text-rose-400">Erreurs d'adressage (Bruit)</Label>
                  <Input type="number" min="0" required value={newStats.erreur} onChange={(e) => setNewStats({...newStats, erreur: parseInt(e.target.value) || 0})} />
                </div>

                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="button" variant="outline" onClick={() => setIsAddStatsOpen(false)}>Annuler</Button>
                  <Button type="submit" disabled={saveStatsMutation.isPending || isAnalyzing}>
                    {saveStatsMutation.isPending ? "Enregistrement..." : "Enregistrer manuellement"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}