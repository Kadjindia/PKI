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
import { ShieldAlert, ShieldCheck, Rocket, Bug, Plus, AlertTriangle, Loader2, Trash2, CheckCircle2, Pencil, Network, FileSearch, Settings2, Search, Clock, History, Target } from "lucide-react";

// ============================================================================
// 1. UTILITAIRES DE DESIGN ET DE CALCUL (CORRIGÉS POUR LE DARK MODE)
// ============================================================================

const formatFrDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "Non définie";
  return new Date(dateStr).toLocaleDateString("fr-FR");
};

const calculateNextDeadlineStr = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "À planifier";
  const d = new Date(lastDate);
  d.setMonth(d.getMonth() + (freqMonths || 12));
  return d.toLocaleDateString("fr-FR");
};

const getDeadlineStatus = (lastDate: string | null, freqMonths: number) => {
  if (!lastDate) return "missing";
  const deadline = new Date(lastDate);
  deadline.setMonth(deadline.getMonth() + (freqMonths || 12));
  const diffDays = Math.ceil((deadline.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 90) return "warning";
  return "ok";
};

// BADGES 100% TAILWIND (S'adaptent parfaitement au Dark Mode)
const getDeadlineBadge = (status: string, dateStr: string, isRiskAnalysis = false) => {
  const icon = isRiskAnalysis ? <Target className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />;

  switch (status) {
    case "ok":
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">{icon} {dateStr}</Badge>;
    case "warning":
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" title="Échéance < 3 mois">{icon} {dateStr} (Bientôt)</Badge>;
    case "expired":
      return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"><AlertTriangle className="w-3 h-3 mr-1" /> Dépassé</Badge>;
    case "missing":
      return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"><AlertTriangle className="w-3 h-3 mr-1" /> Manquant</Badge>;
    default:
      return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20">Inconnu</Badge>;
  }
};

const getPasStatusBadge = (status: string) => {
  switch (status) {
    case "validated": return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">✅ Validé</Badge>;
    case "review": return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">👀 En revue SSI</Badge>;
    case "draft": return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20">📝 En rédaction</Badge>;
    default: return <Badge variant="outline">Inconnu</Badge>;
  }
};

const getRiskBadge = (risk: string) => {
  switch (risk) {
    case "fort": return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">Fort</Badge>;
    case "moyen": return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">Moyen</Badge>;
    case "faible": return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">Faible</Badge>;
    default: return <Badge variant="outline">Inconnu</Badge>;
  }
};

const getVulnColor = (sev: string, isResolved: boolean) => {
  if (isResolved) return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-900/10 opacity-70';
  switch(sev) {
    case 'critique': return 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/10';
    case 'eleve': return 'border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-900/10';
    case 'moyen': return 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10';
    default: return 'border-slate-200 bg-slate-50 dark:border-slate-700/50 dark:bg-slate-800/20';
  }
};

const checkSlaOverdue = (createdAt: string, severity: string) => {
  const createdDate = new Date(createdAt);
  const diffDays = Math.ceil(Math.abs(new Date().getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  switch (severity) {
    case 'critique': return diffDays > 7;
    case 'eleve': return diffDays > 30;
    case 'moyen': return diffDays > 90;
    default: return false;
  }
};

const getAuditTypeInfo = (type: string) => {
  switch (type) {
    case "pentest": return { icon: <Bug className="w-3.5 h-3.5 mr-1 text-rose-500 dark:text-rose-400"/>, label: "Test d'intrusion" };
    case "architecture": return { icon: <Network className="w-3.5 h-3.5 mr-1 text-blue-500 dark:text-blue-400"/>, label: "Audit d'Architecture" };
    case "configuration": return { icon: <Settings2 className="w-3.5 h-3.5 mr-1 text-slate-500 dark:text-slate-400"/>, label: "Audit de Configuration" };
    case "gouvernance": return { icon: <FileSearch className="w-3.5 h-3.5 mr-1 text-amber-500 dark:text-amber-400"/>, label: "Audit Organisationnel" };
    default: return { icon: <ShieldAlert className="w-3.5 h-3.5 mr-1"/>, label: "Audit" };
  }
};

// ============================================================================
// 2. COMPOSANT PRINCIPAL
// ============================================================================
export default function SecurityOpsView() {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("projects");
  const [searchQuery, setSearchQuery] = useState("");
  const [showResolvedHistory, setShowResolvedHistory] = useState(false);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [isAddAppOpen, setIsAddAppOpen] = useState(false);
  const [isAddVulnOpen, setIsAddVulnOpen] = useState(false);

  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [appToEdit, setAppToEdit] = useState<Application | null>(null);

  const [newProject, setNewProject] = useState({ name: "", manager: "", goLiveDate: "", riskLevel: "moyen", requestDate: new Date().toISOString().split('T')[0] });
  const [newApp, setNewApp] = useState({ name: "", auditType: "pentest", criticality: "majeure", lastAuditDate: "", lastRiskAnalysisDate: "" });
  const [newVuln, setNewVuln] = useState({ title: "", cve: "", description: "", severity: "moyen" });

  const [projectStatusToUpdate, setProjectStatusToUpdate] = useState<{id: string, status: string, name: string} | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [appToMarkAudited, setAppToMarkAudited] = useState<Application | null>(null);
  const [appToMarkRiskAnalyzed, setAppToMarkRiskAnalyzed] = useState<Application | null>(null);
  const [appToDelete, setAppToDelete] = useState<Application | null>(null);
  const [vulnToClose, setVulnToClose] = useState<string | null>(null);

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const { data: apps = [], isLoading: isLoadingApps } = useQuery({ queryKey: ['applications'], queryFn: fetchApplications });
  const { data: vulns = [], isLoading: isLoadingVulns } = useQuery({ queryKey: ['vulnerabilities'], queryFn: fetchVulnerabilities });

  const addProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); toast.success("Projet ajouté"); setIsAddProjectOpen(false); setNewProject({ name: "", manager: "", goLiveDate: "", riskLevel: "moyen", requestDate: new Date().toISOString().split('T')[0] }); }
  });
  const updateProjectMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string, updates: Partial<Project> }) => updateProject(id, updates),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); toast.success("Projet mis à jour"); setProjectToEdit(null); }
  });
  const delProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); toast.success("Projet supprimé"); setSelectedProject(null); }
  });

  const addAppMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['applications'] }); toast.success("Périmètre ajouté"); setIsAddAppOpen(false); setNewApp({ name: "", auditType: "pentest", criticality: "majeure", lastAuditDate: "", lastRiskAnalysisDate: "" }); }
  });
  const updateAppMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string, updates: Partial<Application> }) => updateApplication(id, updates),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['applications'] }); toast.success("Périmètre mis à jour"); setAppToEdit(null); }
  });
  const delAppMutation = useMutation({
    mutationFn: deleteApplication,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['applications'] }); toast.success("Périmètre supprimé"); setSelectedApp(null); }
  });

  const addVulnMutation = useMutation({
    mutationFn: createVulnerability,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] }); toast.success("Constat déclaré"); setIsAddVulnOpen(false); setNewVuln({ title: "", cve: "", description: "", severity: "moyen" }); }
  });
  const closeVulnMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: any }) => updateVulnerabilityStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] }); toast.success("Vulnérabilité clôturée !"); setVulnToClose(null); }
  });

  const totalProjects = projects.length;
  const validatedPas = projects.filter(p => p.pasStatus === "validated").length;
  const pasCoverage = totalProjects > 0 ? Math.round((validatedPas / totalProjects) * 100) : 0;
  const projectsAtRisk = projects.filter(p => p.pasStatus !== "validated" && p.riskLevel === "fort").length;

  const totalApps = apps.length;
  const auditedApps = apps.filter(a => getDeadlineStatus(a.lastAuditDate, a.auditFrequencyMonths) !== "expired" && a.lastAuditDate).length;
  const auditCoverage = totalApps > 0 ? Math.round((auditedApps / totalApps) * 100) : 0;

  const appsWithRiskAnalysis = apps.filter(a => getDeadlineStatus(a.lastRiskAnalysisDate, a.riskAnalysisFrequencyMonths) !== "expired" && a.lastRiskAnalysisDate).length;
  const riskAnalysisCoverage = totalApps > 0 ? Math.round((appsWithRiskAnalysis / totalApps) * 100) : 0;

  const activeVulns = vulns.filter(v => v.status === "ouvert");
  const totalCriticalVulns = activeVulns.filter(v => v.severity === "critique").length;
  const totalHighVulns = activeVulns.filter(v => v.severity === "eleve").length;

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.manager && p.manager.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredApps = apps.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name) return;
    addProjectMutation.mutate({ ...newProject, pasStatus: 'draft' } as any);
  };

  const handleCreateApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApp.name) return;
    addAppMutation.mutate({
      ...newApp,
      lastAuditDate: newApp.lastAuditDate || null,
      auditFrequencyMonths: 12,
      lastRiskAnalysisDate: newApp.lastRiskAnalysisDate || null,
      riskAnalysisFrequencyMonths: 36
    } as any);
  };

  const handleCreateVuln = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp || !newVuln.title) return;
    addVulnMutation.mutate({ appId: selectedApp.id, ...newVuln, status: 'ouvert' } as any);
  };

  if (isLoadingProjects || isLoadingApps || isLoadingVulns) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className={`border-l-4 shadow-sm ${pasCoverage >= 80 ? 'border-l-emerald-500' : pasCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture PAS</CardTitle>
            <ShieldCheck className={`w-4 h-4 ${pasCoverage >= 80 ? 'text-emerald-500' : pasCoverage > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pasCoverage}%</div>
            <p className="text-xs text-muted-foreground mt-1">{validatedPas} projets sur {totalProjects}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${projectsAtRisk > 0 ? 'border-l-rose-500 bg-rose-50/50' : 'border-l-slate-200'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className={`text-sm font-medium ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>Alerte Go-Live</CardTitle>
            <Rocket className={`w-4 h-4 ${projectsAtRisk > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${projectsAtRisk > 0 ? 'text-rose-600' : ''}`}>{projectsAtRisk}</div>
            <p className="text-xs text-muted-foreground mt-1">Projets risqués sans PAS</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${riskAnalysisCoverage >= 80 ? 'border-l-primary' : riskAnalysisCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture Analyses Risques</CardTitle>
            <Target className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{riskAnalysisCoverage}%</div>
            <p className="text-xs text-muted-foreground mt-1">{appsWithRiskAnalysis} périmètres sur {totalApps}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${auditCoverage >= 80 ? 'border-l-blue-500' : auditCoverage > 0 ? 'border-l-amber-500' : 'border-l-slate-300'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture Audit</CardTitle>
            <ShieldAlert className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{auditCoverage}%</div>
            <p className="text-xs text-muted-foreground mt-1">{auditedApps} périmètres sur {totalApps}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${(totalCriticalVulns + totalHighVulns) > 0 ? 'border-l-rose-600' : 'border-l-emerald-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dette Majeure</CardTitle>
            <Bug className={`w-4 h-4 ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(totalCriticalVulns + totalHighVulns) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalCriticalVulns + totalHighVulns}</div>
            <p className="text-xs text-muted-foreground mt-1">Vulnérabilités Crit/Élev</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b border-border flex justify-between items-end">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="projects" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Plans d'Assurance Sécurité
              </TabsTrigger>
              <TabsTrigger value="audits" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-3">
                Audits & Analyses de Risques
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-3 mb-2">
              <div className="relative w-64 hidden sm:block">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un nom..."
                  className="pl-9 h-9 bg-muted/50 border-transparent focus:border-primary"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={() => activeTab === "projects" ? setIsAddProjectOpen(true) : setIsAddAppOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> {activeTab === "projects" ? "Nouveau Projet" : "Nouveau Périmètre"}
              </Button>
            </div>
          </div>

          <TabsContent value="projects" className="m-0">
            {filteredProjects.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucun projet trouvé.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Projet</TableHead>
                    <TableHead>Chef de Projet</TableHead>
                    <TableHead>Niveau de Risque</TableHead>
                    <TableHead>Date Demande</TableHead>
                    <TableHead>Date Go-Live</TableHead>
                    <TableHead className="text-right">Statut PAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedProject(project)}>
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{project.manager || "-"}</TableCell>
                      <TableCell>{getRiskBadge(project.riskLevel)}</TableCell>
                      <TableCell className="text-sm font-medium text-muted-foreground">
                        {formatFrDate(project.requestDate || project.createdAt)}
                      </TableCell>
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

          <TabsContent value="audits" className="m-0">
             {filteredApps.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucun périmètre trouvé.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Périmètre</TableHead>
                    <TableHead>Type de Contrôle</TableHead>
                    <TableHead>Prochaine Analyse de Risques</TableHead>
                    <TableHead>Vuln. Actives</TableHead>
                    <TableHead className="text-right">Prochain Audit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredApps.map((app) => {
                    const appInfo = getAuditTypeInfo(app.auditType);
                    const riskStatus = getDeadlineStatus(app.lastRiskAnalysisDate, app.riskAnalysisFrequencyMonths);
                    const riskNextDateStr = calculateNextDeadlineStr(app.lastRiskAnalysisDate, app.riskAnalysisFrequencyMonths);
                    const auditStatus = getDeadlineStatus(app.lastAuditDate, app.auditFrequencyMonths);
                    const auditNextDateStr = calculateNextDeadlineStr(app.lastAuditDate, app.auditFrequencyMonths);
                    const appVulns = activeVulns.filter(v => v.appId === app.id);
                    const vCrit = appVulns.filter(v => v.severity === 'critique').length;
                    const vHigh = appVulns.filter(v => v.severity === 'eleve').length;
                    const vMed = appVulns.filter(v => v.severity === 'moyen').length;
                    const vLow = appVulns.filter(v => v.severity === 'faible').length;

                    return (
                      <TableRow key={app.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedApp(app); setShowResolvedHistory(false); }}>
                        <TableCell>
                          <div className="font-medium text-foreground">{app.name}</div>
                          <Badge variant="outline" className="text-muted-foreground bg-muted/50 dark:bg-muted/20 w-max text-[10px] py-0 mt-1">
                            Criticité : {app.criticality}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex items-center">
                            {appInfo.icon} {appInfo.label}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {getDeadlineBadge(riskStatus, riskNextDateStr, true)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {vCrit > 0 && <Badge variant="outline" className="bg-rose-500 text-white border-transparent dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30">{vCrit} Crit.</Badge>}
                            {vHigh > 0 && <Badge variant="outline" className="bg-orange-500 text-white border-transparent dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30">{vHigh} Élev.</Badge>}
                            {vMed > 0 && <Badge variant="outline" className="bg-amber-500 text-white border-transparent dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30">{vMed} Moy.</Badge>}
                            {vLow > 0 && <Badge variant="outline" className="bg-slate-500 text-white border-transparent dark:bg-slate-500/20 dark:text-slate-400 dark:border-slate-500/30">{vLow} Fble</Badge>}
                            {appVulns.length === 0 && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✅ Zéro dette</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {getDeadlineBadge(auditStatus, auditNextDateStr, false)}
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

      <Sheet open={!!selectedProject} onOpenChange={(open) => !open && setSelectedProject(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex justify-between items-start">
              <div>
                <SheetTitle className="text-xl">{selectedProject?.name}</SheetTitle>
                <SheetDescription>Détails du projet</SheetDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setProjectToEdit(selectedProject)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>

          {selectedProject && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Statut du PAS</p>
                  {getPasStatusBadge(selectedProject.pasStatus)}
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-xs text-muted-foreground">Risque</p>
                  {getRiskBadge(selectedProject.riskLevel)}
                </div>
              </div>

              <div className="p-4 border border-border rounded-lg bg-card space-y-2">
                <p className="text-sm font-semibold flex items-center gap-2"><Rocket className="w-4 h-4 text-primary"/> Objectif Go-Live</p>
                <p className="text-lg font-bold">{formatFrDate(selectedProject.goLiveDate)}</p>
                <p className="text-xs text-muted-foreground pt-2 border-t border-border mt-2">Demande de PAS le : {formatFrDate(selectedProject.requestDate || selectedProject.createdAt)}</p>
              </div>

              <div className="space-y-3 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold">Faire avancer le PAS</h4>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'draft', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'draft' ? 'border-primary bg-primary/5 text-primary' : ''}`}>
                    📝 Repasser en rédaction
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'review', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'review' ? 'border-primary bg-primary/5 text-primary' : ''}`}>
                    👀 Passer en revue (SSI)
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setProjectStatusToUpdate({id: selectedProject.id, status: 'validated', name: selectedProject.name})} className={`justify-start ${selectedProject.pasStatus === 'validated' ? 'border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400' : ''}`}>
                    ✅ Valider définitivement le PAS
                  </Button>
                </div>
              </div>

              <div className="mt-12 pt-6 border-t border-border">
                <Button variant="destructive" className="w-full" onClick={() => setProjectToDelete(selectedProject)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Supprimer le projet
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

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
              <Button variant="ghost" size="icon" onClick={() => setAppToEdit(selectedApp)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>

          {selectedApp && (
            <div className="space-y-6">

              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" /> Analyse de Risques (EBIOS/PIA)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 border border-border rounded-md text-center">
                    <p className="text-[10px] text-muted-foreground uppercase mb-1">Dernière Analyse</p>
                    <p className="font-medium text-sm">{formatFrDate(selectedApp.lastRiskAnalysisDate)}</p>
                  </div>
                  <div className="p-3 border border-border rounded-md text-center bg-primary/5">
                    <p className="text-[10px] text-primary uppercase mb-1">Prochaine Analyse</p>
                    {/* CHANGEMENT ICI : <p> devient <div> pour éviter l'erreur DOM Nesting */}
                    <div className="font-medium text-sm flex items-center justify-center">
                      {getDeadlineBadge(
                        getDeadlineStatus(selectedApp.lastRiskAnalysisDate, selectedApp.riskAnalysisFrequencyMonths),
                        calculateNextDeadlineStr(selectedApp.lastRiskAnalysisDate, selectedApp.riskAnalysisFrequencyMonths),
                        true
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary" onClick={() => setAppToMarkRiskAnalyzed(selectedApp)}>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Marquer l'analyse effectuée aujourd'hui
                </Button>
              </div>

              <div className="space-y-3 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-blue-500" /> Audit Technique
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 border border-border rounded-md text-center">
                    <p className="text-[10px] text-muted-foreground uppercase mb-1">Dernier Audit</p>
                    <p className="font-medium text-sm">{formatFrDate(selectedApp.lastAuditDate)}</p>
                  </div>
                  <div className="p-3 border border-border rounded-md text-center bg-blue-50/50 dark:bg-blue-900/10">
                    <p className="text-[10px] text-blue-600 uppercase mb-1">Prochain Audit</p>
                    {/* CHANGEMENT ICI : <p> devient <div> pour éviter l'erreur DOM Nesting */}
                    <div className="font-medium text-sm flex items-center justify-center">
                      {getDeadlineBadge(
                        getDeadlineStatus(selectedApp.lastAuditDate, selectedApp.auditFrequencyMonths),
                        calculateNextDeadlineStr(selectedApp.lastAuditDate, selectedApp.auditFrequencyMonths),
                        false
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 dark:border-blue-800 dark:text-blue-400" onClick={() => setAppToMarkAudited(selectedApp)}>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Marquer l'audit effectué aujourd'hui
                </Button>
              </div>

              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Bug className="w-4 h-4 text-rose-500" /> Constats & Remédiation
                  </h4>
                  <Button size="sm" variant="outline" onClick={() => setIsAddVulnOpen(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Déclarer
                  </Button>
                </div>

                <div className="flex p-1 bg-muted/50 rounded-lg">
                  <button
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${!showResolvedHistory ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => setShowResolvedHistory(false)}
                  >
                    Actives ({activeVulns.filter(v => v.appId === selectedApp.id).length})
                  </button>
                  <button
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1 ${showResolvedHistory ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => setShowResolvedHistory(true)}
                  >
                    <History className="w-3 h-3" /> Résolues ({vulns.filter(v => v.appId === selectedApp.id && v.status === 'resolu').length})
                  </button>
                </div>

                <div className="space-y-3">
                  {vulns.filter(v => v.appId === selectedApp.id && v.status === (showResolvedHistory ? 'resolu' : 'ouvert')).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic bg-muted/20 p-4 rounded-md border border-border text-center">
                      {showResolvedHistory ? "Aucun historique de correction pour le moment." : "Aucune vulnérabilité active. Beau travail !"}
                    </p>
                  ) : (
                    vulns.filter(v => v.appId === selectedApp.id && v.status === (showResolvedHistory ? 'resolu' : 'ouvert')).map(vuln => {
                      const isOverdue = !showResolvedHistory && checkSlaOverdue(vuln.createdAt, vuln.severity);
                      return (
                        <div key={vuln.id} className={`p-4 border rounded-lg ${getVulnColor(vuln.severity, showResolvedHistory)}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${showResolvedHistory ? 'text-emerald-600 dark:text-emerald-400' : vuln.severity === 'critique' ? 'text-rose-600 dark:text-rose-400' : vuln.severity === 'eleve' ? 'text-orange-600 dark:text-orange-400' : vuln.severity === 'moyen' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                  Impact {vuln.severity}
                                </span>
                                {vuln.cve && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-background text-foreground">{vuln.cve}</Badge>}
                                {isOverdue && <Badge variant="outline" className="bg-rose-500 text-white dark:bg-rose-500/20 dark:text-rose-400 border-none text-[10px] px-1 py-0 h-4 flex items-center gap-1"><Clock className="w-2.5 h-2.5"/> SLA dépassé</Badge>}
                                {showResolvedHistory && <Badge variant="outline" className="bg-emerald-500 text-white dark:bg-emerald-500/20 dark:text-emerald-400 border-none text-[10px] px-1 py-0 h-4">Corrigée</Badge>}
                              </div>
                              <h5 className="font-semibold text-sm line-clamp-2 text-foreground">{vuln.title}</h5>
                            </div>
                            {!showResolvedHistory && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 bg-background shadow-sm hover:bg-emerald-50 hover:text-emerald-600 border border-border flex-shrink-0" onClick={() => setVulnToClose(vuln.id)}>
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed mt-2 p-2 rounded border border-border/50 bg-background/50 text-foreground">
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

      <Dialog open={isAddProjectOpen} onOpenChange={setIsAddProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau Projet (PAS)</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom du Projet</Label>
              <Input required placeholder="Ex: Refonte de l'Intranet" value={newProject.name} onChange={(e) => setNewProject({...newProject, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Chef de Projet</Label>
              <Input placeholder="Ex: Jean Dupont" value={newProject.manager} onChange={(e) => setNewProject({...newProject, manager: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date de demande</Label>
                <Input required type="date" value={newProject.requestDate} onChange={(e) => setNewProject({...newProject, requestDate: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Date de mise en prod prévue</Label>
                <Input required type="date" value={newProject.goLiveDate} onChange={(e) => setNewProject({...newProject, goLiveDate: e.target.value})} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Niveau de Risque Métier</Label>
              <Select value={newProject.riskLevel} onValueChange={(v) => setNewProject({...newProject, riskLevel: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faible">Faible</SelectItem>
                  <SelectItem value="moyen">Moyen</SelectItem>
                  <SelectItem value="fort">Fort</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddProjectOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={addProjectMutation.isPending}>Ajouter au suivi</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!projectToEdit} onOpenChange={(open) => !open && setProjectToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le projet</DialogTitle>
          </DialogHeader>
          {projectToEdit && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateProjectMutation.mutate({ id: projectToEdit.id, updates: projectToEdit });
              setSelectedProject(projectToEdit);
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Nom du Projet</Label>
                <Input required placeholder="Ex: Refonte de l'Intranet" value={projectToEdit.name} onChange={(e) => setProjectToEdit({...projectToEdit, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Chef de Projet</Label>
                <Input placeholder="Ex: Jean Dupont" value={projectToEdit.manager || ""} onChange={(e) => setProjectToEdit({...projectToEdit, manager: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date de demande</Label>
                  <Input required type="date" value={projectToEdit.requestDate || ''} onChange={(e) => setProjectToEdit({...projectToEdit, requestDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Date de mise en prod</Label>
                  <Input required type="date" value={projectToEdit.goLiveDate} onChange={(e) => setProjectToEdit({...projectToEdit, goLiveDate: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Niveau de Risque Métier</Label>
                <Select value={projectToEdit.riskLevel} onValueChange={(v: any) => setProjectToEdit({...projectToEdit, riskLevel: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="faible">Faible</SelectItem>
                    <SelectItem value="moyen">Moyen</SelectItem>
                    <SelectItem value="fort">Fort</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setProjectToEdit(null)}>Annuler</Button>
                <Button type="submit" disabled={updateProjectMutation.isPending}>Enregistrer</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddAppOpen} onOpenChange={setIsAddAppOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau Périmètre d'Audit</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateApp} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom du périmètre</Label>
              <Input required placeholder="Ex: ERP, Site E-commerce, Active Directory" value={newApp.name} onChange={(e) => setNewApp({...newApp, name: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type d'audit prévu</Label>
                <Select value={newApp.auditType} onValueChange={(v) => setNewApp({...newApp, auditType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pentest">Test d'Intrusion (Pentest)</SelectItem>
                    <SelectItem value="architecture">Audit d'Architecture</SelectItem>
                    <SelectItem value="configuration">Audit de Configuration</SelectItem>
                    <SelectItem value="gouvernance">Audit Organisationnel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Criticité Métier</Label>
                <Select value={newApp.criticality} onValueChange={(v) => setNewApp({...newApp, criticality: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mineure">Mineure</SelectItem>
                    <SelectItem value="majeure">Majeure</SelectItem>
                    <SelectItem value="critique">Critique</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date de la dernière Analyse de Risques (EBIOS/PIA)</Label>
              <Input type="date" value={newApp.lastRiskAnalysisDate} onChange={(e) => setNewApp({...newApp, lastRiskAnalysisDate: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Date du dernier audit technique</Label>
              <Input type="date" value={newApp.lastAuditDate} onChange={(e) => setNewApp({...newApp, lastAuditDate: e.target.value})} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddAppOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={addAppMutation.isPending}>Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!appToEdit} onOpenChange={(open) => !open && setAppToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le Périmètre</DialogTitle>
          </DialogHeader>
          {appToEdit && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateAppMutation.mutate({ id: appToEdit.id, updates: appToEdit });
              setSelectedApp(appToEdit);
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Nom du Périmètre</Label>
                <Input required placeholder="Ex: ERP, Site E-commerce, Active Directory" value={appToEdit.name} onChange={(e) => setAppToEdit({...appToEdit, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type d'Audit</Label>
                  <Select value={appToEdit.auditType} onValueChange={(v: any) => setAppToEdit({...appToEdit, auditType: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pentest">Test d'Intrusion</SelectItem>
                      <SelectItem value="architecture">Audit d'Architecture</SelectItem>
                      <SelectItem value="configuration">Audit de Config</SelectItem>
                      <SelectItem value="gouvernance">Audit Organisationnel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Criticité Métier</Label>
                  <Select value={appToEdit.criticality} onValueChange={(v: any) => setAppToEdit({...appToEdit, criticality: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mineure">Mineure</SelectItem>
                      <SelectItem value="majeure">Majeure</SelectItem>
                      <SelectItem value="critique">Critique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fréquence Audit (mois)</Label>
                  <Input type="number" min="1" value={appToEdit.auditFrequencyMonths} onChange={(e) => setAppToEdit({...appToEdit, auditFrequencyMonths: parseInt(e.target.value) || 12})} />
                </div>
                <div className="space-y-2">
                  <Label>Fréq. Risques (mois)</Label>
                  <Input type="number" min="1" value={appToEdit.riskAnalysisFrequencyMonths} onChange={(e) => setAppToEdit({...appToEdit, riskAnalysisFrequencyMonths: parseInt(e.target.value) || 36})} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAppToEdit(null)}>Annuler</Button>
                <Button type="submit" disabled={updateAppMutation.isPending}>Enregistrer</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddVulnOpen} onOpenChange={setIsAddVulnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Déclarer un constat</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateVuln} className="space-y-4">
            <div className="space-y-2">
              <Label>Titre du constat</Label>
              <Input required placeholder="Ex: Injection SQL sur la page de login" value={newVuln.title} onChange={(e) => setNewVuln({...newVuln, title: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Référence CVE (Optionnel)</Label>
              <Input placeholder="Ex: CVE-2023-12345" value={newVuln.cve} onChange={(e) => setNewVuln({...newVuln, cve: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Impact métier (Vulgarisation)</Label>
              <Textarea required placeholder="Expliquez le risque avec des mots simples pour la direction. (Ex: Un attaquant pourrait extraire la base de données des clients sans avoir besoin de mot de passe...)" value={newVuln.description} onChange={(e) => setNewVuln({...newVuln, description: e.target.value})} className="h-24"/>
            </div>
            <div className="space-y-2">
              <Label>Sévérité</Label>
              <Select value={newVuln.severity} onValueChange={(v) => setNewVuln({...newVuln, severity: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faible">Faible</SelectItem>
                  <SelectItem value="moyen">Moyen</SelectItem>
                  <SelectItem value="eleve">Élevé</SelectItem>
                  <SelectItem value="critique">Critique</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddVulnOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={addVulnMutation.isPending}>Ajouter</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!projectStatusToUpdate} onOpenChange={(open) => !open && setProjectStatusToUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changement de statut (PAS)</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmez-vous le changement de statut de sécurité du projet <strong>{projectStatusToUpdate?.name}</strong> vers "{projectStatusToUpdate?.status}" ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!projectStatusToUpdate || !selectedProject) return;
              updateProjectMutation.mutate({ id: projectStatusToUpdate.id, updates: { pasStatus: projectStatusToUpdate.status as any } });
              setSelectedProject({ ...selectedProject, pasStatus: projectStatusToUpdate.status as any });
              setProjectStatusToUpdate(null);
            }}>Oui, modifier</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!appToMarkRiskAnalyzed} onOpenChange={(open) => !open && setAppToMarkRiskAnalyzed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Analyse de risques effectuée</AlertDialogTitle>
            <AlertDialogDescription>
              Marquer l'analyse de risques pour <strong>{appToMarkRiskAnalyzed?.name}</strong> comme ayant été mise à jour aujourd'hui ? Cela repoussera la prochaine échéance selon la fréquence configurée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => {
              if (!appToMarkRiskAnalyzed || !selectedApp) return;
              const today = new Date().toISOString().split('T')[0];
              updateAppMutation.mutate({ id: appToMarkRiskAnalyzed.id, updates: { lastRiskAnalysisDate: today } });
              setSelectedApp({ ...selectedApp, lastRiskAnalysisDate: today });
              setAppToMarkRiskAnalyzed(null);
            }}>Oui, marquer à jour</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!appToMarkAudited} onOpenChange={(open) => !open && setAppToMarkAudited(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renouveler l'audit</AlertDialogTitle>
            <AlertDialogDescription>
              Marquer <strong>{appToMarkAudited?.name}</strong> comme ayant été audité aujourd'hui ? Cela repoussera automatiquement la prochaine date d'échéance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
              if (!appToMarkAudited || !selectedApp) return;
              const today = new Date().toISOString().split('T')[0];
              updateAppMutation.mutate({ id: appToMarkAudited.id, updates: { lastAuditDate: today } });
              setSelectedApp({ ...selectedApp, lastAuditDate: today });
              setAppToMarkAudited(null);
            }}>Oui, marquer audité</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!vulnToClose} onOpenChange={(open) => !open && setVulnToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Correction validée</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmez-vous que cette vulnérabilité a été corrigée ? Elle sera archivée dans l'historique.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => {
              if (!vulnToClose) return;
              closeVulnMutation.mutate({ id: vulnToClose, status: 'resolu' });
            }}>Oui, clôturer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Supprimer ce projet ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible et supprimera le projet de vos indicateurs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (!projectToDelete) return;
              delProjectMutation.mutate(projectToDelete.id);
              setProjectToDelete(null);
            }}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!appToDelete} onOpenChange={(open) => !open && setAppToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Supprimer ce périmètre ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les vulnérabilités (actives et résolues) associées seront également supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (!appToDelete) return;
              delAppMutation.mutate(appToDelete.id);
              setAppToDelete(null);
            }}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}