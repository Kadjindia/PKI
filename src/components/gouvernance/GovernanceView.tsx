import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPolicies, createPolicy, deletePolicy, updatePolicy, Policy, fetchGaps, createGap, updateGapStatus, PolicyGap } from "@/lib/supabase-governance";
import { toast } from "sonner";

// --- COMPOSANTS UI (shadcn/ui) ---
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// --- ICÔNES ---
import { ShieldCheck, AlertTriangle, FileText, Activity, Plus, Trash2, Loader2, CheckCircle2, CalendarDays } from "lucide-react";

// ============================================================================
// 1. FONCTIONS UTILITAIRES ET RÈGLES MÉTIER
// ============================================================================

/**
 * Formate une date au format français (JJ/MM/AAAA)
 */
const formatFrDate = (dateStr: string | null) => {
  if (!dateStr) return "Non définie";
  return new Date(dateStr).toLocaleDateString("fr-FR");
};

/**
 * Détermine le statut dynamique de la politique en fonction des dates.
 * Compare la date de prochaine revue avec la date du jour.
 */
const getDynamicStatus = (lastDate: string | null, freqMonths: number, manualStatus: string) => {
  if (manualStatus === "draft") return "draft"; // Forcé par l'utilisateur
  if (!lastDate) return "warning"; // Pas de date = Attention

  // Ajoute la fréquence (ex: 24 mois) à la date de dernière revue
  const nextDate = new Date(lastDate);
  nextDate.setMonth(nextDate.getMonth() + (freqMonths || 24));

  // Différence en jours entre aujourd'hui et la prochaine échéance
  const today = new Date();
  const diffTime = nextDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "expired"; // Dépassé
  if (diffDays <= 60) return "warning"; // Reste 30 jours ou moins
  return "ok"; // Tout va bien
};

/**
 * Calcule la date exacte de la prochaine revue (Format Texte)
 */
const calculateNextReview = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "À planifier";
  const d = new Date(lastDate);
  d.setMonth(d.getMonth() + (freqMonths || 24));
  return d.toLocaleDateString("fr-FR");
};

/**
 * NOUVEAU : Calcule le score de conformité d'une politique.
 * Règle 1 : Si expirée -> 0%
 * Règle 2 : Sinon, 100% - pénalités des écarts ouverts.
 */
const calculateDynamicCompliance = (policy: Policy, allGaps: PolicyGap[]) => {
  // Règle 1 : La politique a expiré
  const status = getDynamicStatus(policy.lastReviewDate, policy.reviewFrequencyMonths, policy.status);
  if (status === "expired") {
    return 0; // Sanction immédiate
  }

  // Règle 2 : Déduction selon les écarts
  let score = 100;
  const openGaps = allGaps.filter(g => g.policyId === policy.id && g.status !== 'resolu');

  openGaps.forEach(gap => {
    switch(gap.severity) {
      case 'critique': score -= 20; break;
      case 'eleve': score -= 10; break;
      case 'moyen': score -= 5; break;
      case 'faible': score -= 2; break;
    }
  });

  return Math.max(0, score); // Le score ne descend pas sous 0
};

// --- Utilitaires de design (Badges) ---
const getStatusBadge = (status: string) => {
  switch (status) {
    case "ok": return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-200">À jour</Badge>;
    case "warning": return <Badge className="bg-amber-500/15 text-amber-600 border-amber-200">À revoir bientôt</Badge>;
    case "expired": return <Badge className="bg-rose-500/15 text-rose-600 border-rose-200">Expirée</Badge>;
    case "draft": return <Badge className="bg-slate-500/15 text-slate-600 border-slate-200">Brouillon</Badge>;
    default: return <Badge>Inconnu</Badge>;
  }
};

const getSeverityBadge = (severity: string) => {
  switch (severity) {
    case "critique": return <Badge className="bg-red-600 text-white border-red-700">Critique</Badge>;
    case "eleve": return <Badge className="bg-orange-500 text-white border-orange-600">Élevé</Badge>;
    case "moyen": return <Badge className="bg-yellow-500 text-white border-yellow-600">Moyen</Badge>;
    default: return <Badge className="bg-slate-500 text-white border-slate-600">Faible</Badge>;
  }
};

