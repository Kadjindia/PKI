import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Activity, ArrowLeft, Shield, Mail, Users, Server, FileLock,
  Plus, Trash2, BarChart3, LineChart as LineChartIcon,
  PieChart as PieChartIcon, Hash, UploadCloud, Check, Target, LayoutDashboard,
  FileSpreadsheet, Pencil, Calculator, Wand2, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell
} from "recharts";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

type WidgetType = 'kpi' | 'bar' | 'area' | 'pie';

interface CustomWidget {
  id: string;
  title: string;
  type: WidgetType;
  xAxisKey?: string;
  yAxisKey?: string;
  color?: string;
}

interface TrackedRisk {
  id: string;
  title: string;
  description: string;
  icon: string;
  data: any[];
  columns: string[];
  widgets: CustomWidget[];
}

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function RisksView() {
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);

  const [risks, setRisks] = useState<TrackedRisk[]>(() => {
    const saved = localStorage.getItem("tracked_risks_portfolio_v4");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => { localStorage.setItem("tracked_risks_portfolio_v4", JSON.stringify(risks)); }, [risks]);

  // --- ÉTATS DU WIZARD DE CRÉATION ---
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftIcon, setDraftIcon] = useState("shield");

  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false); // <-- ÉTAT DE CHARGEMENT

  const [draftData, setDraftData] = useState<any[]>([]);
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [draftWidgets, setDraftWidgets] = useState<CustomWidget[]>([]);
  const [newWidget, setNewWidget] = useState<Partial<CustomWidget>>({ type: 'bar', color: '#3b82f6' });

  // --- ÉTATS DU MOTEUR DE CALCUL (POWER QUERY) ---
  const [calcName, setCalcName] = useState("");
  const [calcCol1, setCalcCol1] = useState("");
  const [calcOp, setCalcOp] = useState("+");
  const [calcCol2Type, setCalcCol2Type] = useState<"column" | "constant">("column");
  const [calcCol2, setCalcCol2] = useState("");
  const [calcConstant, setCalcConstant] = useState("");
  const [appliedFormulas, setAppliedFormulas] = useState<string[]>([]);

  // --- ÉTATS POUR L'ÉDITION D'UN VISUEL ---
  const [isEditWidgetOpen, setIsEditWidgetOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Partial<CustomWidget>>({});

  // --- LOGIQUE D'IMPORT EXCEL/CSV AVEC CHARGEMENT ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true); // Déclenche l'animation de chargement

    const reader = new FileReader();
    reader.onload = (event) => {
      // On utilise un petit délai (setTimeout) pour laisser le temps à React
      // de dessiner le "Loader" avant que XLSX.read ne bloque le navigateur.
      setTimeout(() => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });

          setWorkbook(wb);
          setSheetNames(wb.SheetNames);

          if (wb.SheetNames.length > 0) {
            const firstSheet = wb.SheetNames[0];
            setSelectedSheet(firstSheet);
            extractDataFromSheet(wb, firstSheet);
            toast.success(`Fichier chargé ! ${wb.SheetNames.length} feuille(s) détectée(s).`);
          }
        } catch (err) {
          toast.error("Impossible de lire ce fichier. Format non supporté.");
        } finally {
          setIsImporting(false); // Arrête le chargement dans tous les cas
        }
      }, 100);
    };

    reader.onerror = () => {
      toast.error("Erreur lors de la lecture du fichier.");
      setIsImporting(false);
    };

    reader.readAsArrayBuffer(file);
  };

  const extractDataFromSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const worksheet = wb.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (jsonData.length === 0) {
      toast.warning(`La feuille "${sheetName}" semble vide.`);
      setDraftData([]); setDraftColumns([]); return;
    }
    const headers = Object.keys(jsonData[0] as object);
    setDraftColumns(headers);
    setDraftData(jsonData);
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (workbook) {
      setIsImporting(true);
      setTimeout(() => {
        extractDataFromSheet(workbook, sheetName);
        setIsImporting(false);
      }, 100);
    }
  };

  // --- LOGIQUE DU CALCULATEUR (TRANSFORMER) ---
  const applyCalculation = () => {
    if (!calcName) return toast.error("Nom de la nouvelle colonne requis.");
    if (!calcCol1) return toast.error("Sélectionnez la première colonne.");
    if (calcCol2Type === "column" && !calcCol2) return toast.error("Sélectionnez la deuxième colonne.");
    if (calcCol2Type === "constant" && isNaN(Number(calcConstant))) return toast.error("La constante doit être un nombre valide.");

    const newData = draftData.map(row => {
      const val1 = Number(row[calcCol1]) || 0;
      const val2 = calcCol2Type === "column" ? (Number(row[calcCol2]) || 0) : Number(calcConstant);

      let result = 0;
      switch (calcOp) {
        case "+": result = val1 + val2; break;
        case "-": result = val1 - val2; break;
        case "*": result = val1 * val2; break;
        case "/": result = val2 !== 0 ? val1 / val2 : 0; break;
        case "%": result = val2 !== 0 ? (val1 / val2) * 100 : 0; break; // Ratio en pourcentage
      }

      return { ...row, [calcName]: Math.round(result * 100) / 100 };
    });

    setDraftData(newData);
    if (!draftColumns.includes(calcName)) {
      setDraftColumns([...draftColumns, calcName]);
    }

    setAppliedFormulas([...appliedFormulas, `${calcName} = ${calcCol1} ${calcOp} ${calcCol2Type === 'column' ? calcCol2 : calcConstant}`]);
    setCalcName(""); setCalcCol1(""); setCalcOp("+"); setCalcCol2(""); setCalcConstant("");
    toast.success(`Colonne calculée "${calcName}" ajoutée avec succès !`);
  };

  // --- WIZARD : AJOUT DE WIDGET ---
  const handleAddWidgetToDraft = () => {
    if (!newWidget.title) return toast.error("Le widget doit avoir un titre.");
    if (newWidget.type !== 'kpi' && (!newWidget.xAxisKey || !newWidget.yAxisKey)) return toast.error("Sélectionnez les colonnes X et Y.");
    if (newWidget.type === 'kpi' && !newWidget.yAxisKey) return toast.error("Sélectionnez la colonne de valeur pour le KPI.");

    setDraftWidgets([...draftWidgets, { id: `w_${Date.now()}`, ...newWidget } as CustomWidget]);
    setNewWidget({ type: 'bar', color: COLORS[(draftWidgets.length + 1) % COLORS.length] });
  };

  const handleSaveRisk = () => {
    const newRisk: TrackedRisk = {
      id: `risk_${Date.now()}`, title: draftTitle, description: draftDesc, icon: draftIcon,
      data: draftData, columns: draftColumns, widgets: draftWidgets
    };
    setRisks([...risks, newRisk]);
    setIsAddOpen(false);
    resetWizard();
    toast.success(`Le risque "${draftTitle}" a été généré !`);
  };

  const resetWizard = () => {
    setStep(1); setDraftTitle(""); setDraftDesc(""); setDraftIcon("shield");
    setWorkbook(null); setSheetNames([]); setSelectedSheet(""); setIsImporting(false);
    setDraftData([]); setDraftColumns([]); setDraftWidgets([]);
    setAppliedFormulas([]);
    setNewWidget({ type: 'bar', color: '#3b82f6' });
  };

  const handleDeleteRisk = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setRisks(risks.filter(r => r.id !== id));
    if (selectedRiskId === id) setSelectedRiskId(null);
  };

  // --- ÉDITION À CHAUD ---
  const openAddWidgetModal = () => {
    const currentRisk = risks.find(r => r.id === selectedRiskId);
    if (!currentRisk) return;
    setEditingWidget({ type: 'bar', color: COLORS[currentRisk.widgets.length % COLORS.length] });
    setIsEditWidgetOpen(true);
  };

  const openEditWidgetModal = (widget: CustomWidget) => {
    setEditingWidget({ ...widget });
    setIsEditWidgetOpen(true);
  };

  const saveEditedWidget = () => {
    if (!editingWidget.title) return toast.error("Le titre est requis.");
    if (editingWidget.type !== 'kpi' && (!editingWidget.xAxisKey || !editingWidget.yAxisKey)) return toast.error("Colonnes X et Y requises.");
    if (editingWidget.type === 'kpi' && !editingWidget.yAxisKey) return toast.error("Colonne Y requise pour un KPI.");

    const updatedRisks = risks.map(r => {
      if (r.id === selectedRiskId) {
        const isExisting = r.widgets.some(w => w.id === editingWidget.id);
        let newWidgets;
        if (isExisting) {
          newWidgets = r.widgets.map(w => w.id === editingWidget.id ? editingWidget as CustomWidget : w);
        } else {
          newWidgets = [...r.widgets, { ...editingWidget, id: `w_${Date.now()}` } as CustomWidget];
        }
        return { ...r, widgets: newWidgets };
      }
      return r;
    });

    setRisks(updatedRisks);
    setIsEditWidgetOpen(false);
    toast.success("Tableau de bord mis à jour !");
  };

  const deleteEditedWidget = () => {
    if (!editingWidget.id) return;
    const updatedRisks = risks.map(r => {
      if (r.id === selectedRiskId) return { ...r, widgets: r.widgets.filter(w => w.id !== editingWidget.id) };
      return r;
    });
    setRisks(updatedRisks);
    setIsEditWidgetOpen(false);
    toast.success("Visuel supprimé du tableau de bord !");
  };

  // --- MOTEUR DE RENDU DES GRAPHIQUES ---
  const renderWidget = (widget: CustomWidget, data: any[]) => {
    if (widget.type === 'kpi') {
      const lastRow = data[data.length - 1];
      const val = lastRow ? lastRow[widget.yAxisKey!] : 0;
      return (
        <div className="flex flex-col h-full justify-center">
          <div className="text-4xl font-black" style={{ color: widget.color }}>{val}</div>
          <p className="text-xs text-muted-foreground mt-2 uppercase font-bold truncate" title={widget.yAxisKey}>{widget.yAxisKey}</p>
        </div>
      );
    }

    return (
      <div className="h-[220px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          {widget.type === 'bar' ? (
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey={widget.xAxisKey} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
              <Bar dataKey={widget.yAxisKey!} fill={widget.color} radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : widget.type === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey={widget.xAxisKey} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
              <Area type="monotone" dataKey={widget.yAxisKey!} stroke={widget.color} fill={widget.color} fillOpacity={0.2} strokeWidth={2} />
            </AreaChart>
          ) : (
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey={widget.yAxisKey!} nameKey={widget.xAxisKey!}>
                {data.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  };

  const selectedRisk = risks.find(r => r.id === selectedRiskId);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER FIXE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/50">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" /> Portefeuille des Risques
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Créez et surveillez vos propres domaines de risques avec des tableaux de bord sur-mesure.</p>
        </div>

        {/* BOUTON WIZARD : AJOUTER UN RISQUE */}
        {!selectedRisk && (
          <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(!open) resetWizard(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Ajouter un Risque à suivre</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">

              {/* ETAPE 1 : IDENTITÉ */}
              {step === 1 && (
                <div className="space-y-4 py-4">
                  <DialogHeader><DialogTitle>Étape 1 : Identité du Risque</DialogTitle></DialogHeader>
                  <div className="space-y-2"><Label>Nom du risque</Label><Input placeholder="Ex: Menace Phishing & VAP" value={draftTitle} onChange={e => setDraftTitle(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Description / Scénario</Label><Input placeholder="Ex: Risque de compromission des VIP..." value={draftDesc} onChange={e => setDraftDesc(e.target.value)} /></div>
                  <div className="space-y-2">
                    <Label>Icône représentative</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draftIcon} onChange={e => setDraftIcon(e.target.value)}>
                      <option value="shield">Général (Bouclier)</option><option value="mail">Messagerie (Email)</option>
                      <option value="users">Identités (Utilisateurs)</option><option value="server">Infrastructure (Serveur)</option>
                      <option value="filelock">Tiers (Cadenas)</option>
                    </select>
                  </div>
                  <Button onClick={() => draftTitle ? setStep(2) : toast.error("Le titre est requis")} className="w-full mt-4">Suivant : Importer les données</Button>
                </div>
              )}

              {/* ETAPE 2 : IMPORT DONNÉES */}
              {step === 2 && (
                <div className="space-y-6 py-4">
                  <DialogHeader><DialogTitle>Étape 2 : Source des Données (.xlsx, .csv)</DialogTitle></DialogHeader>

                  {isImporting ? (
                    <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-muted/10 flex flex-col items-center justify-center">
                      <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                      <h3 className="font-bold text-foreground mb-1">Analyse du fichier en cours...</h3>
                      <p className="text-xs text-muted-foreground">Veuillez patienter, cela peut prendre quelques instants pour les gros fichiers.</p>
                    </div>
                  ) : sheetNames.length === 0 ? (
                    <div className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer relative">
                      <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                      <FileSpreadsheet className="w-12 h-12 text-primary opacity-50 mx-auto mb-4" />
                      <h3 className="font-bold text-foreground mb-1">Cliquez ou glissez un fichier Excel / CSV</h3>
                      <p className="text-xs text-muted-foreground">Supporte les classeurs à multiples onglets.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 bg-primary/5 p-4 rounded-xl border border-primary/20">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="w-8 h-8 text-primary" />
                        <div><h4 className="font-bold text-sm">Fichier chargé</h4><p className="text-xs text-muted-foreground">{sheetNames.length} feuille(s) disponible(s)</p></div>
                      </div>
                      <div className="space-y-2 pt-2 border-t border-primary/10">
                        <Label>Sélectionnez l'onglet (Feuille) à analyser :</Label>
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedSheet} onChange={e => handleSheetChange(e.target.value)}>
                          {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep(1)} className="flex-1" disabled={isImporting}>Retour</Button>
                    <Button onClick={() => setStep(3)} disabled={draftData.length === 0 || isImporting} className="flex-1">Suivant : Transformer les données</Button>
                  </div>
                </div>
              )}

              {/* ETAPE 3 : TRANSFORMER (POWER QUERY) */}
              {step === 3 && (
                <div className="space-y-6 py-4">
                  <DialogHeader>
                    <DialogTitle>Étape 3 : Transformer les données (Calculateur)</DialogTitle>
                    <DialogDescription>Créez de nouvelles colonnes à partir des données existantes (Ex: Calculer un Taux de clic = Clics / Envois).</DialogDescription>
                  </DialogHeader>

                  <div className="bg-secondary/30 p-4 rounded-xl border border-border space-y-4">
                    <h4 className="text-sm font-bold flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" /> Ajouter une formule</h4>

                    <div className="grid grid-cols-12 gap-3 items-end">
                      <div className="col-span-3 space-y-1">
                        <Label className="text-[10px] uppercase">Nouvelle colonne</Label>
                        <Input size={1} placeholder="Ex: Taux (%)" value={calcName} onChange={e => setCalcName(e.target.value)} />
                      </div>

                      <div className="col-span-1 flex justify-center pb-2 font-bold text-muted-foreground">=</div>

                      <div className="col-span-3 space-y-1">
                        <Label className="text-[10px] uppercase">Colonne A</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" value={calcCol1} onChange={e => setCalcCol1(e.target.value)}>
                          <option value="">Choisir...</option>{draftColumns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      <div className="col-span-2 space-y-1">
                        <Label className="text-[10px] uppercase">Opération</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-bold text-center" value={calcOp} onChange={e => setCalcOp(e.target.value)}>
                          <option value="+"> + </option>
                          <option value="-"> - </option>
                          <option value="*"> * </option>
                          <option value="/"> / </option>
                          <option value="%"> % (Ratio)</option>
                        </select>
                      </div>

                      <div className="col-span-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[10px] uppercase">Colonne B</Label>
                          <button onClick={() => setCalcCol2Type(t => t === 'column' ? 'constant' : 'column')} className="text-[9px] text-primary hover:underline">
                            {calcCol2Type === 'column' ? 'Changer > Nb fixe' : 'Changer > Colonne'}
                          </button>
                        </div>
                        {calcCol2Type === 'column' ? (
                          <select className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" value={calcCol2} onChange={e => setCalcCol2(e.target.value)}>
                            <option value="">Choisir...</option>{draftColumns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <Input size={1} type="number" placeholder="Ex: 100" value={calcConstant} onChange={e => setCalcConstant(e.target.value)} />
                        )}
                      </div>
                    </div>
                    <Button size="sm" onClick={applyCalculation} className="w-full mt-2"><Wand2 className="w-4 h-4 mr-2" /> Appliquer la formule</Button>
                  </div>

                  {appliedFormulas.length > 0 && (
                    <div className="text-xs space-y-2">
                      <p className="font-bold text-muted-foreground uppercase">Colonnes calculées générées :</p>
                      <ul className="space-y-1">
                        {appliedFormulas.map((f, i) => (
                          <li key={i} className="bg-primary/10 text-primary px-2 py-1 rounded inline-block mr-2">{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4 border-t border-border">
                    <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Retour</Button>
                    <Button onClick={() => setStep(4)} className="flex-1">Suivant : Créer les visuels</Button>
                  </div>
                </div>
              )}

              {/* ETAPE 4 : WIDGETS */}
              {step === 4 && (
                <div className="space-y-6 py-4">
                  <DialogHeader>
                    <DialogTitle>Étape 4 : Construction du Tableau de Bord</DialogTitle>
                    <DialogDescription>Créez vos visuels en utilisant les colonnes du fichier Excel et vos nouvelles colonnes calculées.</DialogDescription>
                  </DialogHeader>

                  <div className="bg-secondary/30 p-4 rounded-xl border border-border space-y-4">
                    <h4 className="text-sm font-bold flex items-center gap-2"><LayoutDashboard className="w-4 h-4 text-primary" /> Ajouter un indicateur graphique</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase">Titre du graphique</Label>
                        <Input size={1} value={newWidget.title || ''} onChange={e => setNewWidget({...newWidget, title: e.target.value})} placeholder="Ex: Taux de clics" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase">Type de visuel</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={newWidget.type} onChange={e => setNewWidget({...newWidget, type: e.target.value as WidgetType})}>
                          <option value="kpi">Chiffre Clé (KPI)</option><option value="area">Courbe de tendance</option>
                          <option value="bar">Graphique en Barres</option><option value="pie">Répartition (Camembert)</option>
                        </select>
                      </div>
                      {newWidget.type !== 'kpi' && (
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase">Axe X (Catégorie)</Label>
                          <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={newWidget.xAxisKey || ''} onChange={e => setNewWidget({...newWidget, xAxisKey: e.target.value})}>
                            <option value="">Choisir...</option>{draftColumns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase">Axe Y (Valeur)</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={newWidget.yAxisKey || ''} onChange={e => setNewWidget({...newWidget, yAxisKey: e.target.value})}>
                          <option value="">Choisir...</option>{draftColumns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <Button size="sm" onClick={handleAddWidgetToDraft} className="w-full mt-2"><Check className="w-4 h-4 mr-2" /> Ajouter ce visuel</Button>
                  </div>

                  {draftWidgets.length > 0 && (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      {draftWidgets.map(w => (
                        <Card key={w.id} className="shadow-sm">
                          <CardHeader className="p-3 pb-0"><CardTitle className="text-xs uppercase text-muted-foreground truncate">{w.title}</CardTitle></CardHeader>
                          <CardContent className="p-3">{renderWidget(w, draftData)}</CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4 border-t border-border">
                    <Button variant="outline" onClick={() => setStep(3)} className="flex-1">Retour aux formules</Button>
                    <Button onClick={handleSaveRisk} className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={draftWidgets.length === 0}>Sauvegarder et Terminer</Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* VUE 1 : LE PORTEFEUILLE DES RISQUES (LA LISTE) */}
      {!selectedRisk && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2">
          {risks.map((risk) => {
            const Icon = risk.icon === 'mail' ? Mail : risk.icon === 'users' ? Users : risk.icon === 'server' ? Server : risk.icon === 'filelock' ? FileLock : Shield;
            return (
              <Card key={risk.id} onClick={() => setSelectedRiskId(risk.id)} className="group cursor-pointer hover:shadow-md transition-all border-l-4 border-l-primary hover:-translate-y-1 relative">
                <button onClick={(e) => handleDeleteRisk(e, risk.id)} className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-rose-100 hover:text-rose-600 transition-all z-10"><Trash2 className="w-4 h-4" /></button>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4 pr-8">
                    <div className="p-2.5 rounded-lg bg-primary/10 text-primary"><Icon className="w-6 h-6" /></div>
                    <div>
                      <h3 className="font-bold text-lg text-foreground truncate max-w-[200px]" title={risk.title}>{risk.title}</h3>
                      <Badge variant="secondary" className="mt-1 font-normal text-[10px]">{risk.widgets.length} indicateurs configurés</Badge>
                    </div>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-sm text-muted-foreground leading-relaxed h-16 line-clamp-2">
                    {risk.description || "Aucune description définie."}
                  </div>
                  <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/50 text-xs font-bold text-primary">
                    <span className="text-muted-foreground font-medium text-[10px] uppercase">Données importées ({risk.data.length} lignes)</span>
                    <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">Accéder au Dashboard <ArrowLeft className="w-3 h-3 rotate-180" /></span>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {risks.length === 0 && (
            <div className="md:col-span-2 xl:col-span-3 py-16 text-center border-2 border-dashed border-border rounded-xl">
              <LayoutDashboard className="w-12 h-12 text-muted-foreground opacity-20 mx-auto mb-4" />
              <h3 className="font-bold text-xl text-foreground">Aucun risque n'est actuellement suivi</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">Créez votre premier domaine de risque, importez votre fichier de données, et construisez son tableau de bord sur-mesure.</p>
              <Button onClick={() => setIsAddOpen(true)} size="lg"><Plus className="w-5 h-5 mr-2" /> Déclarer un nouveau risque</Button>
            </div>
          )}
        </div>
      )}

      {/* VUE 2 : LE TABLEAU DE BORD DÉDIÉ AU RISQUE SÉLECTIONNÉ (ÉDITABLE) */}
      {selectedRisk && (
        <div className="animate-in slide-in-from-right-4 duration-300">

          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setSelectedRiskId(null)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"><ArrowLeft className="w-4 h-4" /> Retour au Portefeuille</button>
            <Button size="sm" onClick={openAddWidgetModal} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Plus className="w-4 h-4 mr-2"/> Ajouter un visuel</Button>
          </div>

          <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border/50">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                {selectedRisk.icon === 'mail' ? <Mail className="w-8 h-8" /> : selectedRisk.icon === 'users' ? <Users className="w-8 h-8" /> : selectedRisk.icon === 'server' ? <Server className="w-8 h-8" /> : selectedRisk.icon === 'filelock' ? <FileLock className="w-8 h-8" /> : <Shield className="w-8 h-8" />}
              </div>
              <div>
                <h2 className="text-3xl font-black text-foreground tracking-tight">{selectedRisk.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{selectedRisk.description}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {selectedRisk.widgets.map((widget) => (
              <Card key={widget.id} className={`shadow-sm group relative ${widget.type === 'area' || widget.type === 'bar' ? 'md:col-span-2' : ''}`}>
                <button
                  onClick={() => openEditWidgetModal(widget)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-background shadow-sm border text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-all z-10"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-border/30">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground truncate pr-6">{widget.title}</CardTitle>
                  {widget.type === 'kpi' && <Hash className="w-4 h-4 text-muted-foreground/30" />}
                  {widget.type === 'bar' && <BarChart3 className="w-4 h-4 text-muted-foreground/30" />}
                  {widget.type === 'area' && <LineChartIcon className="w-4 h-4 text-muted-foreground/30" />}
                  {widget.type === 'pie' && <PieChartIcon className="w-4 h-4 text-muted-foreground/30" />}
                </CardHeader>
                <CardContent className="pt-4">
                  {renderWidget(widget, selectedRisk.data)}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* DIALOG D'ÉDITION / AJOUT DE WIDGET */}
          <Dialog open={isEditWidgetOpen} onOpenChange={setIsEditWidgetOpen}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{editingWidget.id ? "Modifier le visuel" : "Ajouter un nouveau visuel"}</DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Titre du graphique / KPI</Label>
                  <Input value={editingWidget.title || ''} onChange={e => setEditingWidget({...editingWidget, title: e.target.value})} placeholder="Ex: Évolution Mensuelle" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type de visuel</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editingWidget.type || 'bar'} onChange={e => setEditingWidget({...editingWidget, type: e.target.value as WidgetType})}>
                      <option value="kpi">Chiffre Clé (KPI)</option>
                      <option value="area">Courbe (Évolution)</option>
                      <option value="bar">Graphique en Barres</option>
                      <option value="pie">Camembert (Répartition)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Couleur principale</Label>
                    <div className="flex gap-2 mt-2">
                      {COLORS.map(c => (
                        <button key={c} onClick={() => setEditingWidget({...editingWidget, color: c})} className={`w-6 h-6 rounded-full transition-transform ${editingWidget.color === c ? 'scale-125 ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="space-y-2">
                    <Label className={editingWidget.type === 'kpi' ? 'opacity-50' : ''}>Axe X (Catégories / Dates)</Label>
                    <select disabled={editingWidget.type === 'kpi'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" value={editingWidget.xAxisKey || ''} onChange={e => setEditingWidget({...editingWidget, xAxisKey: e.target.value})}>
                      <option value="">Sélectionner...</option>
                      {selectedRisk.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Axe Y (Valeur numérique)</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editingWidget.yAxisKey || ''} onChange={e => setEditingWidget({...editingWidget, yAxisKey: e.target.value})}>
                      <option value="">Sélectionner...</option>
                      {selectedRisk.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex justify-between items-center w-full mt-4">
                {editingWidget.id ? <Button variant="destructive" onClick={deleteEditedWidget} className="gap-2"><Trash2 className="w-4 h-4" /> Supprimer</Button> : <div />}
                <Button onClick={saveEditedWidget}><Check className="w-4 h-4 mr-2"/> Enregistrer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      )}

    </div>
  );
}