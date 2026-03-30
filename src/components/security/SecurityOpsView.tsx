import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchProjects, createProject, updateProject, deleteProject,
  fetchApplications, createApplication, updateApplication, deleteApplication,
  fetchVulnerabilities, createVulnerability, updateVulnerabilityStatus,
  Project, Application, Vulnerability
} from "@/lib/supabase-security";
import { toast } from "sonner";

// --- COMPOSANTS UI (shadcn/ui) ---
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ShieldAlert, ShieldCheck, Rocket, Bug, Plus, AlertTriangle, Loader2, Trash2, CheckCircle2, Pencil, Network, FileSearch, Settings2 } from "lucide-react";

// ============================================================================
// 1. UTILITAIRES DE DESIGN ET DE CALCUL
// ============================================================================

/** Formate une date au format français (JJ/MM/AAAA) */
const formatFrDate = (dateStr: string | null) => {
  if (!dateStr) return "Non définie";
  return new Date(dateStr).toLocaleDateString("fr-FR");
};

/** Calcule la date du prochain audit et vérifie si elle est dépassée */
const calculateNextAudit = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "À planifier";
  const d = new Date(lastDate);
  d.setMonth(d.getMonth() + (freqMonths || 12));
  if (d < new Date()) return "Dépassé";
  return d.toLocaleDateString("fr-FR");
};

/** Renvoie le bon badge visuel selon le statut du PAS */
const getPasStatusBadge = (status: string) => {
  switch (status) {
    case "validated": return <Badge className="theme-badge-success">✅ Validé</Badge>;
    case "review": return <Badge className="theme-badge-info">👀 En revue SSI</Badge>;
    case "draft": return <Badge className="theme-badge-neutral">📝 En rédaction</Badge>;
    default: return <Badge className="theme-badge-neutral">Inconnu</Badge>;
  }
};

/** Renvoie le badge de couleur pour le risque métier d'un projet */
const getRiskBadge = (risk: string) => {
  switch (risk) {
    case "fort": return <Badge className="theme-badge-danger">Fort</Badge>;
    case "moyen": return <Badge className="theme-badge-warning">Moyen</Badge>;
    case "faible": return <Badge className="theme-badge-success">Faible</Badge>;
    default: return <Badge className="theme-badge-neutral">Inconnu</Badge>;
  }
};

/** Renvoie l'icône et le label adaptés au type d'audit */
const getAuditTypeInfo = (type: string) => {
  switch (type) {
    case "pentest": return { icon: <Bug className="w-3.5 h-3.5 mr-1 text-rose-500"/>, label: "Test d'intrusion" };
    case "architecture": return { icon: <Network className="w-3.5 h-3.5 mr-1 text-blue-500"/>, label: "Audit d'Architecture" };
    case "configuration": return { icon: <Settings2 className="w-3.5 h-3.5 mr-1 text-slate-500"/>, label: "Audit de Configuration" };
    case "gouvernance": return { icon: <FileSearch className="w-3.5 h-3.5 mr-1 text-amber-500"/>, label: "Audit Organisationnel" };
    default: return { icon: <ShieldAlert className="w-3.5 h-3.5 mr-1"/>, label: "Audit" };
  }
};