// ============================================================================
// 2. COMPOSANT PRINCIPAL (La Vue)
// ============================================================================
export default function GovernanceView() {
  const queryClient = useQueryClient();

  // --- ÉTATS GLOBAUX (Ce qui est affiché ou sélectionné) ---
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);

  // --- ÉTATS DES MODALES (Ouvert / Fermé) ---
  const [isAddPolicyOpen, setIsAddPolicyOpen] = useState(false);
  const [isAddGapOpen, setIsAddGapOpen] = useState(false);
  const [policyToUpdate, setPolicyToUpdate] = useState<Policy | null>(null);
  const [policyToDelete, setPolicyToDelete] = useState<Policy | null>(null);
  const [gapToClose, setGapToClose] = useState<string | null>(null);

  // --- ÉTATS DES FORMULAIRES (Les données saisies par l'utilisateur) ---
  const [newPolicy, setNewPolicy] = useState({ name: "", lastReviewDate: "", status: "ok" });
  const [newGap, setNewGap] = useState({ description: "", severity: "moyen", status: "ouvert" });

  // ============================================================================
  // 3. SYNCHRONISATION AVEC LA BASE DE DONNÉES (Supabase)
  // ============================================================================

  // LECTURE : Récupération des politiques et des écarts
  const { data: policies = [], isLoading: isLoadingPolicies } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });
  const { data: gaps = [], isLoading: isLoadingGaps } = useQuery({ queryKey: ['gaps'], queryFn: fetchGaps });

  // ÉCRITURE : Créer une politique
  const createPolicyMutation = useMutation({
    mutationFn: createPolicy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] }); // Rafraîchit les données
      toast.success("Politique ajoutée");
      setIsAddPolicyOpen(false); // Ferme la modale
      setNewPolicy({ name: "", lastReviewDate: "", status: "ok" }); // Vide le formulaire
    }
  });

  // ÉCRITURE : Mettre à jour une politique (ex: Date de revue)
  const updatePolicyMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string, updates: Partial<Policy> }) => updatePolicy(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      toast.success("Date de revue mise à jour ! Le statut a été recalculé.");
    }
  });

  // ÉCRITURE : Supprimer une politique
  const deletePolicyMutation = useMutation({
    mutationFn: deletePolicy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['gaps'] });
      toast.success("Politique supprimée définitivement.");
      setSelectedPolicy(null);
    }
  });

  // ÉCRITURE : Déclarer un écart
  const createGapMutation = useMutation({
    mutationFn: createGap,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gaps'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      toast.success("Écart déclaré");
      setIsAddGapOpen(false);
      setNewGap({ description: "", severity: "moyen", status: "ouvert" });
    }
  });

  // ÉCRITURE : Clôturer un écart
  const updateGapMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: any }) => updateGapStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gaps'] });
      toast.success("Écart clôturé avec succès. Le score de conformité a été mis à jour.");
    }
  });

  // ============================================================================
  // 4. CALCULS GLOBAUX (Pour les cartes du haut)
  // ============================================================================
  const totalPolicies = policies.length;

  // Moyenne de conformité de tout le référentiel
  const avgCompliance = totalPolicies > 0
    ? Math.round(policies.reduce((acc, p) => acc + calculateDynamicCompliance(p, gaps), 0) / totalPolicies)
    : 0;

  // Comptage des écarts (uniquement ceux qui ne sont pas résolus)
  const activeGaps = gaps.filter(g => g.status !== 'resolu');
  const openGapsCount = activeGaps.length;
  const criticalGapsCount = activeGaps.filter(g => g.severity === "critique").length;

  // Comptage des politiques saines (Statut 'ok')
  const okPoliciesCount = policies.filter(p =>
    getDynamicStatus(p.lastReviewDate, p.reviewFrequencyMonths, p.status) === 'ok'
  ).length;

  // Score de la politique actuellement ouverte dans le panneau
  const selectedPolicyCompliance = selectedPolicy ? calculateDynamicCompliance(selectedPolicy, gaps) : 0;

  // ============================================================================
  // 5. GESTION DES SOUMISSIONS DE FORMULAIRES
  // ============================================================================
  const handleCreatePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPolicy.name) return toast.error("Nom obligatoire");
    createPolicyMutation.mutate({
      name: newPolicy.name,
      lastReviewDate: newPolicy.lastReviewDate || new Date().toISOString().split('T')[0],
      status: newPolicy.status as any,
      reviewFrequencyMonths: 24 // Fixé à 2 ans par défaut
    });
  };

  const handleCreateGap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPolicy) return;
    if (!newGap.description) return toast.error("Description obligatoire");
    createGapMutation.mutate({
      policyId: selectedPolicy.id,
      description: newGap.description,
      severity: newGap.severity as any,
      status: newGap.status as any
    });
  };

  // Affichage d'un loader pendant que Supabase répond
  if (isLoadingPolicies || isLoadingGaps) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  // ============================================================================
  // 6. RENDU DE L'INTERFACE UTILISATEUR (JSX)
  // ============================================================================
  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* --- ZONE A : CARTES DE SYNTHÈSE EXECUTIVE --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Carte : Référentiel */}
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Santé du Référentiel</CardTitle>
            <FileText className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{okPoliciesCount} / {totalPolicies}</div>
            <p className="text-xs text-muted-foreground mt-1">Politiques à jour</p>
          </CardContent>
        </Card>

        {/* Carte : Score Global */}
        <Card className={`border-l-4 shadow-sm ${avgCompliance >= 80 ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Score Conformité</CardTitle>
            <ShieldCheck className={`w-4 h-4 ${avgCompliance >= 80 ? 'text-emerald-500' : 'text-amber-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgCompliance}%</div>
            <Progress value={avgCompliance} className="h-2 mt-2" />
          </CardContent>
        </Card>

        {/* Carte : Écarts globaux */}
        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Plan d'Action</CardTitle>
            <Activity className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openGapsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Écarts ouverts (non résolus)</p>
          </CardContent>
        </Card>

        {/* Carte : Urgences */}
        <Card className={`border-l-4 shadow-sm ${criticalGapsCount > 0 ? 'border-l-rose-600 bg-rose-50/50' : 'border-l-slate-200'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className={`text-sm font-medium ${criticalGapsCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>Urgences</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${criticalGapsCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${criticalGapsCount > 0 ? 'text-rose-600' : ''}`}>{criticalGapsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Écarts critiques actifs</p>
          </CardContent>
        </Card>
      </div>

      {/* --- ZONE B & C : CORPS PRINCIPAL (Onglets Tableau/Écarts) --- */}
      <Card className="shadow-sm">
        <Tabs defaultValue="policies" className="w-full">
          {/* En-tête des onglets */}
          <div className="px-6 pt-4 border-b border-border flex justify-between items-end">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="policies" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Référentiel des Politiques
              </TabsTrigger>
              <TabsTrigger value="gaps" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Registre des Écarts ({openGapsCount})
              </TabsTrigger>
            </TabsList>
            <Button className="mb-2" size="sm" onClick={() => setIsAddPolicyOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Ajouter une politique
            </Button>
          </div>

          {/* ONGLET 1 : Liste des politiques (Le Tableau) */}
          <TabsContent value="policies" className="m-0">
            {policies.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucune politique dans le référentiel.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Nom de la politique</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Dernière Revue</TableHead>
                    <TableHead>Prochaine Revue</TableHead>
                    <TableHead className="w-[180px]">Conformité</TableHead>
                    <TableHead className="text-right">Écarts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map((policy) => {
                    const policyGapsCount = gaps.filter(g => g.policyId === policy.id && g.status !== 'resolu').length;
                    const dynamicStatus = getDynamicStatus(policy.lastReviewDate, policy.reviewFrequencyMonths, policy.status);
                    const dynamicCompliance = calculateDynamicCompliance(policy, gaps); // Recalculé avec la nouvelle règle

                    return (
                      <TableRow key={policy.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedPolicy(policy)}>
                        <TableCell className="font-medium">{policy.name}</TableCell>
                        <TableCell>{getStatusBadge(dynamicStatus)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatFrDate(policy.lastReviewDate)}</TableCell>
                        <TableCell className="text-sm font-medium flex items-center gap-1.5">
                          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                          {calculateNextReview(policy.lastReviewDate, policy.reviewFrequencyMonths)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={dynamicCompliance} className={`h-2 ${dynamicCompliance < 50 ? '[&>div]:bg-rose-500' : dynamicCompliance < 80 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`} />
                            <span className="text-xs font-medium w-8">{dynamicCompliance}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {policyGapsCount > 0 ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">{policyGapsCount} écarts</Badge>
                          ) : <span className="text-xs text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ONGLET 2 : Liste de TOUS les écarts ouverts */}
          <TabsContent value="gaps" className="m-0 p-4">
            {activeGaps.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground"><p>Aucun écart actif ! Tout est conforme.</p></div>
            ) : (
              <div className="space-y-4">
                {activeGaps.map(gap => {
                  const policy = policies.find(p => p.id === gap.policyId);
                  return (
                    <div key={gap.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
                      <div className="flex items-start gap-4">
                        {getSeverityBadge(gap.severity)}
                        <div>
                          <p className="font-medium text-sm">{gap.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">Politique : {policy?.name || "Inconnue"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{gap.status}</Badge>
                        <Button variant="ghost" size="sm" onClick={() => setGapToClose(gap.id)}>
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" /> Clôturer
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* --- ZONE D : PANNEAU LATÉRAL COULISSANT (Détails d'une politique) --- */}
      <Sheet open={!!selectedPolicy} onOpenChange={(open) => !open && setSelectedPolicy(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl">{selectedPolicy?.name}</SheetTitle>
            <SheetDescription>Détails et suivi</SheetDescription>
          </SheetHeader>

          {selectedPolicy && (
            <div className="space-y-6">

              {/* En-tête du panneau : Statut & Score */}
              <div className="flex items-center gap-4 p-4 rounded-lg bg-secondary/50">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Statut</p>
                  {getStatusBadge(getDynamicStatus(selectedPolicy.lastReviewDate, selectedPolicy.reviewFrequencyMonths, selectedPolicy.status))}
                </div>
                <div className="space-y-1 border-l pl-4 border-border">
                  <p className="text-xs text-muted-foreground">Conformité</p>
                  <p className="text-lg font-bold" style={{ color: selectedPolicyCompliance < 50 ? 'var(--destructive)' : selectedPolicyCompliance < 80 ? '#f59e0b' : '#10b981' }}>
                    {selectedPolicyCompliance}%
                  </p>
                </div>
              </div>

              {/* Bloc Calendrier */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Calendrier</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="p-3 border border-border rounded-md">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Dernière revue</p>
                    <p className="font-medium text-xs">{formatFrDate(selectedPolicy.lastReviewDate)}</p>
                  </div>
                  <div className="p-3 border border-border rounded-md bg-muted/30">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Fréquence</p>
                    <p className="font-medium text-xs">{selectedPolicy.reviewFrequencyMonths} mois</p>
                  </div>
                  <div className="p-3 border border-primary/30 rounded-md bg-primary/5">
                    <p className="text-[10px] text-primary uppercase tracking-wider font-semibold mb-1">Prochaine revue</p>
                    <p className="font-bold text-xs text-primary">{calculateNextReview(selectedPolicy.lastReviewDate, selectedPolicy.reviewFrequencyMonths)}</p>
                  </div>
                </div>

                {/* Bouton pour réviser rapidement */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-3 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-700 border-emerald-200 text-emerald-600"
                  disabled={updatePolicyMutation.isPending}
                  onClick={() => setPolicyToUpdate(selectedPolicy)} // Déclenche la modale de confirmation
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Marquer comme révisée aujourd'hui
                </Button>
              </div>

              {/* Bloc Écarts liés à cette politique */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Écarts associés
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => setIsAddGapOpen(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Déclarer
                  </Button>
                </div>

                {gaps.filter(g => g.policyId === selectedPolicy.id && g.status !== 'resolu').length > 0 ? (
                  <div className="space-y-2">
                    {gaps.filter(g => g.policyId === selectedPolicy.id && g.status !== 'resolu').map(gap => (
                      <div key={gap.id} className="p-3 text-sm border border-border rounded-md bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(gap.severity)}
                            <span className="text-[10px] text-muted-foreground uppercase">{gap.status}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setGapToClose(gap.id)}>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          </Button>
                        </div>
                        <p>{gap.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic bg-muted/20 p-3 rounded-md border border-border text-center">Aucun écart actif sur cette politique.</p>
                )}
              </div>

              {/* Zone de Danger (Suppression) */}
              <div className="mt-12 pt-6 border-t border-border">
                <Button variant="destructive" className="w-full" onClick={() => setPolicyToDelete(selectedPolicy)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Supprimer du référentiel
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================================================================ */}
      {/* 7. MODALES DE FORMULAIRES ET CONFIRMATIONS */}
      {/* ============================================================================ */}

      {/* Créer Politique */}
      <Dialog open={isAddPolicyOpen} onOpenChange={setIsAddPolicyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouvelle Politique</DialogTitle></DialogHeader>
          <form onSubmit={handleCreatePolicy} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input required value={newPolicy.name} onChange={(e) => setNewPolicy({...newPolicy, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Date de dernière revue</Label>
              <Input type="date" value={newPolicy.lastReviewDate} onChange={(e) => setNewPolicy({...newPolicy, lastReviewDate: e.target.value})} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddPolicyOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={createPolicyMutation.isPending}>Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Créer Écart */}
      <Dialog open={isAddGapOpen} onOpenChange={setIsAddGapOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Déclarer un écart</DialogTitle><SheetDescription>Sur : {selectedPolicy?.name}</SheetDescription></DialogHeader>
          <form onSubmit={handleCreateGap} className="space-y-4">
            <div className="space-y-2">
              <Label>Description de la non-conformité</Label>
              <Textarea required placeholder="Ex: Revue des habilitations non effectuée..." value={newGap.description} onChange={(e) => setNewGap({...newGap, description: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Criticité (Impact direct sur le score)</Label>
              <Select value={newGap.severity} onValueChange={(v) => setNewGap({...newGap, severity: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faible">Faible (-2%)</SelectItem>
                  <SelectItem value="moyen">Moyen (-5%)</SelectItem>
                  <SelectItem value="eleve">Élevé (-10%)</SelectItem>
                  <SelectItem value="critique">Critique (-20%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddGapOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={createGapMutation.isPending}>Ajouter l'écart</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- CONFIRMATIONS D'ACTIONS CRITIQUES --- */}

      {/* Confirmation : Révision documentaire */}
      <AlertDialog open={!!policyToUpdate} onOpenChange={(open) => !open && setPolicyToUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la revue documentaire</AlertDialogTitle>
            <AlertDialogDescription>
              Vous êtes sur le point de marquer "{policyToUpdate?.name}" comme révisée à la date d'aujourd'hui.
              Cette action est irréversible et va automatiquement repousser la prochaine date de revue, <strong>et restaurer son score à 100% si elle était expirée.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                if (!policyToUpdate) return;
                const today = new Date().toISOString().split('T')[0];
                updatePolicyMutation.mutate({ id: policyToUpdate.id, updates: { lastReviewDate: today } });
                setSelectedPolicy({ ...policyToUpdate, lastReviewDate: today }); // MAJ locale immédiate
                setPolicyToUpdate(null);
              }}
            >
              Oui, marquer comme révisée
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation : Clôture d'écart */}
      <AlertDialog open={!!gapToClose} onOpenChange={(open) => !open && setGapToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clôturer l'écart</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmez-vous la clôture définitive de cet écart ?
              Il n'apparaîtra plus dans les compteurs et la politique récupérera ses points de conformité.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                if (!gapToClose) return;
                updateGapMutation.mutate({ id: gapToClose, status: 'resolu' });
                setGapToClose(null);
              }}
            >
              Oui, clôturer l'écart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation : Suppression d'une politique */}
      <AlertDialog open={!!policyToDelete} onOpenChange={(open) => !open && setPolicyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Suppression irréversible</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer définitivement la politique "{policyToDelete?.name}" du référentiel ?
              <strong> Tous les écarts associés seront également supprimés.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!policyToDelete) return;
                deletePolicyMutation.mutate(policyToDelete.id);
                setPolicyToDelete(null);
              }}
            >
              Oui, supprimer la politique
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}