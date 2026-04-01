import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPhishingCampaigns, createPhishingCampaign, deletePhishingCampaign,
  fetchPhishingProfiles, upsertPhishingProfiles, PhishingProfile,
  fetchElearningModules, createElearningModule, updateElearningModule, deleteElearningModule,
  PhishingCampaign, ElearningModule
} from "@/lib/supabase-awareness";
import { toast } from "sonner";
import * as XLSX from "xlsx";

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
  ArrowUpDown, ArrowDown, ArrowUp, Eye, Target, BarChart3, CalendarDays, Clock, CheckCircle2
} from "lucide-react";

// --- FONCTIONS DE SÉCURITÉ ANTI-NaN ---
const safeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const calculatePercentage = (part: number, total: number) => {
  const p = safeNum(part);
  const t = safeNum(total);
  if (t === 0) return 0;
  const result = Math.round((p / t) * 100);
  return isNaN(result) ? 0 : result;
};

export default function AwarenessView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("phishing");
  const [phishingView, setPhishingView] = useState<"historique" | "bilan">("historique");

  // ÉTATS DES MODALES ET PANNEAUX
  const [isAddCampaignOpen, setIsAddCampaignOpen] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
  const [isLmsImportOpen, setIsLmsImportOpen] = useState(false);

  const [selectedCampaign, setSelectedCampaign] = useState<PhishingCampaign | null>(null);
  const [selectedModule, setSelectedModule] = useState<ElearningModule | null>(null);
  const [isRecidivistsDialogOpen, setIsRecidivistsDialogOpen] = useState(false);

  const [campaignToDelete, setCampaignToDelete] = useState<PhishingCampaign | null>(null);
  const [moduleToDelete, setModuleToDelete] = useState<ElearningModule | null>(null);

  // FILTRES ET TRI
  const [profileSearch, setProfileSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  // ÉTATS DE FORMULAIRES
  const [newCampaign, setNewCampaign] = useState({
    name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen",
    targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0,
    compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [] as string[],
    detailedResults: [] as any[], fileLoaded: false
  });

  const [parsedLmsData, setParsedLmsData] = useState({
    name: "", originalExcelName: "", targetAudience: "Tous", totalAssigned: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0,
    completedBy: [] as string[], // On stocke les mails qui ont fini
    fileLoaded: false, selectedModuleId: "new"
  });

  const [updatedProfilesBatch, setUpdatedProfilesBatch] = useState<PhishingProfile[]>([]);
  const [newModule, setNewModule] = useState({ name: "", targetAudience: "Tous", totalAssigned: 100, deadline: "" });

  const { data: campaigns = [], isLoading: isLoadingCampaigns } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [], isLoading: isLoadingProfiles } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [], isLoading: isLoadingModules } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  // MUTATIONS PHISHING
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
      toast.error("Erreur technique: " + (error.message || "Vérifiez la base de données."));
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

  // MUTATIONS E-LEARNING
  const saveLmsMutation = useMutation({
    mutationFn: async () => {
      const total = safeNum(parsedLmsData.totalAssigned);
      const completed = safeNum(parsedLmsData.completedCount);

      const payload = {
        name: parsedLmsData.name,
        targetAudience: parsedLmsData.targetAudience,
        totalAssigned: total,
        total_assigned: total,
        completedCount: completed,
        completed_count: completed,
        completedBy: parsedLmsData.completedBy, // <-- SAUVEGARDE DE LA LISTE DES MAILS
        completed_by: parsedLmsData.completedBy,
      };

      if (parsedLmsData.selectedModuleId !== "new") {
        await updateElearningModule(parsedLmsData.selectedModuleId, payload as any);
      } else {
        await createElearningModule({
          ...payload,
          deadline: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString()
        } as any);
      }

      if (updatedProfilesBatch.length > 0) {
        await upsertPhishingProfiles(updatedProfilesBatch);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elearning'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success("Statistiques de la formation synchronisées avec succès !");
      setIsLmsImportOpen(false);
      setParsedLmsData({ name: "", originalExcelName: "", targetAudience: "Tous", totalAssigned: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0, completedBy: [], fileLoaded: false, selectedModuleId: "new" });
      setUpdatedProfilesBatch([]);
    },
    onError: (error: any) => {
      console.error("Erreur de sauvegarde LMS Supabase:", error);
      toast.error(`Erreur de sauvegarde: Vérifiez la base de données. (${error.message})`);
    }
  });

  // LA MAGIE DU ROLLBACK E-LEARNING
  const delModuleMutation = useMutation({
    mutationFn: async (module: ElearningModule) => {
      // 1. On retrouve tous les profils qui avaient eu le bonus pour ce module
      if (module.completedBy && module.completedBy.length > 0) {
        const currentProfiles = await fetchPhishingProfiles();
        const profilesMap = new Map(currentProfiles.map(p => [p.email, p]));
        const profilesToUpdate: PhishingProfile[] = [];

        module.completedBy.forEach(email => {
          const p = profilesMap.get(email);
          if (p) {
            // On leur enlève leur formation lue
            p.trainingCompletedCount = Math.max(0, safeNum(p.trainingCompletedCount) - 1);

            // On recalcule leur score
            let riskScore = (safeNum(p.clickedCount) * 20) + (safeNum(p.attachmentOpenedCount) * 20) + (safeNum(p.compromisedCount) * 40) - (safeNum(p.reportedCount) * 10) - (safeNum(p.trainingCompletedCount) * 5);
            p.riskScore = Math.min(100, Math.max(0, riskScore));

            profilesToUpdate.push(p);
          }
        });

        if (profilesToUpdate.length > 0) {
          await upsertPhishingProfiles(profilesToUpdate);
        }
      }

      // 2. On supprime le module
      await deleteElearningModule(module.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elearning'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success("Module supprimé et Risk Scores restaurés (Rollback) !");
      setModuleToDelete(null);
    }
  });

  const addModuleMutation = useMutation({
    mutationFn: async (module: typeof newModule) => {
      await createElearningModule({
        ...module,
        total_assigned: module.totalAssigned,
        completed_count: 0
      } as any);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Module ajouté"); setIsAddModuleOpen(false); }
  });

  // PARSEUR PROOFPOINT (CSV)
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

  // --- PARSEUR LMS (EXCEL .xlsx MULTI-FEUILLES AVEC CHECK NOUVEAUTÉ) ---
  const handleLmsExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        let validRows: any[] = [];
        let mailKey: string | undefined;
        let parcoursKey: string | undefined;
        let etatKey: string | undefined;

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);

          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            const mKey = keys.find(k => k.trim().toLowerCase() === 'mail');
            const pKey = keys.find(k => k.trim().toLowerCase() === 'nom du parcours 1');
            const eKey = keys.find(k => k.trim().toLowerCase() === 'etat du parcours 1');

            if (mKey && pKey && eKey) {
              validRows = rows;
              mailKey = mKey;
              parcoursKey = pKey;
              etatKey = eKey;
              break;
            }
          }
        }

        if (validRows.length === 0 || !mailKey || !parcoursKey || !etatKey) {
          toast.error("Colonnes obligatoires (mail, Nom du parcours 1, Etat du parcours 1) introuvables.");
          return;
        }

        let moduleName = "";
        let total = 0, completed = 0, inProgress = 0, notStarted = 0;
        const profilesToUpdate: PhishingProfile[] = [];
        const currentProfilesMap = new Map(profiles.map(p => [p.email.toLowerCase(), p]));

        // PREPARATION : On cherche si on met à jour un module (pour ne pas donner les points en double)
        const firstRow = validRows[0];
        const tempName = String(firstRow[parcoursKey!] || "").trim();
        const matchedModule = modules.find(m => m.name.toLowerCase() === tempName.toLowerCase());
        const existingCompletedEmails = matchedModule?.completedBy || [];
        const newlyCompletedEmails: string[] = [];

        validRows.forEach((row) => {
          const email = String(row[mailKey!] || "").trim().toLowerCase();
          const etat = String(row[etatKey!] || "").trim().toLowerCase();
          const parcours = String(row[parcoursKey!] || "").trim();

          if (!email || email === "undefined" || email === "") return;

          if (parcours && !moduleName) moduleName = parcours;

          total++;
          let isCompleted = false;

          // Détection du statut
          if (etat.includes('terminé') || etat.includes('validé') || etat.includes('complété') || etat === 'achevé') {
            completed++;
            isCompleted = true;
          } else if (etat.includes('en cours') || etat.includes('progress') || etat.includes('initié')) {
            inProgress++;
          } else {
            notStarted++;
          }

          // INTELLIGENCE : On ne donne les -5 points qu'aux NOUVEAUX validés
          if (isCompleted && currentProfilesMap.has(email)) {
            if (!existingCompletedEmails.includes(email)) {
              newlyCompletedEmails.push(email);

              const p = { ...currentProfilesMap.get(email)! };
              p.trainingCompletedCount = safeNum(p.trainingCompletedCount) + 1;
              let newScore = (safeNum(p.clickedCount) * 20) + (safeNum(p.attachmentOpenedCount) * 20) + (safeNum(p.compromisedCount) * 40) - (safeNum(p.reportedCount) * 10) - (safeNum(p.trainingCompletedCount) * 5);
              p.riskScore = Math.min(100, Math.max(0, newScore));
              profilesToUpdate.push(p);
            }
          }
        });

        const excelName = moduleName || "Nouvelle formation";

        setUpdatedProfilesBatch(profilesToUpdate);
        setParsedLmsData({
          name: matchedModule ? matchedModule.name : excelName,
          originalExcelName: excelName,
          targetAudience: "Tous",
          totalAssigned: total,
          completedCount: completed,
          inProgressCount: inProgress,
          notStartedCount: notStarted,
          completedBy: [...existingCompletedEmails, ...newlyCompletedEmails], // Liste combinée (anciens + nouveaux)
          fileLoaded: true,
          selectedModuleId: matchedModule ? matchedModule.id : "new"
        });

        setIsLmsImportOpen(true);
      } catch (error) {
        console.error("Erreur Excel:", error);
        toast.error("Erreur lors de la lecture du fichier Excel.");
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
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
    const currentScore = safeNum(p.riskScore);
    if (riskFilter === "high") matchesRisk = currentScore >= 60;
    else if (riskFilter === "moderate") matchesRisk = currentScore >= 30 && currentScore < 60;
    else if (riskFilter === "low") matchesRisk = currentScore < 30;

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
        valA = safeNum(a.clickedCount) + safeNum(a.attachmentOpenedCount) + safeNum(a.compromisedCount);
        valB = safeNum(b.clickedCount) + safeNum(b.attachmentOpenedCount) + safeNum(b.compromisedCount);
        break;
      case 'recidive':
        valA = a.isConsecutive ? 1 : 0;
        valB = b.isConsecutive ? 1 : 0;
        break;
      case 'score':
        valA = safeNum(a.riskScore);
        valB = safeNum(b.riskScore);
        break;
      default:
        return 0;
    }

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  if (isLoadingCampaigns || isLoadingProfiles || isLoadingModules) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const highRiskProfiles = profiles.filter(p => safeNum(p.riskScore) >= 60);

  const currentYear = new Date().getFullYear();
  const campaignsThisYear = campaigns.filter(c => new Date(c.sendDate).getFullYear() === currentYear);
  const targetCampaignsPerYear = 4;
  const campaignProgress = Math.min(100, Math.round((campaignsThisYear.length / targetCampaignsPerYear) * 100));
  const isGoalReached = campaignsThisYear.length >= targetCampaignsPerYear;

  const totalMailsSent = campaigns.reduce((acc, c) => acc + safeNum(c.targetCount), 0);
  const avgClickRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + safeNum(c.clickedCount), 0) / totalMailsSent) * 100) : 0;
  const avgCompromiseRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + safeNum(c.compromisedCount), 0) / totalMailsSent) * 100) : 0;
  const avgReportRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + safeNum(c.reportedCount), 0) / totalMailsSent) * 100) : 0;

  // LECTURE SÉCURISÉE DES KPIS E-LEARNING
  const totalElearningAssigned = modules.reduce((acc, m) => acc + (safeNum(m.totalAssigned) || safeNum((m as any).total_assigned)), 0);
  const totalElearningCompleted = modules.reduce((acc, m) => acc + (safeNum(m.completedCount) || safeNum((m as any).completed_count)), 0);

  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(a.sendDate).getTime() - new Date(b.sendDate).getTime());

  return (
    <div className="space-y-6">

      {/* --- KPIs SECTION --- */}
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

        <Card className={`border-l-4 shadow-sm ${campaigns.length > 0 && (safeNum(campaigns[0].compromisedCount) / safeNum(campaigns[0].targetCount) * 100) > 5 ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de compromission</CardTitle>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].compromisedCount, campaigns[0].targetCount) : 0}%</div>
            <p className="text-[10px] text-muted-foreground mt-2">Dernière campagne</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de signalement</CardTitle>
            <ShieldCheck className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].reportedCount, campaigns[0].targetCount) : 0}%</div>
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
            <div className="text-2xl font-bold">{totalElearningAssigned > 0 ? calculatePercentage(totalElearningCompleted, totalElearningAssigned) : 0}%</div>
            <p className="text-[10px] text-muted-foreground mt-2">Collaborateurs formés</p>
          </CardContent>
        </Card>
      </div>

      {/* --- TABS MAIN SECTION --- */}
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
            ) : activeTab === "elearning" ? (
              <div className="flex gap-2 mb-2">
                <div className="relative">
                  <Input
                    type="file"
                    id="lms-upload"
                    className="hidden"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleLmsExcelUpload}
                  />
                  <Button variant="outline" size="sm" asChild>
                    <label htmlFor="lms-upload" className="cursor-pointer">
                      <Upload className="w-4 h-4 mr-2" /> Import LMS (Excel)
                    </label>
                  </Button>
                </div>
                <Button size="sm" onClick={() => setIsAddModuleOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Nouveau Module
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => setIsAddCampaignOpen(true)} className="mb-2">
                <Upload className="w-4 h-4 mr-2" /> Import Proofpoint
              </Button>
            )}
          </div>

          <TabsContent value="phishing" className="m-0">
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
                      <TableCell className="text-blue-600 dark:text-blue-400 font-medium">{calculatePercentage(c.openedCount, c.targetCount)}%</TableCell>
                      <TableCell className="font-medium text-amber-600 dark:text-amber-500">{calculatePercentage(c.clickedCount, c.targetCount)}%</TableCell>
                      <TableCell className="font-bold text-rose-600 dark:text-rose-500">{calculatePercentage(c.compromisedCount, c.targetCount)}%</TableCell>
                      <TableCell className="text-indigo-600 dark:text-indigo-400 font-medium">{calculatePercentage(c.trainingCompletedCount || 0, c.targetCount)}%</TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-500 font-medium">{calculatePercentage(c.reportedCount, c.targetCount)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
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

                <Card className="shadow-sm border-muted">
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" /> Évolution des risques
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Échelle dynamique basée sur vos résultats réels.</p>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const allValues = sortedCampaigns.flatMap(c => [
                        calculatePercentage(c.clickedCount, c.targetCount),
                        calculatePercentage(c.compromisedCount, c.targetCount)
                      ]);
                      const maxValueInData = Math.max(...allValues, 10);
                      const scaleMax = Math.ceil(maxValueInData / 5) * 5 + 5;

                      return (
                        <div className="relative w-full h-64 mt-8 mb-8 border-b border-l border-muted ml-4">
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

                          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
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
                </Card>
              </div>
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
                              {safeNum(p.openedCount) > 0 && <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200">Ouverts: {safeNum(p.openedCount)}</Badge>}
                              {safeNum(p.attachmentOpenedCount) > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">PJ: {safeNum(p.attachmentOpenedCount)}</Badge>}
                              {safeNum(p.clickedCount) > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">Clics: {safeNum(p.clickedCount)}</Badge>}
                              {safeNum(p.compromisedCount) > 0 && <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-200 font-bold">Saisies: {safeNum(p.compromisedCount)}</Badge>}
                              {safeNum(p.trainingCompletedCount) > 0 && <Badge variant="outline" className="bg-indigo-500/10 text-indigo-600 border-indigo-200">Formations lues: {safeNum(p.trainingCompletedCount)}</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.isConsecutive ? <Badge variant="outline" className="bg-rose-500 text-white border-transparent">Oui (Alerte)</Badge> : <span className="text-muted-foreground text-sm">Non</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold ${
                              safeNum(p.riskScore) >= 60 ? 'bg-rose-100 text-rose-700 border-2 border-rose-500 dark:bg-rose-900/30 dark:text-rose-400' :
                              safeNum(p.riskScore) >= 30 ? 'bg-amber-100 text-amber-700 border-2 border-amber-500 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                            }`}>
                              {safeNum(p.riskScore)}
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

              <Card className="border-dashed border-2 flex flex-col items-center justify-center p-6 hover:bg-muted/50 cursor-pointer transition-colors min-h-[200px]" onClick={() => setIsAddModuleOpen(true)}>
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4"><Plus className="w-6 h-6 text-primary" /></div>
                <p className="font-semibold text-primary">Nouveau module</p>
                <p className="text-xs text-muted-foreground text-center mt-1">Créer une coquille vide de formation</p>
              </Card>

              {modules.map((m) => {
                const completed = safeNum(m.completedCount) || safeNum((m as any).completed_count);
                const total = safeNum(m.totalAssigned) || safeNum((m as any).total_assigned);
                const completionRate = calculatePercentage(completed, total);

                return (
                  <Card key={m.id} className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedModule(m)}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <Badge variant="secondary" className="mb-2">{m.targetAudience}</Badge>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); setModuleToDelete(m); }}>
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
                          <span>{completed} / {total} validés</span>
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
                      <Button variant="outline" size="sm" className="w-full text-xs" onClick={(e) => { e.stopPropagation(); setSelectedModule(m); }}>
                        <Eye className="w-3 h-3 mr-2" /> Détails
                      </Button>
                      <Button variant="outline" size="sm" className="w-full text-xs text-primary border-primary/20 hover:bg-primary/5" onClick={(e) => { e.stopPropagation(); toast.success("Relance envoyée aux retardataires"); }}>
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
                <p className="text-xs text-muted-foreground mt-1">Commencez par importer un fichier LMS.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* --- PANNEAUX DE DÉTAILS --- */}

      {/* PANNEAU PHISHING */}
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
                <Button variant="destructive" className="w-full" onClick={() => setCampaignToDelete(selectedCampaign)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Supprimer et annuler l'impact
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* PANNEAU E-LEARNING */}
      <Sheet open={!!selectedModule} onOpenChange={(open) => !open && setSelectedModule(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl">{selectedModule?.name}</SheetTitle>
            <SheetDescription>Détails d'avancement de la formation</SheetDescription>
          </SheetHeader>

          {selectedModule && (() => {
            const completed = safeNum(selectedModule.completedCount) || safeNum((selectedModule as any).completed_count);
            const total = safeNum(selectedModule.totalAssigned) || safeNum((selectedModule as any).total_assigned);
            const inProgress = Math.max(0, total - completed);
            const completionRate = calculatePercentage(completed, total);

            return (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg bg-card text-center space-y-1 shadow-sm">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cibles</p>
                    <p className="text-2xl font-bold">{total}</p>
                  </div>
                  <div className="p-4 border rounded-lg bg-emerald-50 text-center space-y-1 shadow-sm">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Taux de réussite</p>
                    <p className="text-2xl font-bold text-emerald-600">{completionRate}%</p>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Entonnoir E-Learning</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-md border bg-card">
                      <span className="text-sm font-medium flex items-center gap-2 text-muted-foreground"><Users className="w-4 h-4"/> Inscrits</span>
                      <span className="font-bold">{total}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-md bg-amber-50 border border-amber-100 ml-4">
                      <span className="text-sm font-medium flex items-center gap-2 text-amber-700"><Clock className="w-4 h-4"/> En cours / À faire</span>
                      <span className="font-bold text-amber-700">{inProgress}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-md bg-emerald-50 border border-emerald-100 ml-8">
                      <span className="text-sm font-medium flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-4 h-4"/> Terminés</span>
                      <span className="font-bold text-emerald-700">{completed}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t">
                  <Button variant="outline" className="w-full text-primary border-primary/20 hover:bg-primary/5" onClick={() => toast.success("Relance envoyée aux retardataires")}>
                    <Mail className="w-4 h-4 mr-2" /> Relancer les {inProgress} retardataires
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* --- MODALES DE CRÉATION ET D'IMPORT --- */}

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
                            safeNum(profile.riskScore) >= 60 ? 'bg-rose-100 text-rose-700 border-rose-200' :
                            safeNum(profile.riskScore) >= 30 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                            'bg-emerald-100 text-emerald-700 border-emerald-200'
                          }`}>
                            {safeNum(profile.riskScore)} pts
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

      <Dialog open={isLmsImportOpen} onOpenChange={(open) => {
        setIsLmsImportOpen(open);
        if(!open) setParsedLmsData({ name: "", originalExcelName: "", targetAudience: "Tous", totalAssigned: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0, fileLoaded: false, selectedModuleId: "new" });
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer un fichier E-Learning (LMS)</DialogTitle>
            <DialogDescription>Synchronisez les résultats avec une formation existante ou créez-en une nouvelle.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {parsedLmsData.fileLoaded && (
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 space-y-4">

                <div className="space-y-1">
                  <Label>Action à réaliser</Label>
                  <Select
                    value={parsedLmsData.selectedModuleId}
                    onValueChange={(val) => {
                      setParsedLmsData({
                        ...parsedLmsData,
                        selectedModuleId: val,
                        name: val === "new" ? parsedLmsData.originalExcelName : modules.find(m => m.id === val)?.name || ""
                      });
                    }}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Choisir une action..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new" className="font-bold text-primary">+ Créer une nouvelle carte</SelectItem>
                      {modules.map(m => (
                        <SelectItem key={m.id} value={m.id}>Mettre à jour : {m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {parsedLmsData.selectedModuleId === "new" && (
                  <div className="space-y-1 mt-2">
                    <Label>Nom de la nouvelle formation</Label>
                    <Input
                      value={parsedLmsData.name}
                      onChange={e => setParsedLmsData({...parsedLmsData, name: e.target.value})}
                    />
                  </div>
                )}

                <div className="space-y-2 mt-4 pt-4 border-t border-primary/10">
                  <h4 className="text-sm font-semibold mb-2">Bilan calculé d'après Excel :</h4>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Inscrits détectés:</span> <span className="font-bold">{safeNum(parsedLmsData.totalAssigned)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-amber-600">En cours / À faire:</span> <span className="font-medium text-amber-600">{safeNum(parsedLmsData.inProgressCount) + safeNum(parsedLmsData.notStartedCount)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-emerald-600">Validés:</span> <span className="font-bold text-emerald-600">{safeNum(parsedLmsData.completedCount)}</span></div>
                </div>

                <div className="text-xs text-muted-foreground bg-white dark:bg-black p-2 rounded border mt-2">
                  💡 Les collaborateurs validés recevront un <strong>bonus de -5 points</strong> sur leur score de risque.
                </div>
              </div>
            )}
            <Button
              className="w-full mt-2"
              disabled={!parsedLmsData.fileLoaded || saveLmsMutation.isPending || (parsedLmsData.selectedModuleId === "new" && !parsedLmsData.name)}
              onClick={() => saveLmsMutation.mutate()}
            >
              {saveLmsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> :
               (parsedLmsData.selectedModuleId !== "new" ? "Mettre à jour la carte" : "Créer le module et mettre à jour")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddModuleOpen} onOpenChange={(open) => {
        setIsAddModuleOpen(open);
        if(!open) setNewModule({ name: "", targetAudience: "Tous", totalAssigned: 100, deadline: "" });
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer une formation (Manuellement)</DialogTitle>
            <DialogDescription>Crée une coquille vide en attendant l'import de l'Excel LMS.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Nom de la formation</Label>
              <Input
                placeholder="Ex: Les bases du Phishing 2026"
                value={newModule.name}
                onChange={(e) => setNewModule({...newModule, name: e.target.value})}
              />
            </div>

            <div className="space-y-1">
              <Label>Cible (Domaine)</Label>
              <Select value={newModule.targetAudience} onValueChange={(val) => setNewModule({...newModule, targetAudience: val})}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une cible" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tous">Tous les collaborateurs</SelectItem>
                  {uniqueDepartments.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nombre de cibles prévues</Label>
                <Input
                  type="number"
                  min="1"
                  value={newModule.totalAssigned}
                  onChange={(e) => setNewModule({...newModule, totalAssigned: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-1">
                <Label>Date d'échéance</Label>
                <Input
                  type="date"
                  value={newModule.deadline}
                  onChange={(e) => setNewModule({...newModule, deadline: e.target.value})}
                />
              </div>
            </div>

            <Button
              className="w-full mt-4"
              disabled={!newModule.name || addModuleMutation.isPending}
              onClick={() => addModuleMutation.mutate(newModule as any)}
            >
              {addModuleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Créer la coquille vide
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- MODALES DE SUPPRESSION --- */}
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
                Êtes-vous sûr de vouloir supprimer le module <strong>{moduleToDelete?.name}</strong> ? Son suivi d'avancement sera perdu, <strong>et les scores de risques des collaborateurs associés seront recalculés (Rollback)</strong>.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (moduleToDelete) delModuleMutation.mutate(moduleToDelete); // Passe bien l'objet complet pour le rollback
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