// ============================================================================
// 2. COMPOSANT PRINCIPAL
// ============================================================================
export default function SecurityOpsView() {
  const queryClient = useQueryClient();

  // --- ÉTATS DE NAVIGATION ET SÉLECTION ---
  const [activeTab, setActiveTab] = useState("projects");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  // --- ÉTATS DES MODALES (Création & Édition) ---
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [isAddAppOpen, setIsAddAppOpen] = useState(false);
  const [isAddVulnOpen, setIsAddVulnOpen] = useState(false);

  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [appToEdit, setAppToEdit] = useState<Application | null>(null);

  // --- ÉTATS DES FORMULAIRES ---
  const [newProject, setNewProject] = useState({ name: "", manager: "", goLiveDate: "", riskLevel: "moyen" });
  const [newApp, setNewApp] = useState({ name: "", auditType: "pentest", criticality: "majeure", lastAuditDate: "" });
  const [newVuln, setNewVuln] = useState({ title: "", cve: "", description: "", severity: "moyen" });

  // --- ÉTATS DES MODALES DE CONFIRMATION (Actions critiques) ---
  const [projectStatusToUpdate, setProjectStatusToUpdate] = useState<{id: string, status: string, name: string} | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [appToMarkAudited, setAppToMarkAudited] = useState<Application | null>(null);
  const [appToDelete, setAppToDelete] = useState<Application | null>(null);
  const [vulnToClose, setVulnToClose] = useState<string | null>(null);

  // ============================================================================
  // 3. APPELS API (Supabase)
  // ============================================================================

  // LECTURE
  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [], isLoading: isLoadingApps } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: vulns = [], isLoading: isLoadingVulns } = useQuery({ queryKey: ['vulnerabilities'], queryFn: fetchVulnerabilities });

  // --- MUTATIONS PROJETS ---
  const addProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success("Projet ajouté au suivi");
      setIsAddProjectOpen(false);
      setNewProject({ name: "", manager: "", goLiveDate: "", riskLevel: "moyen" });
    }
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string, updates: Partial<Project> }) => updateProject(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success("Projet mis à jour avec succès");
      setProjectToEdit(null);
    }
  });

  const delProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success("Projet supprimé définitivement");
      setSelectedProject(null);
    }
  });

  // --- MUTATIONS AUDITS ET VULNÉRABILITÉS ---
  const addAppMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success("Périmètre ajouté au registre");
      setIsAddAppOpen(false);
      setNewApp({ name: "", auditType: "pentest", criticality: "majeure", lastAuditDate: "" });
    }
  });

  const updateAppMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string, updates: Partial<Application> }) => updateApplication(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success("Périmètre mis à jour");
      setAppToEdit(null);
    }
  });

  const delAppMutation = useMutation({
    mutationFn: deleteApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success("Périmètre supprimé définitivement");
      setSelectedApp(null);
    }
  });

  const addVulnMutation = useMutation({
    mutationFn: createVulnerability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      toast.success("Constat déclaré avec succès");
      setIsAddVulnOpen(false);
      setNewVuln({ title: "", cve: "", description: "", severity: "moyen" });
    }
  });

  const closeVulnMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: any }) => updateVulnerabilityStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      toast.success("Vulnérabilité clôturée ! Dette technique réduite.");
      setVulnToClose(null);
    }
  });

  // ============================================================================
  // 4. CALCULS GLOBAUX POUR LES CARTES INDICATEURS
  // ============================================================================

  // KPIs Projets (PAS)
  const totalProjects = projects.length;
  const validatedPas = projects.filter(p => p.pasStatus === "validated").length;
  const pasCoverage = totalProjects > 0 ? Math.round((validatedPas / totalProjects) * 100) : 0;
  const projectsAtRisk = projects.filter(p => p.pasStatus !== "validated" && p.riskLevel === "fort").length;

  // KPIs Audits (Applications)
  const totalApps = apps.length;
  const auditedApps = apps.filter(a => calculateNextAudit(a.lastAuditDate, a.auditFrequencyMonths) !== "Dépassé" && a.lastAuditDate).length;
  const auditCoverage = totalApps > 0 ? Math.round((auditedApps / totalApps) * 100) : 0;

  // Dette technique calculée dynamiquement à partir des vraies vulnérabilités ouvertes
  const activeVulns = vulns.filter(v => v.status === "ouvert");
  const totalCriticalVulns = activeVulns.filter(v => v.severity === "critique").length;
  const totalHighVulns = activeVulns.filter(v => v.severity === "eleve").length;

  // ============================================================================
  // 5. HANDLERS (Soumissions de formulaires)
  // ============================================================================
  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name || !newProject.goLiveDate) return toast.error("Veuillez remplir les champs requis");
    addProjectMutation.mutate({ name: newProject.name, manager: newProject.manager, riskLevel: newProject.riskLevel as any, goLiveDate: newProject.goLiveDate, pasStatus: 'draft' });
  };

  const handleCreateApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApp.name) return toast.error("Le nom est requis");
    addAppMutation.mutate({ name: newApp.name, auditType: newApp.auditType as any, criticality: newApp.criticality as any, lastAuditDate: newApp.lastAuditDate || null, auditFrequencyMonths: 12 });
  };

  const handleCreateVuln = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;
    if (!newVuln.title || !newVuln.description) return toast.error("Titre et description requis");
    addVulnMutation.mutate({ appId: selectedApp.id, title: newVuln.title, cve: newVuln.cve, description: newVuln.description, severity: newVuln.severity as any, status: 'ouvert' });
  };

  if (isLoadingProjects || isLoadingApps || isLoadingVulns) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  // ============================================================================
  // 6. RENDU DE L'INTERFACE (JSX)
  // ============================================================================
  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* --- ZONE A : CARTES DE SYNTHÈSE --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={`border-l-4 shadow-sm ${pasCoverage >= 80 ? 'border-l-emerald-500' : pasCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture PAS</CardTitle>
            <ShieldCheck className={`w-4 h-4 ${pasCoverage >= 80 ? 'text-emerald-500' : pasCoverage > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pasCoverage}%</div>
            <p className="text-xs text-muted-foreground mt-1">{validatedPas} projets sécurisés sur {totalProjects}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${projectsAtRisk > 0 ? 'border-l-rose-500 bg-rose-50/50' : 'border-l-slate-200'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className={`text-sm font-medium ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>Alerte Go-Live</CardTitle>
            <Rocket className={`w-4 h-4 ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${projectsAtRisk > 0 ? 'text-rose-600' : ''}`}>{projectsAtRisk}</div>
            <p className="text-xs text-muted-foreground mt-1">Projets risqués sans PAS validé</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${auditCoverage >= 80 ? 'border-l-blue-500' : auditCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture Audit</CardTitle>
            <ShieldAlert className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{auditCoverage}%</div>
            <p className="text-xs text-muted-foreground mt-1">{auditedApps} périmètres à jour sur {totalApps}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${(totalCriticalVulns + totalHighVulns) > 0 ? 'border-l-rose-600' : 'border-l-emerald-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dette Majeure</CardTitle>
            <Bug className={`w-4 h-4 ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalCriticalVulns + totalHighVulns}</div>
            <p className="text-xs text-muted-foreground mt-1">Vulnérabilités Critiques/Élevées</p>
          </CardContent>
        </Card>
      </div>

      {/* --- ZONE B : SYSTÈME D'ONGLETS (Tableaux) --- */}
      <Card className="shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b border-border flex justify-between items-end">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="projects" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Plan d'assurance Sécurité
              </TabsTrigger>
              <TabsTrigger value="audits" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Registre des Audits
              </TabsTrigger>
            </TabsList>
            <Button className="mb-2" size="sm" onClick={() => activeTab === "projects" ? setIsAddProjectOpen(true) : setIsAddAppOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> {activeTab === "projects" ? "Nouveau Projet" : "Nouveau Périmètre"}
            </Button>
          </div>

          {/* ONGLET 1 : PROJETS */}
          <TabsContent value="projects" className="m-0">
            {projects.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucun projet en cours.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Projet</TableHead>
                    <TableHead>Chef de Projet</TableHead>
                    <TableHead>Niveau de Risque</TableHead>
                    <TableHead>Date Go-Live</TableHead>
                    <TableHead className="text-right">Statut PAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedProject(project)}>
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{project.manager || "Non assigné"}</TableCell>
                      <TableCell>{getRiskBadge(project.riskLevel)}</TableCell>
                      <TableCell className="text-sm font-medium flex items-center gap-1.5 mt-2">
                        <Rocket className="w-3.5 h-3.5 text-muted-foreground" />
                        {formatFrDate(project.goLiveDate)}
                      </TableCell>
                      <TableCell className="text-right">{getPasStatusBadge(project.pasStatus)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ONGLET 2 : AUDITS ET VULNÉRABILITÉS */}
          <TabsContent value="audits" className="m-0">
             {apps.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucun périmètre référencé.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Périmètre Audité</TableHead>
                    <TableHead>Type d'Audit</TableHead>
                    <TableHead>Criticité</TableHead>
                    <TableHead>Vuln. Actives</TableHead>
                    <TableHead className="text-right">Prochaine Campagne</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map((app) => {
                    const nextAudit = calculateNextAudit(app.lastAuditDate, app.auditFrequencyMonths);
                    const appInfo = getAuditTypeInfo(app.auditType);

                    // Calcul de toutes les vulnérabilités actives pour ce périmètre
                    const appVulns = activeVulns.filter(v => v.appId === app.id);
                    const vCrit = appVulns.filter(v => v.severity === 'critique').length;
                    const vHigh = appVulns.filter(v => v.severity === 'eleve').length;
                    const vMed = appVulns.filter(v => v.severity === 'moyen').length;
                    const vLow = appVulns.filter(v => v.severity === 'faible').length;

                    return (
                      <TableRow key={app.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedApp(app)}>
                        <TableCell className="font-medium">{app.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground flex items-center mt-2.5">{appInfo.icon} {appInfo.label}</TableCell>
                        <TableCell><Badge variant="outline" className="text-slate-600 bg-slate-50">{app.criticality}</Badge></TableCell>

                        {/* AFFICHAGE COMPLET DE TOUTES LES VULNÉRABILITÉS */}
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {vCrit > 0 && <Badge className="bg-red-600 text-white border-transparent hover:bg-red-600/80">{vCrit} Crit.</Badge>}
                            {vHigh > 0 && <Badge className="bg-orange-500 text-white border-transparent hover:bg-orange-500/80">{vHigh} Élev.</Badge>}
                            {vMed > 0 && <Badge className="bg-yellow-500 text-white border-transparent hover:bg-yellow-500/80">{vMed} Moy.</Badge>}
                            {vLow > 0 && <Badge className="bg-slate-500 text-white border-transparent hover:bg-slate-500/80">{vLow} Fble</Badge>}

                            {vCrit === 0 && vHigh === 0 && vMed === 0 && vLow === 0 && (
                              <span className="text-xs text-emerald-600 font-medium">✅ Zéro dette</span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-right text-sm">
                          <span className={nextAudit === "Dépassé" ? "text-rose-600 font-bold" : "text-muted-foreground"}>
                            {nextAudit === "Dépassé" ? "⚠️ Dépassé" : nextAudit}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* ============================================================================ */}
      {/* 7. PANNEAUX LATÉRAUX (DÉTAILS AU CLIC) */}
      {/* ============================================================================ */}

      {/* --- PANNEAU PROJET --- */}
      <Sheet open={!!selectedProject} onOpenChange={(open) => !open && setSelectedProject(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex justify-between items-start">
              <div>
                <SheetTitle className="text-xl">{selectedProject?.name}</SheetTitle>
                <SheetDescription>Détails du projet et suivi du PAS</SheetDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => setProjectToEdit(selectedProject)}><Pencil className="w-4 h-4" /></Button>
            </div>
          </SheetHeader>
          {selectedProject && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Statut actuel du PAS</p>
                  {getPasStatusBadge(selectedProject.pasStatus)}
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-xs text-muted-foreground">Risque Métier</p>
                  {getRiskBadge(selectedProject.riskLevel)}
                </div>
              </div>

              <div className="p-4 border border-border rounded-lg bg-card space-y-2">
                <p className="text-sm font-semibold flex items-center gap-2"><Rocket className="w-4 h-4 text-primary"/> Objectif Go-Live</p>
                <p className="text-lg font-bold">{formatFrDate(selectedProject.goLiveDate)}</p>
                {selectedProject.pasStatus !== "validated" && (
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="w-3 h-3" /> La production risque d'être bloquée si le PAS n'est pas validé.
                  </p>
                )}
              </div>

              <div className="space-y-3 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold">Faire avancer le PAS</h4>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'draft', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'draft' ? 'border-primary bg-primary/5' : ''}`}>📝 Repasser en rédaction</Button>
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'review', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'review' ? 'border-primary bg-primary/5' : ''}`}>👀 Passer en revue (SSI)</Button>
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'validated', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'validated' ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : ''}`}>✅ Valider définitivement le PAS</Button>
                </div>
              </div>

              <div className="mt-12 pt-6 border-t border-border">
                <Button variant="destructive" className="w-full" onClick={() => setProjectToDelete(selectedProject)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer le projet</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* --- PANNEAU AUDITS ET VULNÉRABILITÉS --- */}
      <Sheet open={!!selectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 text-primary mb-1 text-sm font-medium">
                  {selectedApp && getAuditTypeInfo(selectedApp.auditType).icon}
                  {selectedApp && getAuditTypeInfo(selectedApp.auditType).label}
                </div>
                <SheetTitle className="text-xl">{selectedApp?.name}</SheetTitle>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => setAppToEdit(selectedApp)}><Pencil className="w-4 h-4" /></Button>
            </div>
          </SheetHeader>

          {selectedApp && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border border-border rounded-md text-center">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Dernier Audit</p>
                  <p className="font-medium text-sm">{formatFrDate(selectedApp.lastAuditDate)}</p>
                </div>
                <div className="p-3 border border-border rounded-md text-center bg-muted/20">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Prochain Audit</p>
                  <p className={`font-medium text-sm ${calculateNextAudit(selectedApp.lastAuditDate, selectedApp.auditFrequencyMonths) === 'Dépassé' ? 'text-rose-600' : ''}`}>
                    {calculateNextAudit(selectedApp.lastAuditDate, selectedApp.auditFrequencyMonths)}
                  </p>
                </div>
              </div>

              <Button variant="outline" size="sm" className="w-full bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600" onClick={() => setAppToMarkAudited(selectedApp)}>
                <ShieldAlert className="w-4 h-4 mr-2" /> Marquer comme audité aujourd'hui
              </Button>

              {/* LISTE DES VULNÉRABILITÉS DÉTAILLÉES */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Bug className="w-4 h-4 text-rose-500" /> Constats & Vulnérabilités
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => setIsAddVulnOpen(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Déclarer
                  </Button>
                </div>

                <div className="space-y-3">
                  {activeVulns.filter(v => v.appId === selectedApp.id).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic bg-muted/20 p-4 rounded-md border border-border text-center">Aucune vulnérabilité active. Beau travail !</p>
                  ) : (
                    activeVulns.filter(v => v.appId === selectedApp.id).map(vuln => {
                      const getVulnColor = (sev: string) => {
                        switch(sev) {
                          case 'critique': return 'border-red-200 bg-red-50/50';
                          case 'eleve': return 'border-orange-200 bg-orange-50/50';
                          case 'moyen': return 'border-yellow-200 bg-yellow-50/50';
                          default: return 'border-slate-200 bg-slate-50/50';
                        }
                      };

                      return (
                        <div key={vuln.id} className={`p-4 border rounded-lg ${getVulnColor(vuln.severity)}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${vuln.severity === 'critique' ? 'text-red-600' : vuln.severity === 'eleve' ? 'text-orange-600' : vuln.severity === 'moyen' ? 'text-yellow-600' : 'text-slate-600'}`}>
                                  Impact {vuln.severity}
                                </span>
                                {vuln.cve && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-white text-black">{vuln.cve}</Badge>}
                              </div>
                              <h5 className="font-semibold text-sm">{vuln.title}</h5>
                            </div>
                            {/* Bouton pour clôturer spécifiquement cette vulnérabilité */}
                            <Button variant="ghost" size="icon" className="h-7 w-7 bg-white shadow-sm hover:bg-emerald-50 hover:text-emerald-600 border border-slate-200 text-slate-700" onClick={() => setVulnToClose(vuln.id)}>
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                          </div>
                          {/* L'explication vulgarisée */}
                          <p className="text-xs text-slate-700 leading-relaxed mt-2 bg-white/60 p-2 rounded border border-white/40">
                            {vuln.description}
                          </p>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="mt-12 pt-6 border-t border-border">
                <Button variant="destructive" className="w-full" onClick={() => setAppToDelete(selectedApp)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Retirer le périmètre
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================================================================ */}
      {/* 8. MODALES DE FORMULAIRES (Création & Édition) */}
      {/* ============================================================================ */}

      {/* Création Projet */}
      <Dialog open={isAddProjectOpen} onOpenChange={setIsAddProjectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouveau Projet (PAS)</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div className="space-y-2"><Label>Nom du Projet</Label><Input required value={newProject.name} onChange={(e) => setNewProject({...newProject, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>Chef de Projet</Label><Input placeholder="Ex: Jean Dupont" value={newProject.manager} onChange={(e) => setNewProject({...newProject, manager: e.target.value})} /></div>
            <div className="space-y-2">
              <Label>Niveau de Risque Métier</Label>
              <Select value={newProject.riskLevel} onValueChange={(v) => setNewProject({...newProject, riskLevel: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="faible">Faible</SelectItem><SelectItem value="moyen">Moyen</SelectItem><SelectItem value="fort">Fort</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Date prévue de mise en production</Label><Input required type="date" value={newProject.goLiveDate} onChange={(e) => setNewProject({...newProject, goLiveDate: e.target.value})} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddProjectOpen(false)}>Annuler</Button><Button type="submit" disabled={addProjectMutation.isPending}>Ajouter au suivi</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Édition Projet */}
      <Dialog open={!!projectToEdit} onOpenChange={(open) => !open && setProjectToEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le projet</DialogTitle></DialogHeader>
          {projectToEdit && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateProjectMutation.mutate({ id: projectToEdit.id, updates: projectToEdit });
              setSelectedProject(projectToEdit);
            }} className="space-y-4">
              <div className="space-y-2"><Label>Nom du Projet</Label><Input required value={projectToEdit.name} onChange={(e) => setProjectToEdit({...projectToEdit, name: e.target.value})} /></div>
              <div className="space-y-2"><Label>Chef de Projet</Label><Input value={projectToEdit.manager || ""} onChange={(e) => setProjectToEdit({...projectToEdit, manager: e.target.value})} /></div>
              <div className="space-y-2">
                <Label>Niveau de Risque Métier</Label>
                <Select value={projectToEdit.riskLevel} onValueChange={(v: any) => setProjectToEdit({...projectToEdit, riskLevel: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="faible">Faible</SelectItem><SelectItem value="moyen">Moyen</SelectItem><SelectItem value="fort">Fort</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Date de mise en prod</Label><Input required type="date" value={projectToEdit.goLiveDate} onChange={(e) => setProjectToEdit({...projectToEdit, goLiveDate: e.target.value})} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setProjectToEdit(null)}>Annuler</Button><Button type="submit" disabled={updateProjectMutation.isPending}>Enregistrer</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Création Application */}
      <Dialog open={isAddAppOpen} onOpenChange={setIsAddAppOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouveau Périmètre d'Audit</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateApp} className="space-y-4">
            <div className="space-y-2"><Label>Nom du périmètre</Label><Input required value={newApp.name} onChange={(e) => setNewApp({...newApp, name: e.target.value})} /></div>
            <div className="space-y-2">
              <Label>Type d'audit prévu</Label>
              <Select value={newApp.auditType} onValueChange={(v) => setNewApp({...newApp, auditType: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pentest">Test d'Intrusion (Pentest)</SelectItem><SelectItem value="architecture">Audit d'Architecture</SelectItem><SelectItem value="configuration">Audit de Configuration</SelectItem><SelectItem value="gouvernance">Audit Organisationnel / Gouvernance</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Criticité Métier</Label>
              <Select value={newApp.criticality} onValueChange={(v) => setNewApp({...newApp, criticality: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="mineure">Mineure</SelectItem><SelectItem value="majeure">Majeure</SelectItem><SelectItem value="critique">Critique</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Date du dernier audit</Label><Input type="date" value={newApp.lastAuditDate} onChange={(e) => setNewApp({...newApp, lastAuditDate: e.target.value})} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddAppOpen(false)}>Annuler</Button><Button type="submit" disabled={addAppMutation.isPending}>Enregistrer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Édition Application */}
      <Dialog open={!!appToEdit} onOpenChange={(open) => !open && setAppToEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le Périmètre</DialogTitle></DialogHeader>
          {appToEdit && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateAppMutation.mutate({ id: appToEdit.id, updates: appToEdit });
              setSelectedApp(appToEdit);
            }} className="space-y-4">
              <div className="space-y-2"><Label>Nom du Périmètre</Label><Input required value={appToEdit.name} onChange={(e) => setAppToEdit({...appToEdit, name: e.target.value})} /></div>
              <div className="space-y-2">
                <Label>Type d'Audit</Label>
                <Select value={appToEdit.auditType} onValueChange={(v: any) => setAppToEdit({...appToEdit, auditType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="pentest">Test d'Intrusion</SelectItem><SelectItem value="architecture">Audit d'Architecture</SelectItem><SelectItem value="configuration">Audit de Config</SelectItem><SelectItem value="gouvernance">Audit Orga</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Criticité Métier</Label>
                <Select value={appToEdit.criticality} onValueChange={(v: any) => setAppToEdit({...appToEdit, criticality: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="mineure">Mineure</SelectItem><SelectItem value="majeure">Majeure</SelectItem><SelectItem value="critique">Critique</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Fréquence (mois)</Label><Input type="number" min="1" value={appToEdit.auditFrequencyMonths} onChange={(e) => setAppToEdit({...appToEdit, auditFrequencyMonths: parseInt(e.target.value) || 12})} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setAppToEdit(null)}>Annuler</Button><Button type="submit" disabled={updateAppMutation.isPending}>Enregistrer</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Création Vulnérabilité */}
      <Dialog open={isAddVulnOpen} onOpenChange={setIsAddVulnOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Déclarer un constat</DialogTitle><SheetDescription>Sur le périmètre : {selectedApp?.name}</SheetDescription></DialogHeader>
          <form onSubmit={handleCreateVuln} className="space-y-4">
            <div className="space-y-2"><Label>Titre (Technique ou Résumé)</Label><Input required placeholder="Ex: Injection SQL sur la page de login" value={newVuln.title} onChange={(e) => setNewVuln({...newVuln, title: e.target.value})} /></div>
            <div className="space-y-2"><Label>Référence CVE (Optionnel)</Label><Input placeholder="Ex: CVE-2023-12345" value={newVuln.cve} onChange={(e) => setNewVuln({...newVuln, cve: e.target.value})} /></div>
            <div className="space-y-2"><Label>Explication vulgarisée & Impact métier</Label><Textarea required placeholder="Expliquez le risque..." value={newVuln.description} onChange={(e) => setNewVuln({...newVuln, description: e.target.value})} className="h-24" /></div>
            <div className="space-y-2">
              <Label>Sévérité du constat</Label>
              <Select value={newVuln.severity} onValueChange={(v) => setNewVuln({...newVuln, severity: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="faible">Faible</SelectItem><SelectItem value="moyen">Moyen</SelectItem><SelectItem value="eleve">Élevé</SelectItem><SelectItem value="critique">Critique</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddVulnOpen(false)}>Annuler</Button><Button type="submit" disabled={addVulnMutation.isPending}>Ajouter</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ============================================================================ */}
      {/* 9. POP-UPS DE CONFIRMATION (ACTIONS IRRÉVERSIBLES) */}
      {/* ============================================================================ */}

      <AlertDialog open={!!projectStatusToUpdate} onOpenChange={(open) => !open && setProjectStatusToUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Changement de statut (PAS)</AlertDialogTitle><AlertDialogDescription>Confirmez-vous le changement de statut de sécurité du projet <strong>{projectStatusToUpdate?.name}</strong> ?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction onClick={() => { if (!projectStatusToUpdate || !selectedProject) return; updateProjectMutation.mutate({ id: projectStatusToUpdate.id, updates: { pasStatus: projectStatusToUpdate.status as any } }); setSelectedProject({ ...selectedProject, pasStatus: projectStatusToUpdate.status as any }); setProjectStatusToUpdate(null); }}>Oui, modifier</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!appToMarkAudited} onOpenChange={(open) => !open && setAppToMarkAudited(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Renouveler l'audit</AlertDialogTitle><AlertDialogDescription>Marquer <strong>{appToMarkAudited?.name}</strong> comme audité aujourd'hui ? Cela va repousser la prochaine date d'échéance.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { if (!appToMarkAudited || !selectedApp) return; const today = new Date().toISOString().split('T')[0]; updateAppMutation.mutate({ id: appToMarkAudited.id, updates: { lastAuditDate: today } }); setSelectedApp({ ...selectedApp, lastAuditDate: today }); setAppToMarkAudited(null); }}>Oui, marquer audité</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!vulnToClose} onOpenChange={(open) => !open && setVulnToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Correction validée</AlertDialogTitle><AlertDialogDescription>Confirmez-vous que cette vulnérabilité a été corrigée ? Elle disparaîtra des indicateurs de dette technique.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { if (!vulnToClose) return; closeVulnMutation.mutate({ id: vulnToClose, status: 'resolu' }); }}>Oui, clôturer</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="text-destructive">Supprimer ce projet ?</AlertDialogTitle><AlertDialogDescription>Êtes-vous sûr de vouloir supprimer définitivement <strong>{projectToDelete?.name}</strong> ?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (!projectToDelete) return; delProjectMutation.mutate(projectToDelete.id); setProjectToDelete(null); }}>Supprimer</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!appToDelete} onOpenChange={(open) => !open && setAppToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="text-destructive">Supprimer ce périmètre ?</AlertDialogTitle><AlertDialogDescription>Êtes-vous sûr de vouloir retirer <strong>{appToDelete?.name}</strong> ? Toutes les vulnérabilités associées seront supprimées.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (!appToDelete) return; delAppMutation.mutate(appToDelete.id); setAppToDelete(null); }}>Supprimer</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}