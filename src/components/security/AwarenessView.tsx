import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPhishingCampaigns, createPhishingCampaign, deletePhishingCampaign,
  fetchPhishingProfiles, upsertPhishingProfiles, PhishingProfile,
  fetchElearningModules, createElearningModule, updateElearningModule, deleteElearningModule,
  PhishingCampaign, ElearningModule
} from "@/lib/supabase-awareness";
import { toast } from "sonner";

// COMPOSANTS UI
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ShieldAlert, GraduationCap, Users, Loader2, Trash2, Plus,
  TrendingUp, AlertTriangle, Upload, ShieldCheck, UserX, Activity,
  Mail, MousePointer, Key, Flag, Paperclip, BookOpen, Search, Filter,
  ArrowUpDown, ArrowDown, ArrowUp, Eye, Target, BarChart3
} from "lucide-react";

const calculatePercentage = (part: number, total: number) => {
  if (!total || total === 0) return 0;
  return Math.round((part / total) * 100);
};

export default function AwarenessView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("phishing");

  const [phishingView, setPhishingView] = useState<"historique" | "bilan">("historique");

  const [isAddCampaignOpen, setIsAddCampaignOpen] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);

  const [selectedCampaign, setSelectedCampaign] = useState<PhishingCampaign | null>(null);
  const [isRecidivistsDialogOpen, setIsRecidivistsDialogOpen] = useState(false);

  const [campaignToDelete, setCampaignToDelete] = useState<PhishingCampaign | null>(null);
  const [moduleToDelete, setModuleToDelete] = useState<ElearningModule | null>(null);

  const [profileSearch, setProfileSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const [newCampaign, setNewCampaign] = useState({
    name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen",
    targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0,
    compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [] as string[],
    detailedResults: [] as any[],
    fileLoaded: false
  });

  const [updatedProfilesBatch, setUpdatedProfilesBatch] = useState<PhishingProfile[]>([]);
  const [newModule, setNewModule] = useState({ name: "", targetAudience: "Tous", totalAssigned: 100, deadline: "" });

  const { data: campaigns = [], isLoading: isLoadingCampaigns } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [], isLoading: isLoadingProfiles } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [], isLoading: isLoadingModules } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  const addCampaignMutation = useMutation({
    mutationFn: async () => {
      await createPhishingCampaign(newCampaign as any);
      if (updatedProfilesBatch.length > 0) {
        await upsertPhishingProfiles(updatedProfilesBatch);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phishing'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success("Campagne et profils enregistrés avec succès !");
      setIsAddCampaignOpen(false);
      setNewCampaign({ name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen", targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0, compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [], detailedResults: [], fileLoaded: false });
      setUpdatedProfilesBatch([]);
    },
    onError: (error: any) => {
      console.error("Erreur d'insertion Supabase:", error);
      toast.error("Erreur technique : " + (error.message || "Vérifiez la base de données."));
    }
  });

  const delCampaignMutation = useMutation({
    mutationFn: async (campaign: PhishingCampaign) => {
      if (campaign.detailedResults && campaign.detailedResults.length > 0) {
        const currentProfiles = await fetchPhishingProfiles();
        const profilesMap = new Map(currentProfiles.map(p => [p.email, p]));
        const profilesToUpdate: PhishingProfile[] = [];

        campaign.detailedResults.forEach(res => {
          const p = profilesMap.get(res.email);
          if (p) {
            p.totalCampaigns = Math.max(0, p.totalCampaigns - 1);
            p.openedCount = Math.max(0, p.openedCount - (res.opened ? 1 : 0));
            p.attachmentOpenedCount = Math.max(0, p.attachmentOpenedCount - (res.attachment ? 1 : 0));
            p.clickedCount = Math.max(0, p.clickedCount - (res.clicked ? 1 : 0));
            p.compromisedCount = Math.max(0, p.compromisedCount - (res.compromised ? 1 : 0));
            p.trainingCompletedCount = Math.max(0, p.trainingCompletedCount - (res.training ? 1 : 0));
            p.reportedCount = Math.max(0, p.reportedCount - (res.reported ? 1 : 0));

            let riskScore = (p.clickedCount * 20) + (p.attachmentOpenedCount * 20) + (p.compromisedCount * 40) - (p.reportedCount * 10) - (p.trainingCompletedCount * 5);
            p.riskScore = Math.min(100, Math.max(0, riskScore));

            if (p.clickedCount === 0 && p.attachmentOpenedCount === 0) {
              p.isConsecutive = false;
              p.lastCampaignClicked = false;
            }
            profilesToUpdate.push(p);
          }
        });

        if (profilesToUpdate.length > 0) {
          await upsertPhishingProfiles(profilesToUpdate);
        }
      }
      await deletePhishingCampaign(campaign.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phishing'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success("Campagne supprimée et profils mis à jour !");
      setSelectedCampaign(null);
      setIsRecidivistsDialogOpen(false);
    }
  });

  const addModuleMutation = useMutation({ mutationFn: createElearningModule, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Module ajouté"); setIsAddModuleOpen(false); } });
  const updateModuleMutation = useMutation({ mutationFn: ({ id, updates }: { id: string, updates: Partial<ElearningModule> }) => updateElearningModule(id, updates), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Mise à jour effectuée"); } });
  const delModuleMutation = useMutation({ mutationFn: deleteElearningModule, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Module supprimé"); } });

  const handleProofpointUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      if (lines.length < 2) return toast.error("Fichier vide ou invalide.");

      const headers = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));

      const idxEmail = headers.findIndex(h => h === 'Email Address');
      const idxFirstName = headers.findIndex(h => h === 'First Name');
      const idxLastName = headers.findIndex(h => h === 'Last Name');
      const idxOrg = headers.findIndex(h => h === 'DOMAINE' || h === 'ORGANISATION' || h === 'Group' || h === 'EMPLOI');

      const idxOpened = headers.findIndex(h => h === 'Date Email Opened' || h === 'Primary Email Opened');
      const idxAttachment = headers.findIndex(h => h === 'Primary Attachment Opened' || h === 'Attachment Opened');
      const idxClicked = headers.findIndex(h => h === 'Date Clicked' || h === 'Primary Clicked');
      const idxCompromised = headers.findIndex(h => h === 'Primary Compromised Login' || h === 'Weak Egress');
      const idxTraining = headers.findIndex(h => h === 'Acknowledgement Completed');
      const idxReported = headers.findIndex(h => h === 'Date Reported' || h === 'Reported');

      if (idxEmail === -1) return toast.error("Colonne 'Email Address' introuvable dans le CSV.");

      let target = 0, opened = 0, attachmentOpened = 0, clicked = 0, compromised = 0, trainingCompleted = 0, reported = 0, recidivists = 0;
      let failedEmails: string[] = [];
      let updatedProfiles: PhishingProfile[] = [];
      let detailedResults: any[] = [];

      const existingProfilesMap = new Map(profiles.map(p => [p.email, p]));

      lines.forEach((line, index) => {
        if (index === 0 || !line.trim()) return;
        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < headers.length - 2) return;

        const email = cols[idxEmail].toLowerCase();
        const firstName = idxFirstName !== -1 ? cols[idxFirstName] : '';
        const lastName = idxLastName !== -1 ? cols[idxLastName] : '';
        const department = idxOrg !== -1 ? cols[idxOrg] : '';

        let hasOpened = idxOpened !== -1 && cols[idxOpened] && cols[idxOpened].length > 0 && cols[idxOpened].toLowerCase() !== 'false' && cols[idxOpened].toLowerCase() !== 'no';
        let hasAttachmentOpened = idxAttachment !== -1 && cols[idxAttachment] && cols[idxAttachment].length > 0 && cols[idxAttachment].toLowerCase() !== 'false' && cols[idxAttachment].toLowerCase() !== 'no';
        let hasClicked = idxClicked !== -1 && cols[idxClicked] && cols[idxClicked].length > 0 && cols[idxClicked].toLowerCase() !== 'false' && cols[idxClicked].toLowerCase() !== 'no';
        let hasCompromised = idxCompromised !== -1 && cols[idxCompromised] && cols[idxCompromised].length > 0 && cols[idxCompromised].toLowerCase() !== 'false' && cols[idxCompromised].toLowerCase() !== 'no';
        let hasTraining = idxTraining !== -1 && cols[idxTraining] && cols[idxTraining].length > 0 && cols[idxTraining].toLowerCase() !== 'false' && cols[idxTraining].toLowerCase() !== 'no';
        const hasReported = idxReported !== -1 && cols[idxReported] && cols[idxReported].length > 0 && cols[idxReported].toLowerCase() !== 'false' && cols[idxReported].toLowerCase() !== 'no';

        if (hasTraining) hasClicked = true;
        if (hasCompromised) hasClicked = true;
        if (hasClicked || hasAttachmentOpened) hasOpened = true;

        target++;
        if (hasOpened) opened++;
        if (hasAttachmentOpened) attachmentOpened++;
        if (hasClicked) {
          clicked++;
          failedEmails.push(email);
        }
        if (hasCompromised) compromised++;
        if (hasTraining) trainingCompleted++;
        if (hasReported) reported++;

        const existing = existingProfilesMap.get(email) || {
          email, firstName, lastName, department,
          totalCampaigns: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0, compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0,
          riskScore: 0, lastCampaignClicked: false, isConsecutive: false
        };

        const newOpenedCount = existing.openedCount + (hasOpened ? 1 : 0);
        const newAttachmentCount = (existing.attachmentOpenedCount || 0) + (hasAttachmentOpened ? 1 : 0);
        const newClickedCount = existing.clickedCount + (hasClicked ? 1 : 0);
        const newCompromisedCount = existing.compromisedCount + (hasCompromised ? 1 : 0);
        const newTrainingCount = (existing.trainingCompletedCount || 0) + (hasTraining ? 1 : 0);
        const newReportedCount = existing.reportedCount + (hasReported ? 1 : 0);
        const newTotalCampaigns = existing.totalCampaigns + 1;

        const fellThisTime = hasClicked || hasAttachmentOpened;
        const fellInPast = existing.clickedCount > 0 || (existing.attachmentOpenedCount && existing.attachmentOpenedCount > 0);
        const isRecidivist = fellThisTime && fellInPast;
        if (isRecidivist) recidivists++;

        detailedResults.push({
          email,
          opened: hasOpened,
          attachment: hasAttachmentOpened,
          clicked: hasClicked,
          compromised: hasCompromised,
          training: hasTraining,
          reported: hasReported,
          isRecidivist: isRecidivist
        });

        let riskScore = (newClickedCount * 20) + (newAttachmentCount * 20) + (newCompromisedCount * 40) - (newReportedCount * 10) - (newTrainingCount * 5);
        if (existing.lastCampaignClicked && fellThisTime) riskScore += 20;
        riskScore = Math.min(100, Math.max(0, riskScore));

        updatedProfiles.push({
          email, firstName, lastName, department,
          totalCampaigns: newTotalCampaigns,
          openedCount: newOpenedCount,
          attachmentOpenedCount: newAttachmentCount,
          clickedCount: newClickedCount,
          compromisedCount: newCompromisedCount,
          trainingCompletedCount: newTrainingCount,
          reportedCount: newReportedCount,
          riskScore: riskScore,
          lastCampaignClicked: fellThisTime,
          isConsecutive: (existing.lastCampaignClicked && fellThisTime)
        });
      });

      setUpdatedProfilesBatch(updatedProfiles);
      setNewCampaign(prev => ({
        ...prev, targetCount: target, openedCount: opened, attachmentOpenedCount: attachmentOpened,
        clickedCount: clicked, compromisedCount: compromised, trainingCompletedCount: trainingCompleted,
        reportedCount: reported, recidivistsCount: recidivists, failedEmails: failedEmails,
        detailedResults: detailedResults,
        fileLoaded: true
      }));

      toast.success(`Analyse terminée : ${target} collaborateurs traités.`);
    };
    reader.readAsText(file);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return <ArrowUpDown className="w-4 h-4 ml-1 opacity-50 inline" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 ml-1 inline" /> : <ArrowDown className="w-4 h-4 ml-1 inline" />;
  };

  const uniqueDepartments = Array.from(new Set(profiles.map(p => p.department).filter(d => d && d.trim() !== ""))).sort();

  const filteredProfiles = profiles.filter(p => {
    const searchLower = profileSearch.toLowerCase();
    const matchesSearch =
      p.firstName.toLowerCase().includes(searchLower) ||
      p.lastName.toLowerCase().includes(searchLower) ||
      p.email.toLowerCase().includes(searchLower);

    const matchesDept = departmentFilter === "all" || p.department === departmentFilter;

    let matchesRisk = true;
    if (riskFilter === "high") matchesRisk = p.riskScore >= 60;
    else if (riskFilter === "moderate") matchesRisk = p.riskScore >= 30 && p.riskScore < 60;
    else if (riskFilter === "low") matchesRisk = p.riskScore < 30;

    return matchesSearch && matchesDept && matchesRisk;
  });

  const sortedAndFilteredProfiles = [...filteredProfiles].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    let valA: any, valB: any;

    switch (key) {
      case 'name':
        valA = `${a.lastName} ${a.firstName}`.toLowerCase();
        valB = `${b.lastName} ${b.firstName}`.toLowerCase();
        break;
      case 'department':
        valA = a.department || "";
        valB = b.department || "";
        break;
      case 'behavior':
        valA = a.clickedCount + (a.attachmentOpenedCount || 0) + a.compromisedCount;
        valB = b.clickedCount + (b.attachmentOpenedCount || 0) + b.compromisedCount;
        break;
      case 'recidive':
        valA = a.isConsecutive ? 1 : 0;
        valB = b.isConsecutive ? 1 : 0;
        break;
      case 'score':
        valA = a.riskScore;
        valB = b.riskScore;
        break;
      default:
        return 0;
    }

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  if (isLoadingCampaigns || isLoadingProfiles || isLoadingModules) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const highRiskProfiles = profiles.filter(p => p.riskScore >= 60);

  const currentYear = new Date().getFullYear();
  const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === currentYear);
  const targetCampaignsPerYear = 4;
  const campaignProgress = Math.min(100, Math.round((campaignsThisYear.length / targetCampaignsPerYear) * 100));
  const isGoalReached = campaignsThisYear.length >= targetCampaignsPerYear;

  const totalMailsSent = campaigns.reduce((acc, c) => acc + c.targetCount, 0);
  const avgClickRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + c.clickedCount, 0) / totalMailsSent) * 100) : 0;
  const avgCompromiseRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + c.compromisedCount, 0) / totalMailsSent) * 100) : 0;
  const avgReportRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + c.reportedCount, 0) / totalMailsSent) * 100) : 0;

  // PRÉPARATION DES DONNÉES POUR LE GRAPHIQUE
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(a.sendDate).getTime() - new Date(b.sendDate).getTime());

  return (
    <div className="space-y-6">

      {/* KPIs : GRILLE */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">

        <Card className={`border-l-4 shadow-sm ${isGoalReached ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Campagnes en {currentYear}</CardTitle>
            <Target className={`w-4 h-4 ${isGoalReached ? 'text-emerald-500' : 'text-blue-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-baseline gap-1">
              {campaignsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ {targetCampaignsPerYear}</span>
            </div>
            <Progress value={campaignProgress} className={`h-1.5 mt-2 ${isGoalReached ? '[&>div]:bg-emerald-500' : ''}`} />
            <p className="text-[10px] text-muted-foreground mt-2">Objectif annuel</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${campaigns.length > 0 && (campaigns[0].compromisedCount / campaigns[0].targetCount * 100) > 5 ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de compromission</CardTitle>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? Math.round((campaigns[0].compromisedCount / campaigns[0].targetCount) * 100) : 0}%</div>
            <p className="text-[10px] text-muted-foreground mt-2">Dernière campagne</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de signalement</CardTitle>
            <ShieldCheck className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? Math.round((campaigns[0].reportedCount / campaigns[0].targetCount) * 100) : 0}%</div>
            <p className="text-[10px] text-muted-foreground mt-2">Dernière campagne</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm ${highRiskProfiles.length > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Profils à risque (&gt; 60)</CardTitle>
            <UserX className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highRiskProfiles.length}</div>
            <p className="text-[10px] text-muted-foreground mt-2">Récidivistes à accompagner</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Couverture E-Learning</CardTitle>
            <GraduationCap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{modules.length > 0 && modules.reduce((a,b)=>a+b.totalAssigned,0) > 0 ? Math.round((modules.reduce((a,b)=>a+b.completedCount,0) / modules.reduce((a,b)=>a+b.totalAssigned,0)) * 100) : 0}%</div>
            <p className="text-[10px] text-muted-foreground mt-2">Collaborateurs formés</p>
          </CardContent>
        </Card>
      </div>

      {/* TABS */}
      <Card className="shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b flex justify-between items-center flex-wrap gap-4">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="phishing" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">Campagnes</TabsTrigger>
              <TabsTrigger value="profilage" className="data-[state=active]:border-b-2 data-[state=active]:border-amber-500 rounded-none pb-3">Profilage des Risques</TabsTrigger>
              <TabsTrigger value="elearning" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">E-Learning</TabsTrigger>
            </TabsList>

            {activeTab === "profilage" ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mb-2 cursor-not-allowed">
                      <Button size="sm" variant="secondary" disabled className="pointer-events-none">
                        Générer un rapport
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>À venir</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button size="sm" onClick={() => activeTab === "phishing" ? setIsAddCampaignOpen(true) : setIsAddModuleOpen(true)} className="mb-2">
                {activeTab === "phishing" ? <><Upload className="w-4 h-4 mr-2" /> Import Proofpoint</> : <><Plus className="w-4 h-4 mr-2" /> Nouveau Module</>}
              </Button>
            )}
          </div>

          <TabsContent value="phishing" className="m-0">
            {/* SOUS-MENU DE VUE CAMPAGNES */}
            {campaigns.length > 0 && (
              <div className="px-6 py-4 flex gap-2 border-b border-border bg-muted/10">
                <Button variant={phishingView === "historique" ? "default" : "outline"} size="sm" onClick={() => setPhishingView("historique")}>
                  <Activity className="w-4 h-4 mr-2" /> Historique et Tableau
                </Button>
                <Button variant={phishingView === "bilan" ? "default" : "outline"} size="sm" onClick={() => setPhishingView("bilan")}>
                  <BarChart3 className="w-4 h-4 mr-2" /> Bilan et Évolution
                </Button>
              </div>
            )}

            {campaigns.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Aucune campagne. Importez un CSV Proofpoint pour commencer.</div>
            ) : phishingView === "historique" ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Scénario</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Cibles</TableHead>
                    <TableHead>Ouverts</TableHead>
                    <TableHead>Taux Clic</TableHead>
                    <TableHead>Compromissions</TableHead>
                    <TableHead>Mini-Formation</TableHead>
                    <TableHead className="text-right">Signalements</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCampaign(c)}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(c.sendDate).toLocaleDateString()}</TableCell>
                      <TableCell>{c.targetCount}</TableCell>
                      <TableCell className="text-blue-600 dark:text-blue-400 font-medium">{Math.round((c.openedCount/c.targetCount)*100)}%</TableCell>
                      <TableCell className="font-medium text-amber-600 dark:text-amber-500">{Math.round((c.clickedCount/c.targetCount)*100)}%</TableCell>
                      <TableCell className="font-bold text-rose-600 dark:text-rose-500">{Math.round((c.compromisedCount/c.targetCount)*100)}%</TableCell>
                      <TableCell className="text-indigo-600 dark:text-indigo-400 font-medium">
                        {Math.round(((c.trainingCompletedCount||0)/c.targetCount)*100)}%
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-500 font-medium">{Math.round((c.reportedCount/c.targetCount)*100)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              // --- VUE BILAN GLOBAL AVEC LE GRAPHIQUE EN COURBES ---
              <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-300">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                   <Card className="shadow-sm">
                     <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mails envoyés</CardTitle></CardHeader>
                     <CardContent><div className="text-2xl font-bold">{totalMailsSent.toLocaleString()}</div></CardContent>
                   </Card>
                   <Card className="shadow-sm border-amber-500/50 bg-amber-500/5">
                     <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-amber-700 dark:text-amber-500 uppercase tracking-wider">Clic moyen</CardTitle></CardHeader>
                     <CardContent><div className="text-2xl font-bold text-amber-700 dark:text-amber-500">{avgClickRate}%</div></CardContent>
                   </Card>
                   <Card className="shadow-sm border-rose-500/50 bg-rose-500/5">
                     <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-rose-700 dark:text-rose-500 uppercase tracking-wider">Compromission moy.</CardTitle></CardHeader>
                     <CardContent><div className="text-2xl font-bold text-rose-700 dark:text-rose-500">{avgCompromiseRate}%</div></CardContent>
                   </Card>
                   <Card className="shadow-sm border-emerald-500/50 bg-emerald-500/5">
                     <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-emerald-700 dark:text-emerald-500 uppercase tracking-wider">Signalement moyen</CardTitle></CardHeader>
                     <CardContent><div className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{avgReportRate}%</div></CardContent>
                   </Card>
                </div>

                {/* REMPLACEZ TOUT LE BLOC DU GRAPHIQUE SVG PAR CELUI-CI */}
                <Card className="shadow-sm border-muted">
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" /> Évolution des risques
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Échelle dynamique basée sur vos résultats réels.</p>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      // 1. Calcul de la valeur maximale pour l'échelle (avec une marge de sécurité)
                      const allValues = sortedCampaigns.flatMap(c => [
                        calculatePercentage(c.clickedCount, c.targetCount),
                        calculatePercentage(c.compromisedCount, c.targetCount)
                      ]);
                      const maxValueInData = Math.max(...allValues, 10); // Minimum 10% pour l'esthétique
                      const scaleMax = Math.ceil(maxValueInData / 5) * 5 + 5; // Arrondi au 5 sup + marge

                      return (
                        <div className="relative w-full h-64 mt-8 mb-8 border-b border-l border-muted ml-4">
                          {/* Lignes de repère dynamiques */}
                          {[0, 0.5, 1].map((ratio) => (
                            <div
                              key={ratio}
                              className="absolute w-full border-t border-dashed border-muted/50 pointer-events-none"
                              style={{ top: `${(1 - ratio) * 100}%` }}
                            >
                              <span className="absolute -left-10 -top-2 text-[10px] text-muted-foreground w-8 text-right">
                                {Math.round(ratio * scaleMax)}%
                              </span>
                            </div>
                          ))}

                          {/* Graphique SVG */}
                          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                            {/* Courbe Clics */}
                            <polyline
                              points={sortedCampaigns.map((c, i) => {
                                const x = sortedCampaigns.length > 1 ? (i / (sortedCampaigns.length - 1)) * 100 : 50;
                                const y = 100 - (calculatePercentage(c.clickedCount, c.targetCount) / scaleMax * 100);
                                return `${x},${y}`;
                              }).join(' ')}
                              fill="none"
                              className="stroke-amber-500"
                              strokeWidth="3"
                              vectorEffect="non-scaling-stroke"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                            {/* Courbe Compromissions */}
                            <polyline
                              points={sortedCampaigns.map((c, i) => {
                                const x = sortedCampaigns.length > 1 ? (i / (sortedCampaigns.length - 1)) * 100 : 50;
                                const y = 100 - (calculatePercentage(c.compromisedCount, c.targetCount) / scaleMax * 100);
                                return `${x},${y}`;
                              }).join(' ')}
                              fill="none"
                              className="stroke-rose-500"
                              strokeWidth="3"
                              vectorEffect="non-scaling-stroke"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          </svg>

                          {/* Points interactifs */}
                          {sortedCampaigns.map((c, i) => {
                            const x = sortedCampaigns.length > 1 ? (i / (sortedCampaigns.length - 1)) * 100 : 50;
                            const clickRate = calculatePercentage(c.clickedCount, c.targetCount);
                            const compRate = calculatePercentage(c.compromisedCount, c.targetCount);

                            return (
                              <div key={c.id} className="absolute top-0 bottom-0 w-8 -ml-4 group cursor-crosshair z-10" style={{ left: `${x}%` }}>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 opacity-0 group-hover:opacity-100 transition-opacity bg-popover border p-2 rounded shadow-xl pointer-events-none whitespace-nowrap z-50 text-[11px]">
                                  <p className="font-bold border-b mb-1">{c.name}</p>
                                  <p className="text-amber-600">Clics : {clickRate}%</p>
                                  <p className="text-rose-600">Saisies : {compRate}%</p>
                                </div>
                                {/* Dots positionnés selon l'échelle dynamique */}
                                <div className="absolute w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-background left-1/2 -translate-x-1/2" style={{ top: `${100 - (clickRate / scaleMax * 100)}%`, marginTop: '-5px' }}></div>
                                <div className="absolute w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-background left-1/2 -translate-x-1/2" style={{ top: `${100 - (compRate / scaleMax * 100)}%`, marginTop: '-5px' }}></div>
                                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
                                  {new Date(c.sendDate).toLocaleDateString(undefined, {month: 'short'})}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    <div className="flex justify-center gap-6 mt-10">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 bg-amber-500 rounded-full"></div> Clics</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 bg-rose-500 rounded-full"></div> Compromissions</div>
                    </div>
                  </CardContent>
                </Card>              </div>
            )}
          </TabsContent>

          <TabsContent value="profilage" className="p-6">
            {profiles.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">Les profils se génèrent automatiquement lors de l'import CSV.</div>
            ) : (
            <div className="space-y-4">

              <div className="flex flex-col sm:flex-row gap-4 items-end bg-muted/20 p-3 rounded-lg border border-border">
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Chercher un nom, email..."
                    className="pl-9 bg-background"
                    value={profileSearch}
                    onChange={(e) => setProfileSearch(e.target.value)}
                  />
                </div>

                <div className="w-full sm:w-48">
                  <Label className="text-xs text-muted-foreground mb-1 block">Département</Label>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Tous" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les départements</SelectItem>
                      {uniqueDepartments.map(dept => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full sm:w-48">
                  <Label className="text-xs text-muted-foreground mb-1 block">Niveau de risque</Label>
                  <Select value={riskFilter} onValueChange={setRiskFilter}>
                    <SelectTrigger className="bg-background flex items-center gap-2"><SelectValue placeholder="Tous" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les niveaux</SelectItem>
                      <SelectItem value="high"><span className="text-rose-500 font-medium">Risque Élevé (&ge; 60)</span></SelectItem>
                      <SelectItem value="moderate"><span className="text-amber-500 font-medium">Risque Modéré (30-59)</span></SelectItem>
                      <SelectItem value="low"><span className="text-emerald-500 font-medium">Risque Faible (&lt; 30)</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {sortedAndFilteredProfiles.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">Aucun collaborateur ne correspond à ces critères.</div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('name')}>
                          <div className="flex items-center">Collaborateur {getSortIcon('name')}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('department')}>
                          <div className="flex items-center">Département {getSortIcon('department')}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('behavior')}>
                          <div className="flex items-center">Comportement {getSortIcon('behavior')}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('recidive')}>
                          <div className="flex items-center">Récidive {getSortIcon('recidive')}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors text-right" onClick={() => handleSort('score')}>
                          <div className="flex items-center justify-end">Risk Score {getSortIcon('score')}</div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedAndFilteredProfiles.map((p) => (
                        <TableRow key={p.email}>
                          <TableCell>
                            <div className="font-medium">{p.firstName} {p.lastName}</div>
                            <div className="text-xs text-muted-foreground">{p.email}</div>
                          </TableCell>
                          <TableCell className="text-sm">{p.department || "-"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2 items-center text-xs">
                              <Badge variant="outline" className="bg-muted/50 border-transparent">Cibles: {p.totalCampaigns}</Badge>
                              {p.openedCount > 0 && <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200">Ouverts: {p.openedCount}</Badge>}
                              {(p.attachmentOpenedCount || 0) > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">PJ: {p.attachmentOpenedCount}</Badge>}
                              {p.clickedCount > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">Clics: {p.clickedCount}</Badge>}
                              {p.compromisedCount > 0 && <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-200 font-bold">Saisies: {p.compromisedCount}</Badge>}
                              {(p.trainingCompletedCount || 0) > 0 && <Badge variant="outline" className="bg-indigo-500/10 text-indigo-600 border-indigo-200">Formations lues: {p.trainingCompletedCount}</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.isConsecutive ? <Badge variant="outline" className="bg-rose-500 text-white border-transparent">Oui (Alerte)</Badge> : <span className="text-muted-foreground text-sm">Non</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold ${
                              p.riskScore >= 60 ? 'bg-rose-100 text-rose-700 border-2 border-rose-500 dark:bg-rose-900/30 dark:text-rose-400' :
                              p.riskScore >= 30 ? 'bg-amber-100 text-amber-700 border-2 border-amber-500 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                            }`}>
                              {p.riskScore}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            )}
          </TabsContent>

            <TabsContent value="elearning" className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* Carte d'ajout de module */}
                <Card
                  className="border-dashed border-2 flex flex-col items-center justify-center p-6 hover:bg-muted/50 cursor-pointer transition-colors min-h-[200px]"
                  onClick={() => setIsAddModuleOpen(true)}
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <p className="font-semibold text-primary">Nouveau module</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">Assigner une nouvelle formation à un groupe</p>
                </Card>

                {/* Liste des modules existants */}
                {modules.map((m) => {
                  const completionRate = Math.round((m.completedCount / m.totalAssigned) * 100) || 0;

                  return (
                    <Card key={m.id} className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <Badge variant="secondary" className="mb-2">{m.targetAudience}</Badge>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setModuleToDelete(m)}>
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                        <CardTitle className="text-lg">{m.name}</CardTitle>
                      </CardHeader>

                      <CardContent className="flex-1 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Progression</span>
                            <span className="font-bold">{completionRate}%</span>
                          </div>
                          <Progress value={completionRate} className="h-2" />
                        </div>

                        <div className="flex items-center justify-between text-xs py-2 border-t border-border">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Users className="w-3 h-3" />
                            <span>{m.completedCount} / {m.totalAssigned} validés</span>
                          </div>
                          {m.deadline && (
                            <div className="flex items-center gap-1 text-amber-600 font-medium">
                              <CalendarDays className="w-3 h-3" />
                              <span>Échéance: {new Date(m.deadline).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>

                      <div className="p-4 bg-muted/30 border-t flex gap-2">
                        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => toast.info("Détails bientôt disponibles")}>
                          <Eye className="w-3 h-3 mr-2" /> Détails
                        </Button>
                        <Button variant="outline" size="sm" className="w-full text-xs text-primary border-primary/20 hover:bg-primary/5" onClick={() => toast.success("Relance envoyée aux retardataires")}>
                          <Mail className="w-3 h-3 mr-2" /> Relancer
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {modules.length === 0 && (
                <div className="text-center py-20 bg-muted/10 rounded-xl border-2 border-dashed mt-6">
                  <GraduationCap className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                  <p className="text-muted-foreground font-medium">Aucun module de formation actif.</p>
                  <p className="text-xs text-muted-foreground mt-1">Commencez par assigner un module de sensibilisation à vos collaborateurs.</p>
                </div>
              )}
            </TabsContent>        </Tabs>
      </Card>

      {/* PANNEAU LATÉRAL (DÉTAILS CAMPAGNE) */}
      <Sheet open={!!selectedCampaign} onOpenChange={(open) => {
        if(!open) {
          setSelectedCampaign(null);
        }
      }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl">{selectedCampaign?.name}</SheetTitle>
            <SheetDescription>Analyse détaillée du scénario</SheetDescription>
          </SheetHeader>

          {selectedCampaign && (
            <div className="space-y-6">

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-border rounded-lg bg-card text-center space-y-1 shadow-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cibles</p>
                  <p className="text-2xl font-bold">{selectedCampaign.targetCount}</p>
                </div>

                {/* CARTE RÉCIDIVISTE QUI OUVRE LE POP-UP */}
                <div
                  className={`p-4 border rounded-lg text-center space-y-1 shadow-sm transition-all ${selectedCampaign.recidivistsCount > 0 ? 'bg-amber-500/10 border-amber-500/30 cursor-pointer hover:bg-amber-500/20 hover:scale-[1.02]' : 'bg-amber-500/5 border-amber-500/10 opacity-50'}`}
                  onClick={() => {
                    if (selectedCampaign.recidivistsCount > 0) setIsRecidivistsDialogOpen(true);
                  }}
                >
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider">Récidivistes</p>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-500">{selectedCampaign.recidivistsCount}</p>
                  {selectedCampaign.recidivistsCount > 0 && (
                    <p className="text-[10px] text-amber-600/60 mt-1 flex items-center justify-center gap-1">
                      <Eye className="w-3 h-3" /> Voir la liste
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Entonnoir de conversion
                </h4>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
                    <span className="text-sm font-medium flex items-center gap-2 text-blue-700 dark:text-blue-400"><Mail className="w-4 h-4"/> Mails ouverts</span>
                    <span className="font-bold text-blue-700 dark:text-blue-400">{selectedCampaign.openedCount} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.openedCount, selectedCampaign.targetCount)}%)</span></span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-md bg-amber-500/10 border border-amber-500/20 ml-4">
                    <span className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-500"><MousePointer className="w-4 h-4"/> Liens cliqués</span>
                    <span className="font-bold text-amber-700 dark:text-amber-500">{selectedCampaign.clickedCount} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.clickedCount, selectedCampaign.targetCount)}%)</span></span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-md bg-amber-500/10 border border-amber-500/20 ml-4">
                    <span className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-500"><Paperclip className="w-4 h-4"/> PJ Ouvertes</span>
                    <span className="font-bold text-amber-700 dark:text-amber-500">{selectedCampaign.attachmentOpenedCount || 0} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.attachmentOpenedCount || 0, selectedCampaign.targetCount)}%)</span></span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-md bg-rose-500/10 border border-rose-500/20 ml-8">
                    <span className="text-sm font-medium flex items-center gap-2 text-rose-700 dark:text-rose-400"><Key className="w-4 h-4"/> Saisies (Compromis)</span>
                    <span className="font-bold text-rose-700 dark:text-rose-400">{selectedCampaign.compromisedCount} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.compromisedCount, selectedCampaign.targetCount)}%)</span></span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-md bg-indigo-500/10 border border-indigo-500/20 ml-12 mt-2">
                    <span className="text-sm font-medium flex items-center gap-2 text-indigo-700 dark:text-indigo-400"><BookOpen className="w-4 h-4"/> Formations lues</span>
                    <span className="font-bold text-indigo-700 dark:text-indigo-400">{selectedCampaign.trainingCompletedCount || 0} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.trainingCompletedCount || 0, selectedCampaign.targetCount)}%)</span></span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 mt-6">
                    <span className="text-sm font-medium flex items-center gap-2 text-emerald-700 dark:text-emerald-400"><Flag className="w-4 h-4"/> Signalements SSI</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">{selectedCampaign.reportedCount} <span className="opacity-70 text-xs font-normal">({calculatePercentage(selectedCampaign.reportedCount, selectedCampaign.targetCount)}%)</span></span>
                  </div>
                </div>
              </div>

              <div className="mt-12 pt-6 border-t border-border">
                {/* Ouvre la modale de confirmation de suppression */}
                <Button variant="destructive" className="w-full" onClick={() => setCampaignToDelete(selectedCampaign)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Supprimer et annuler l'impact
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* --- LE POP-UP MODAL DES RÉCIDIVISTES --- */}
      <Dialog open={isRecidivistsDialogOpen} onOpenChange={setIsRecidivistsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Collaborateurs Récidivistes
            </DialogTitle>
            <DialogDescription>
              Liste des collaborateurs qui sont tombés dans le piège de cette campagne (clic ou pièce jointe) et qui possédaient déjà un historique de risque.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 border rounded-md max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 backdrop-blur-md">
                <TableRow>
                  <TableHead>Collaborateur</TableHead>
                  <TableHead>Département</TableHead>
                  <TableHead className="text-right">Risk Score actuel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedCampaign?.detailedResults?.filter(r => r.isRecidivist).map(r => {
                  const profile = profiles.find(p => p.email === r.email);
                  return (
                    <TableRow key={r.email}>
                      <TableCell>
                        <div className="font-medium">{profile ? `${profile.firstName} ${profile.lastName}` : "Utilisateur Inconnu"}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {profile?.department || "Non assigné"}
                      </TableCell>
                      <TableCell className="text-right">
                        {profile ? (
                          <Badge variant="outline" className={`font-bold ${
                            profile.riskScore >= 60 ? 'bg-rose-100 text-rose-700 border-rose-200' :
                            profile.riskScore >= 30 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                            'bg-emerald-100 text-emerald-700 border-emerald-200'
                          }`}>
                            {profile.riskScore} pts
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {(!selectedCampaign?.detailedResults || selectedCampaign.detailedResults.filter(r => r.isRecidivist).length === 0) && (
              <div className="p-8 text-center text-muted-foreground italic text-sm">
                Aucun détail disponible. Veuillez réimporter le fichier CSV de cette campagne pour afficher cette liste.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MODALE D'IMPORT CSV */}
      <Dialog open={isAddCampaignOpen} onOpenChange={(open) => { setIsAddCampaignOpen(open); if(!open) setNewCampaign({ name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen", targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0, compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [], detailedResults: [], fileLoaded: false }); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Importer les résultats Proofpoint</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nom du Scénario</Label><Input placeholder="Ex: Campagne Faux Colis DHL" value={newCampaign.name} onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})} /></div>

            <div className="space-y-2">
              <Label>Date d'envoi</Label>
              <Input type="date" value={newCampaign.sendDate} onChange={(e) => setNewCampaign({...newCampaign, sendDate: e.target.value})} />
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Label className="flex items-center gap-2"><Upload className="w-4 h-4 text-primary"/> Fichier d'export (CSV Proofpoint)</Label>
              <Input type="file" accept=".csv" onChange={handleProofpointUpload} className="cursor-pointer" />
            </div>

            {newCampaign.fileLoaded && (
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 mt-4 space-y-2">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="w-4 h-4"/> Bilan de l'analyse</h4>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Cibles:</span> <span className="font-medium text-right">{newCampaign.targetCount}</span>
                  <span className="text-blue-600">Mails ouverts:</span> <span className="font-medium text-right text-blue-600">{newCampaign.openedCount}</span>
                  <span className="text-amber-600 flex items-center gap-1"><Paperclip className="w-3 h-3"/> PJ Ouvertes:</span> <span className="font-medium text-right text-amber-600">{newCampaign.attachmentOpenedCount}</span>
                  <span className="text-amber-600 flex items-center gap-1"><MousePointer className="w-3 h-3"/> Liens cliqués:</span> <span className="font-medium text-right text-amber-600">{newCampaign.clickedCount}</span>
                  <span className="text-rose-600 font-medium">Saisies (Compromis):</span> <span className="font-bold text-rose-600 text-right">{newCampaign.compromisedCount}</span>
                  <span className="text-indigo-600">Formations lues:</span> <span className="font-medium text-indigo-600 text-right">{newCampaign.trainingCompletedCount}</span>
                  <span className="text-emerald-600 col-span-2 flex justify-between mt-1 pt-1 border-t border-primary/10">Signalements SSI: <span className="font-medium text-right">{newCampaign.reportedCount}</span></span>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              disabled={!newCampaign.fileLoaded || !newCampaign.name || !newCampaign.sendDate || addCampaignMutation.isPending}
              onClick={() => addCampaignMutation.mutate()}
            >
              {addCampaignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enregistrer et mettre à jour l'annuaire"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- MODALES DE CONFIRMATION DE SUPPRESSION --- */}
      <AlertDialog open={!!campaignToDelete} onOpenChange={(open) => !open && setCampaignToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Supprimer définitivement la campagne ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 mt-2 text-sm text-muted-foreground">
                <div>Êtes-vous absolument sûr de vouloir supprimer la campagne <strong>{campaignToDelete?.name}</strong> ?</div>
                <div className="font-medium text-amber-600 dark:text-amber-500">
                  Les données comportementales (Risk Score) de tous les collaborateurs ayant participé à ce scénario seront recalculées et restaurées à leur état précédent (Rollback).
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (campaignToDelete) delCampaignMutation.mutate(campaignToDelete);
                setCampaignToDelete(null);
              }}
            >
              Oui, supprimer la campagne
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!moduleToDelete} onOpenChange={(open) => !open && setModuleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Supprimer le module E-Learning ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 text-sm text-muted-foreground">
                Êtes-vous sûr de vouloir supprimer le module <strong>{moduleToDelete?.name}</strong> ? Son suivi d'avancement sera perdu.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (moduleToDelete) delModuleMutation.mutate(moduleToDelete.id);
                setModuleToDelete(null);
              }}
            >
              Oui, supprimer le module
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}