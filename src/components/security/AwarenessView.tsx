import React, { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
  Users, Loader2, Trash2, Plus, TrendingUp, AlertTriangle, Upload, ShieldCheck, UserX, Activity,
  Mail, MousePointer, Key, Flag, Paperclip, BookOpen, Search,
  ArrowUpDown, ArrowDown, ArrowUp, Eye, Target, BarChart3, CalendarDays, Clock, CheckCircle2,
  Monitor, Video, CheckSquare, Mic, UserMinus
} from "lucide-react";

// ============================================================================
// UTILITAIRES DE SÉCURITÉ ET CALCULS
// ============================================================================
const safeNum = (val: unknown): number => {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
};

// Sécurité contre la casse de recherche et protection contre le [object Object]
const safeString = (val: unknown): string => {
  if (typeof val === 'string') return val.trim().toLowerCase();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).toLowerCase();
  return "";
};

const calculatePercentage = (part: number, total: number) => {
  const p = safeNum(part);
  const t = safeNum(total);
  if (t === 0) return 0;
  const result = Math.round((p / t) * 100);
  return Number.isNaN(result) ? 0 : result;
};

const calculateRiskScore = (
  clicked: number, attachment: number, compromised: number, reported: number, training: number, isConsecutive: boolean
) => {
  let score = (safeNum(clicked) * 20) + (safeNum(attachment) * 20) + (safeNum(compromised) * 40) - (safeNum(reported) * 10) - (safeNum(training) * 5);
  if (isConsecutive) score += 20;
  return Math.min(100, Math.max(0, score));
};

const parseExcelDate = (excelDate: unknown) => {
  if (!excelDate) return undefined;
  if (typeof excelDate === 'number') {
    return new Date(Math.round((excelDate - 25569) * 86400 * 1000)).toISOString();
  }
  if (typeof excelDate === 'string') {
    if (excelDate.includes('/')) {
      const parts = excelDate.split('/');
      if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
    }
    const d = new Date(excelDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
};

// Analyseur CSV sécurisé sans regex vulnérable (Correction du ReDoS Catastrophic Backtracking)
const parseCSVLine = (text: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
};

const getRiskBadgeClassSolid = (score: number) => {
  if (score >= 60) return 'bg-rose-100 text-rose-700 border-2 border-rose-500 dark:bg-rose-900/30 dark:text-rose-400';
  if (score >= 30) return 'bg-amber-100 text-amber-700 border-2 border-amber-500 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400';
};

const getRiskBadgeClassOutline = (score: number) => {
  if (score >= 60) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (score >= 30) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
};

const isAffirmative = (val: string | undefined) => val !== undefined && val.length > 0 && val.toLowerCase() !== 'false' && val.toLowerCase() !== 'no';

// ============================================================================
// MOTEURS D'EXTRACTION DE DONNÉES PROOFPOINT (Refactorisés)
// ============================================================================
const getProofpointIndices = (headers: string[]) => ({
  idxEmail: headers.indexOf('Email Address'),
  idxFirstName: headers.indexOf('First Name'),
  idxLastName: headers.indexOf('Last Name'),
  idxOrg: headers.findIndex(h => ['DOMAINE', 'ORGANISATION', 'Group', 'EMPLOI'].includes(h)),
  idxOpened: headers.findIndex(h => ['Date Email Opened', 'Primary Email Opened'].includes(h)),
  idxAttachment: headers.findIndex(h => ['Primary Attachment Opened', 'Attachment Opened'].includes(h)),
  idxClicked: headers.findIndex(h => ['Date Clicked', 'Primary Clicked'].includes(h)),
  idxCompromised: headers.findIndex(h => ['Primary Compromised Login', 'Weak Egress'].includes(h)),
  idxTraining: headers.indexOf('Acknowledgement Completed'),
  idxReported: headers.findIndex(h => ['Date Reported', 'Reported'].includes(h))
});

const analyzeProofpointRow = (cols: string[], indices: Record<string, number>, map: Map<string, PhishingProfile>) => {
  const email = cols[indices.idxEmail].toLowerCase();
  let hasOpened = isAffirmative(cols[indices.idxOpened]);
  const hasAttachmentOpened = isAffirmative(cols[indices.idxAttachment]);
  let hasClicked = isAffirmative(cols[indices.idxClicked]);
  const hasCompromised = isAffirmative(cols[indices.idxCompromised]);
  const hasTraining = isAffirmative(cols[indices.idxTraining]);
  const hasReported = isAffirmative(cols[indices.idxReported]);

  if (hasTraining || hasCompromised) hasClicked = true;
  if (hasClicked || hasAttachmentOpened) hasOpened = true;

  const existing = map.get(email) || { email, firstName: '', lastName: '', department: '', totalCampaigns: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0, compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, riskScore: 0, lastCampaignClicked: false, isConsecutive: false };
  const finalFirstName = existing.firstName || (indices.idxFirstName !== -1 ? cols[indices.idxFirstName] : '');
  const finalLastName = existing.lastName || (indices.idxLastName !== -1 ? cols[indices.idxLastName] : '');
  const finalDepartment = existing.department || (indices.idxOrg !== -1 ? cols[indices.idxOrg] : '');

  const newOpenedCount = safeNum(existing.openedCount) + Number(hasOpened);
  const newAttachmentCount = safeNum(existing.attachmentOpenedCount) + Number(hasAttachmentOpened);
  const newClickedCount = safeNum(existing.clickedCount) + Number(hasClicked);
  const newCompromisedCount = safeNum(existing.compromisedCount) + Number(hasCompromised);
  const newTrainingCount = safeNum(existing.trainingCompletedCount) + Number(hasTraining);
  const newReportedCount = safeNum(existing.reportedCount) + Number(hasReported);
  const newTotalCampaigns = safeNum(existing.totalCampaigns) + 1;

  const fellThisTime = hasClicked || hasAttachmentOpened;
  const fellInPast = safeNum(existing.clickedCount) > 0 || safeNum(existing.attachmentOpenedCount) > 0;
  const isRecidivist = fellThisTime && fellInPast;
  const newConsecutive = existing.isConsecutive || isRecidivist;
  const riskScore = calculateRiskScore(newClickedCount, newAttachmentCount, newCompromisedCount, newReportedCount, newTrainingCount, newConsecutive);

  return {
    email, hasOpened, hasAttachmentOpened, hasClicked, hasCompromised, hasTraining, hasReported, isRecidivist,
    profile: { email, firstName: finalFirstName, lastName: finalLastName, department: finalDepartment, totalCampaigns: newTotalCampaigns, openedCount: newOpenedCount, attachmentOpenedCount: newAttachmentCount, clickedCount: newClickedCount, compromisedCount: newCompromisedCount, trainingCompletedCount: newTrainingCount, reportedCount: newReportedCount, riskScore, lastCampaignClicked: fellThisTime, isConsecutive: newConsecutive }
  };
};

const processProofpointData = (text: string, profiles: PhishingProfile[]) => {
  const lines = text.split('\n');
  if (lines.length < 2) throw new Error("Fichier vide ou invalide.");
  const headers = parseCSVLine(lines[0]);
  const indices = getProofpointIndices(headers);
  if (indices.idxEmail === -1) throw new Error("Colonne 'Email Address' introuvable dans le CSV.");

  const result = { target: 0, opened: 0, attachmentOpened: 0, clicked: 0, compromised: 0, trainingCompleted: 0, reported: 0, recidivists: 0, failedEmails: [] as string[], updatedProfiles: [] as PhishingProfile[], detailedResults: [] as any[] };
  const map = new Map(profiles.map(p => [p.email, p]));

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    if (cols.length < headers.length - 2) continue;

    const res = analyzeProofpointRow(cols, indices, map);
    result.target++;
    result.opened += Number(res.hasOpened);
    result.attachmentOpened += Number(res.hasAttachmentOpened);
    result.clicked += Number(res.hasClicked);
    if (res.hasClicked) result.failedEmails.push(res.email);
    result.compromised += Number(res.hasCompromised);
    result.trainingCompleted += Number(res.hasTraining);
    result.reported += Number(res.hasReported);
    result.recidivists += Number(res.isRecidivist);

    result.detailedResults.push({ email: res.email, opened: res.hasOpened, attachment: res.hasAttachmentOpened, clicked: res.hasClicked, compromised: res.hasCompromised, training: res.hasTraining, reported: res.hasReported, isRecidivist: res.isRecidivist });
    result.updatedProfiles.push(res.profile);
  }
  return result;
};

// ============================================================================
// MOTEURS D'EXTRACTION DE DONNÉES LMS (Refactorisés)
// ============================================================================
const findLmsColumns = (workbook: XLSX.WorkBook) => {
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[sheetName]);
    if (rows.length > 0) {
      const objKeys = Object.keys(rows[0]);
      const kMail = objKeys.find(k => k.trim().toLowerCase() === 'mail');
      const kParcours = objKeys.find(k => k.trim().toLowerCase() === 'nom du parcours 1');
      const kEtat = objKeys.find(k => k.trim().toLowerCase() === 'etat du parcours 1');
      const kStart = objKeys.find(k => k.trim().toLowerCase() === 'date de début de session 1' || k.trim().toLowerCase() === 'date de début');
      const kEnd = objKeys.find(k => k.trim().toLowerCase() === 'date de fin de session 1' || k.trim().toLowerCase() === 'date de fin');
      if (kMail && kParcours && kEtat) return { rows, keys: { mail: kMail, parcours: kParcours, etat: kEtat, start: kStart || '', end: kEnd || '' } };
    }
  }
  return { rows: [], keys: null };
};

const processLmsRow = (row: any, keys: Record<string, string>, currentProfilesMap: Map<string, PhishingProfile>, existingCompletedEmails: string[]) => {
  const email = String(row[keys.mail] || "").trim().toLowerCase();
  const etat = String(row[keys.etat] || "").trim().toLowerCase();
  const parcours = String(row[keys.parcours] || "").trim();

  if (!email || email === "undefined" || email === "") return null;

  let isCompleted = false;
  let status = "notStarted";

  if (etat.includes('terminé') || etat.includes('validé') || etat.includes('complété') || etat === 'achevé') {
    isCompleted = true; status = "completed";
  } else if (etat.includes('en cours') || etat.includes('progress') || etat.includes('initié')) {
    status = "inProgress";
  }

  let updatedProfile = null;
  if (isCompleted && currentProfilesMap.has(email) && !existingCompletedEmails.includes(email)) {
    const p = { ...currentProfilesMap.get(email)! };
    p.trainingCompletedCount = safeNum(p.trainingCompletedCount ?? (p as any).training_completed_count) + 1;
    p.riskScore = calculateRiskScore(safeNum(p.clickedCount), safeNum(p.attachmentOpenedCount), safeNum(p.compromisedCount), safeNum(p.reportedCount), p.trainingCompletedCount, p.isConsecutive || false);
    updatedProfile = p;
  }

  return { email, parcours, status, updatedProfile };
};

const processLmsWorkbookData = (workbook: XLSX.WorkBook, modules: ElearningModule[], profiles: PhishingProfile[]) => {
  const { rows: validRows, keys } = findLmsColumns(workbook);
  if (!keys) throw new Error("Colonnes obligatoires introuvables dans l'Excel.");

  let startDateFound: string | undefined = undefined;
  let endDateFound: string | undefined = undefined;
  validRows.forEach((row) => {
    if (!endDateFound && keys.end && row[keys.end]) endDateFound = parseExcelDate(row[keys.end]);
    if (!startDateFound && keys.start && row[keys.start]) startDateFound = parseExcelDate(row[keys.start]);
  });

  const tempName = String(validRows[0][keys.parcours] || "").trim();
  const matchingModules = modules.filter(m => m.name.toLowerCase() === tempName.toLowerCase() && (m.formatType === 'E-Learning' || (m as any).format_type === 'E-Learning'));
  matchingModules.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  let matchedModule = matchingModules.length > 0 ? matchingModules[0] : undefined;
  let isRenewal = false;

  if (matchedModule) {
    const existingDeadlineIso = matchedModule.deadline ? new Date(matchedModule.deadline).toISOString().split('T')[0] : null;
    const newDeadlineIso = endDateFound ? new Date(endDateFound).toISOString().split('T')[0] : null;
    if (existingDeadlineIso && newDeadlineIso && existingDeadlineIso !== newDeadlineIso) {
      isRenewal = true;
      matchedModule = undefined;
    }
  }

  const existingCompletedEmails = matchedModule?.completedBy || (matchedModule as any)?.completed_by || [];
  const newlyCompletedEmails: string[] = [];
  const profilesToUpdate: PhishingProfile[] = [];
  const currentProfilesMap = new Map(profiles.map(p => [p.email.toLowerCase(), p]));

  let moduleName = "";
  let total = 0, completed = 0, inProgress = 0, notStarted = 0;

  validRows.forEach((row) => {
    const res = processLmsRow(row, keys, currentProfilesMap, existingCompletedEmails);
    if (!res) return;

    if (res.parcours && !moduleName) moduleName = res.parcours;
    total++;

    if (res.status === "completed") {
      completed++;
      if (res.updatedProfile && !newlyCompletedEmails.includes(res.email)) {
        newlyCompletedEmails.push(res.email);
        profilesToUpdate.push(res.updatedProfile);
      }
    } else if (res.status === "inProgress") {
      inProgress++;
    } else {
      notStarted++;
    }
  });

  return {
    moduleName: matchedModule ? matchedModule.name : (moduleName || "Nouvelle formation"),
    originalExcelName: moduleName || "Nouvelle formation",
    totalAssigned: total, completedCount: completed, inProgressCount: inProgress, notStartedCount: notStarted,
    completedBy: [...existingCompletedEmails, ...newlyCompletedEmails], startDateFound, endDateFound,
    matchedModuleId: matchedModule ? matchedModule.id : "new", isRenewal, profilesToUpdate
  };
};

// ============================================================================
// SOUS-COMPOSANTS DE RENDU UI
// ============================================================================

const KpiGrid = ({ campaigns, profiles, elearningModules, sessionModules }: any) => {
  const highRiskProfiles = profiles.filter((p: PhishingProfile) => safeNum(p.riskScore) >= 60);
  const currentYear = new Date().getFullYear();
  const campaignsThisYear = campaigns.filter((c: PhishingCampaign) => new Date(c.sendDate).getFullYear() === currentYear);
  const targetCampaignsPerYear = 4;
  const campaignProgress = Math.min(100, Math.round((campaignsThisYear.length / targetCampaignsPerYear) * 100));
  const isGoalReached = campaignsThisYear.length >= targetCampaignsPerYear;

  const totalElearningAssigned = elearningModules.reduce((acc: number, m: ElearningModule) => acc + safeNum(m.totalAssigned), 0);
  const totalElearningCompleted = elearningModules.reduce((acc: number, m: ElearningModule) => acc + safeNum(m.completedCount), 0);
  const elearningRate = totalElearningAssigned > 0 ? calculatePercentage(totalElearningCompleted, totalElearningAssigned) : 0;
  const elearningGoalReached = elearningRate >= 95;
  const elearningProgress = Math.min(100, Math.round((elearningRate / 95) * 100));

  const sessionsThisYear = sessionModules.filter((m: ElearningModule) => {
    const dStr = m.startDate || m.createdAt || "";
    if (!dStr) return false;
    return new Date(dStr).getFullYear() === currentYear;
  });
  const targetSessionsPerYear = 4;
  const sessionProgress = Math.min(100, Math.round((sessionsThisYear.length / targetSessionsPerYear) * 100));
  const isSessionGoalReached = sessionsThisYear.length >= targetSessionsPerYear;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      <Card className={`border-l-4 shadow-sm ${isGoalReached ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Phishing</CardTitle>
          <Target className={`w-4 h-4 ${isGoalReached ? 'text-emerald-500' : 'text-blue-500'}`} />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold flex items-baseline gap-1">{campaignsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ {targetCampaignsPerYear}</span></div>
          <Progress value={campaignProgress} className={`h-1 mt-2 ${isGoalReached ? '[&>div]:bg-emerald-500' : ''}`} />
          <p className="text-[9px] text-muted-foreground mt-1">Campagnes annuelles</p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 shadow-sm ${campaigns.length > 0 && (safeNum(campaigns[0].compromisedCount) / safeNum(campaigns[0].targetCount) * 100) > 5 ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Compromission</CardTitle>
          <AlertTriangle className="w-4 h-4 text-rose-500" />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].compromisedCount, campaigns[0].targetCount) : 0}%</div>
          <p className="text-[9px] text-muted-foreground mt-1">Dernière campagne</p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Signalements</CardTitle>
          <ShieldCheck className="w-4 h-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold">{campaigns.length > 0 ? calculatePercentage(campaigns[0].reportedCount, campaigns[0].targetCount) : 0}%</div>
          <p className="text-[9px] text-muted-foreground mt-1">Dernière campagne</p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 shadow-sm ${highRiskProfiles.length > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Risque &gt; 60</CardTitle>
          <UserX className="w-4 h-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold">{highRiskProfiles.length}</div>
          <p className="text-[9px] text-muted-foreground mt-1">Collaborateurs à suivre</p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 shadow-sm ${isSessionGoalReached ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Sessions Animées</CardTitle>
          <Mic className={`w-4 h-4 ${isSessionGoalReached ? 'text-emerald-500' : 'text-amber-500'}`} />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold flex items-baseline gap-1">{sessionsThisYear.length} <span className="text-sm font-normal text-muted-foreground">/ {targetSessionsPerYear}</span></div>
          <Progress value={sessionProgress} className={`h-1 mt-2 ${isSessionGoalReached ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'}`} />
          <p className="text-[9px] text-muted-foreground mt-1">Webinaires / Présentiel</p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 shadow-sm ${elearningGoalReached ? 'border-l-emerald-500' : 'border-l-primary'}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Couverture E-Learning</CardTitle>
          <Target className={`w-4 h-4 ${elearningGoalReached ? 'text-emerald-500' : 'text-primary'}`} />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold flex items-baseline gap-1">{elearningRate}% <span className="text-sm font-normal text-muted-foreground">/ 95%</span></div>
          <Progress value={elearningProgress} className={`h-1 mt-2 ${elearningGoalReached ? '[&>div]:bg-emerald-500' : '[&>div]:bg-primary'}`} />
          <p className="text-[9px] text-muted-foreground mt-1">Objectif de réalisation</p>
        </CardContent>
      </Card>
    </div>
  );
};

const PhishingTabContent = ({ campaigns, setSelectedCampaign, phishingView, setPhishingView }: any) => {
  if (campaigns.length === 0) {
    return <div className="p-12 text-center text-muted-foreground">Aucune campagne. Importez un CSV Proofpoint pour commencer.</div>;
  }

  if (phishingView === "historique") {
    return (
      <>
        <div className="px-6 py-4 flex gap-2 border-b border-border bg-muted/10">
          <Button variant="default" size="sm" onClick={() => setPhishingView("historique")}><Activity className="w-4 h-4 mr-2" /> Historique et Tableau</Button>
          <Button variant="outline" size="sm" onClick={() => setPhishingView("bilan")}><BarChart3 className="w-4 h-4 mr-2" /> Bilan et Évolution</Button>
        </div>
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
            {campaigns.map((c: PhishingCampaign) => (
              <TableRow key={c.id} className="relative hover:bg-muted/50 group">
                <TableCell className="font-medium">
                  {c.name}
                  {/* Stretched Link Strategy */}
                  <button type="button" aria-label={`Détails ${c.name}`} onClick={() => setSelectedCampaign(c)} className="absolute inset-0 w-full h-full bg-transparent border-none outline-none cursor-pointer z-0" />
                </TableCell>
                <TableCell className="text-muted-foreground relative z-10 pointer-events-none">{new Date(c.sendDate).toLocaleDateString()}</TableCell>
                <TableCell className="relative z-10 pointer-events-none">{c.targetCount}</TableCell>
                <TableCell className="text-blue-600 dark:text-blue-400 font-medium relative z-10 pointer-events-none">{calculatePercentage(c.openedCount, c.targetCount)}%</TableCell>
                <TableCell className="font-medium text-amber-600 dark:text-amber-500 relative z-10 pointer-events-none">{calculatePercentage(c.clickedCount, c.targetCount)}%</TableCell>
                <TableCell className="font-bold text-rose-600 dark:text-rose-500 relative z-10 pointer-events-none">{calculatePercentage(c.compromisedCount, c.targetCount)}%</TableCell>
                <TableCell className="text-indigo-600 dark:text-indigo-400 font-medium relative z-10 pointer-events-none">{calculatePercentage(c.trainingCompletedCount || 0, c.targetCount)}%</TableCell>
                <TableCell className="text-right text-emerald-600 dark:text-emerald-500 font-medium relative z-10 pointer-events-none">{calculatePercentage(c.reportedCount, c.targetCount)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  }

  const totalMailsSent = campaigns.reduce((acc: number, c: PhishingCampaign) => acc + safeNum(c.targetCount), 0);
  const avgClickRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc: number, c: PhishingCampaign) => acc + safeNum(c.clickedCount), 0) / totalMailsSent) * 100) : 0;
  const avgCompromiseRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc: number, c: PhishingCampaign) => acc + safeNum(c.compromisedCount), 0) / totalMailsSent) * 100) : 0;
  const avgReportRate = totalMailsSent > 0 ? Math.round((campaigns.reduce((acc: number, c: PhishingCampaign) => acc + safeNum(c.reportedCount), 0) / totalMailsSent) * 100) : 0;
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(a.sendDate).getTime() - new Date(b.sendDate).getTime());

  const allValues = sortedCampaigns.flatMap(c => [
    calculatePercentage(c.clickedCount, c.targetCount),
    calculatePercentage(c.compromisedCount, c.targetCount)
  ]);
  const maxValueInData = Math.max(...allValues, 10);
  const scaleMax = Math.ceil(maxValueInData / 5) * 5 + 5;

  return (
    <>
      <div className="px-6 py-4 flex gap-2 border-b border-border bg-muted/10">
        <Button variant="outline" size="sm" onClick={() => setPhishingView("historique")}><Activity className="w-4 h-4 mr-2" /> Historique et Tableau</Button>
        <Button variant="default" size="sm" onClick={() => setPhishingView("bilan")}><BarChart3 className="w-4 h-4 mr-2" /> Bilan et Évolution</Button>
      </div>
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
            <div className="relative w-full h-64 mt-8 mb-8 border-b border-l border-muted ml-4">
              {[0, 0.5, 1].map((ratio) => (
                <div key={ratio} className="absolute w-full border-t border-dashed border-muted/50 pointer-events-none" style={{ top: `${(1 - ratio) * 100}%` }}>
                  <span className="absolute -left-10 -top-2 text-[10px] text-muted-foreground w-8 text-right">{Math.round(ratio * scaleMax)}%</span>
                </div>
              ))}

              <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline points={sortedCampaigns.map((c, i) => `${sortedCampaigns.length > 1 ? (i / (sortedCampaigns.length - 1)) * 100 : 50},${100 - (calculatePercentage(c.clickedCount, c.targetCount) / scaleMax * 100)}`).join(' ')} fill="none" className="stroke-amber-500" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={sortedCampaigns.map((c, i) => `${sortedCampaigns.length > 1 ? (i / (sortedCampaigns.length - 1)) * 100 : 50},${100 - (calculatePercentage(c.compromisedCount, c.targetCount) / scaleMax * 100)}`).join(' ')} fill="none" className="stroke-rose-500" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
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

            <div className="flex justify-center gap-6 mt-10">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 bg-amber-500 rounded-full"></div> Clics</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 bg-rose-500 rounded-full"></div> Compromissions</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const ProfilageTabContent = ({ profiles, uniqueDepartments }: any) => {
  const [profileSearch, setProfileSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const filteredProfiles = profiles.filter((p: PhishingProfile) => {
    const searchLower = profileSearch.toLowerCase();
    const matchesSearch = safeString(p.firstName).includes(searchLower) || safeString(p.lastName).includes(searchLower) || safeString(p.email).includes(searchLower);
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
      case 'name': valA = `${safeString(a.lastName)} ${safeString(a.firstName)}`; valB = `${safeString(b.lastName)} ${safeString(b.firstName)}`; break;
      case 'department': valA = a.department || ""; valB = b.department || ""; break;
      case 'behavior': valA = safeNum(a.clickedCount) + safeNum(a.attachmentOpenedCount) + safeNum(a.compromisedCount); valB = safeNum(b.clickedCount) + safeNum(b.attachmentOpenedCount) + safeNum(b.compromisedCount); break;
      case 'recidive': valA = a.isConsecutive ? 1 : 0; valB = b.isConsecutive ? 1 : 0; break;
      case 'score': valA = safeNum(a.riskScore); valB = safeNum(b.riskScore); break;
      default: return 0;
    }
    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig?.key === key && sortConfig?.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return <ArrowUpDown className="w-4 h-4 ml-1 opacity-50 inline" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 ml-1 inline" /> : <ArrowDown className="w-4 h-4 ml-1 inline" />;
  };

  if (profiles.length === 0) {
    return <div className="p-12 text-center text-muted-foreground">Les profils se génèrent automatiquement lors de l'import CSV.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-end bg-muted/20 p-3 rounded-lg border border-border">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Chercher un nom, email..." className="pl-9 bg-background" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Label className="text-xs text-muted-foreground mb-1 block">Département</Label>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="bg-background"><SelectValue placeholder="Tous" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les départements</SelectItem>
              {uniqueDepartments.map((dept: any) => <SelectItem key={dept} value={dept}>{dept}</SelectItem>)}
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
                <TableHead><button type="button" className="flex items-center w-full bg-transparent border-none p-0 cursor-pointer font-inherit text-left hover:text-primary transition-colors text-xs font-bold" onClick={() => handleSort('name')}>Collaborateur {getSortIcon('name')}</button></TableHead>
                <TableHead><button type="button" className="flex items-center w-full bg-transparent border-none p-0 cursor-pointer font-inherit text-left hover:text-primary transition-colors text-xs font-bold" onClick={() => handleSort('department')}>Département {getSortIcon('department')}</button></TableHead>
                <TableHead><button type="button" className="flex items-center w-full bg-transparent border-none p-0 cursor-pointer font-inherit text-left hover:text-primary transition-colors text-xs font-bold" onClick={() => handleSort('behavior')}>Comportement {getSortIcon('behavior')}</button></TableHead>
                <TableHead><button type="button" className="flex items-center w-full bg-transparent border-none p-0 cursor-pointer font-inherit text-left hover:text-primary transition-colors text-xs font-bold" onClick={() => handleSort('recidive')}>Récidive {getSortIcon('recidive')}</button></TableHead>
                <TableHead className="text-right"><button type="button" className="flex items-center justify-end w-full bg-transparent border-none p-0 cursor-pointer font-inherit text-right hover:text-primary transition-colors text-xs font-bold" onClick={() => handleSort('score')}>Risk Score {getSortIcon('score')}</button></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAndFilteredProfiles.map((p) => {
                const tCamp = safeNum(p.totalCampaigns);
                const oCount = safeNum(p.openedCount);
                const aCount = safeNum(p.attachmentOpenedCount);
                const cCount = safeNum(p.clickedCount);
                const sCount = safeNum(p.compromisedCount);
                const tRead = safeNum(p.trainingCompletedCount);
                const hasHistory = tCamp > 0 || oCount > 0 || aCount > 0 || cCount > 0 || sCount > 0 || tRead > 0;

                return (
                  <TableRow key={p.email}>
                    <TableCell>
                      <div className="font-medium">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-muted-foreground">{p.email}</div>
                    </TableCell>
                    <TableCell className="text-sm">{p.department || "-"}</TableCell>
                    <TableCell>
                      {hasHistory ? (
                        <div className="flex flex-wrap gap-2 items-center text-xs">
                          {tCamp > 0 && <Badge variant="outline" className="bg-muted/50 border-transparent">Cibles: {tCamp}</Badge>}
                          {oCount > 0 && <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200">Ouverts: {oCount}</Badge>}
                          {aCount > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">PJ: {aCount}</Badge>}
                          {cCount > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">Clics: {cCount}</Badge>}
                          {sCount > 0 && <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-200 font-bold">Saisies: {sCount}</Badge>}
                          {tRead > 0 && <Badge variant="outline" className="bg-indigo-500/10 text-indigo-600 border-indigo-200">Formations lues: {tRead}</Badge>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">Aucun historique</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.isConsecutive ? <Badge variant="outline" className="bg-rose-500 text-white border-transparent">Oui (Alerte)</Badge> : <span className="text-muted-foreground text-sm">Non</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold ${getRiskBadgeClassSolid(safeNum(p.riskScore))}`}>
                        {safeNum(p.riskScore)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

const ElearningTabContent = ({ elearningModules, sessionModules, handleLmsExcelUpload, setIsAddModuleOpen, setNewModule, newModule, setSelectedModule, setModuleToDelete, setIsAttendanceModalOpen }: any) => {
  return (
    <>
      <Input type="file" id="lms-upload" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleLmsExcelUpload} />
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><Monitor className="w-5 h-5 text-primary" /> Parcours E-Learning </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="relative">
            <Card className="border-dashed border-2 hover:bg-muted/50 transition-colors min-h-[200px] flex flex-col items-center justify-center p-6 h-full cursor-pointer">
              <label htmlFor="lms-upload" className="absolute inset-0 w-full h-full cursor-pointer z-10" aria-label="Importer un fichier Excel pour un nouveau parcours" />
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 relative z-0 pointer-events-none"><Upload className="w-6 h-6 text-primary" /></div>
              <p className="font-semibold text-primary relative z-0 pointer-events-none">Nouveau parcours</p>
              <p className="text-xs text-muted-foreground text-center mt-1 relative z-0 pointer-events-none">Cliquer pour importer un fichier Excel</p>
            </Card>
          </div>

          {elearningModules.map((m: ElearningModule) => {
            const completed = safeNum(m.completedCount);
            const total = safeNum(m.totalAssigned);
            const completionRate = calculatePercentage(completed, total);

            return (
              <div key={m.id} className="relative group">
                <Card className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow h-full">
                  <button type="button" aria-label={`Voir détails ${m.name}`} onClick={() => setSelectedModule(m)} className="absolute inset-0 w-full h-full bg-transparent border-none z-0 cursor-pointer appearance-none outline-none focus:ring-2 focus:ring-primary focus:ring-inset" />

                  <CardHeader className="pb-2 relative z-10 pointer-events-none">
                    <div className="flex justify-between items-start pointer-events-auto">
                      <div className="flex flex-col gap-2">
                        <Badge variant="secondary" className="mb-2 w-fit">{m.targetAudience}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 z-20" onClick={(e) => { e.stopPropagation(); setModuleToDelete(m); }}>
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                    <CardTitle className="text-lg leading-tight">{m.name}</CardTitle>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4 relative z-10 pointer-events-none">
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
                      {(m.startDate || m.deadline) && (
                        <div className="flex items-center gap-1 text-amber-600 font-medium">
                          <CalendarDays className="w-3 h-3" />
                          <span>Échéance: {m.deadline ? new Date(m.deadline).toLocaleDateString() : '--'}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>

                  <div className="p-4 bg-muted/30 border-t flex gap-2 relative z-10 pointer-events-auto">
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={(e) => { e.stopPropagation(); setSelectedModule(m); }}>
                      <Eye className="w-3 h-3 mr-2" /> Détails
                    </Button>
                    <Button variant="outline" size="sm" className="w-full text-xs text-primary border-primary/20 hover:bg-primary/5" onClick={(e) => { e.stopPropagation(); toast.success("Relance envoyée aux retardataires"); }}>
                      <Mail className="w-3 h-3 mr-2" /> Relancer
                    </Button>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-12">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4"><Mic className="w-5 h-5 text-amber-500" /> Sessions de Sensibilisation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          <div className="relative">
            <Card className="border-dashed border-2 border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center p-6 hover:bg-amber-500/10 transition-colors min-h-[200px]">
              <button type="button" aria-label="Nouvelle session" onClick={() => { setIsAddModuleOpen(true); setNewModule({...newModule, formatType: "Webinaire"}); }} className="absolute inset-0 w-full h-full bg-transparent border-none z-0 cursor-pointer appearance-none outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset" />
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 relative z-10 pointer-events-none"><Plus className="w-6 h-6 text-amber-600" /></div>
              <p className="font-semibold text-amber-700 relative z-10 pointer-events-none">Nouvelle session</p>
              <p className="text-xs text-amber-700/70 text-center mt-1 relative z-10 pointer-events-none">Déclarer un Webinaire ou du Présentiel</p>
            </Card>
          </div>

          {sessionModules.map((m: ElearningModule) => {
            const completed = safeNum(m.completedCount);
            const total = safeNum(m.totalAssigned);
            const completionRate = calculatePercentage(completed, total);
            const formatType = m.formatType || "Webinaire";
            const icon = formatType === "Présentiel" ? <Users className="w-3 h-3 mr-1" /> : <Video className="w-3 h-3 mr-1" />;

            return (
              <div key={m.id} className="relative group">
                <Card className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow h-full">
                  <button type="button" aria-label={`Ouvrir session ${m.name}`} onClick={() => setSelectedModule(m)} className="absolute inset-0 w-full h-full bg-transparent border-none z-0 cursor-pointer appearance-none outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset" />

                  <CardHeader className="pb-2 relative z-10 pointer-events-none">
                    <div className="flex justify-between items-start pointer-events-auto">
                      <div className="flex flex-col gap-2">
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 w-fit">{icon} {formatType}</Badge>
                        <Badge variant="secondary" className="mb-2 w-fit">{m.targetAudience}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 z-20" onClick={(e) => { e.stopPropagation(); setModuleToDelete(m); }}>
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                    <CardTitle className="text-lg leading-tight">{m.name}</CardTitle>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4 relative z-10 pointer-events-none">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Présence</span>
                        <span className="font-bold">{completionRate}%</span>
                      </div>
                      <Progress value={completionRate} className="h-2 [&>div]:bg-amber-500" />
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-t border-border">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Users className="w-3 h-3" />
                        <span>{completed} / {total} présents</span>
                      </div>
                      {m.startDate && (
                        <div className="flex items-center gap-1 text-amber-600 font-medium">
                          <CalendarDays className="w-3 h-3" />
                          <span>Le {new Date(m.startDate).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>

                  <div className="p-4 bg-muted/30 border-t flex gap-2 relative z-10 pointer-events-auto">
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={(e) => { e.stopPropagation(); setSelectedModule(m); setIsAttendanceModalOpen(true); }}>
                      <CheckSquare className="w-3 h-3 mr-2" /> Présences
                    </Button>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================
export default function AwarenessView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("phishing");
  const [phishingView, setPhishingView] = useState<"historique" | "bilan">("historique");

  const [isAddCampaignOpen, setIsAddCampaignOpen] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
  const [isLmsImportOpen, setIsLmsImportOpen] = useState(false);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [isResetProfilesOpen, setIsResetProfilesOpen] = useState(false);

  const [selectedCampaign, setSelectedCampaign] = useState<PhishingCampaign | null>(null);
  const [selectedModule, setSelectedModule] = useState<ElearningModule | null>(null);
  const [isRecidivistsDialogOpen, setIsRecidivistsDialogOpen] = useState(false);

  const [campaignToDelete, setCampaignToDelete] = useState<PhishingCampaign | null>(null);
  const [moduleToDelete, setModuleToDelete] = useState<ElearningModule | null>(null);
  const [participantToRemove, setParticipantToRemove] = useState<string | null>(null);

  const [newCampaign, setNewCampaign] = useState({
    name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen", targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0,
    compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [] as string[], detailedResults: [] as any[], fileLoaded: false
  });

  const [parsedLmsData, setParsedLmsData] = useState({
    name: "", originalExcelName: "", targetAudience: "Tous", totalAssigned: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0, completedBy: [] as string[],
    startDate: undefined as string | undefined, deadline: undefined as string | undefined, fileLoaded: false, selectedModuleId: "new", isRenewal: false
  });

  const [attendanceEmails, setAttendanceEmails] = useState("");
  const [updatedProfilesBatch, setUpdatedProfilesBatch] = useState<PhishingProfile[]>([]);
  const [newModule, setNewModule] = useState({ name: "", formatType: "E-Learning", targetAudience: "Tous", totalAssigned: 100, startDate: "", deadline: "" });

  const { data: campaigns = [], isLoading: isLoadingCampaigns } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: profiles = [], isLoading: isLoadingProfiles } = useQuery({ queryKey: ['profiles'], queryFn: fetchPhishingProfiles });
  const { data: modules = [], isLoading: isLoadingModules } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  const elearningModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") === "E-Learning");
  const sessionModules = modules.filter(m => (m.formatType || (m as any).format_type || "E-Learning") !== "E-Learning");

  const uniqueDepartments = Array.from(new Set(profiles.map(p => p.department).filter(d => d && d.trim() !== ""))).sort((a, b) => a.localeCompare(b));

  // --- MUTATIONS ---
  const resetProfilesMutation = useMutation({
    mutationFn: async () => {
      const currentProfiles = await fetchPhishingProfiles();
      const resetProfiles = currentProfiles.map(p => ({
        ...p, totalCampaigns: 0, total_campaigns: 0, openedCount: 0, opened_count: 0, attachmentOpenedCount: 0, attachment_opened_count: 0,
        clickedCount: 0, clicked_count: 0, compromisedCount: 0, compromised_count: 0, trainingCompletedCount: 0, training_completed_count: 0,
        reportedCount: 0, reported_count: 0, riskScore: 0, lastCampaignClicked: false, isConsecutive: false, is_consecutive: false
      }));
      for (let i = 0; i < resetProfiles.length; i += 500) await upsertPhishingProfiles(resetProfiles.slice(i, i + 500) as any);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success("Tous les compteurs ont été purgés !"); setIsResetProfilesOpen(false); }
  });

  const addCampaignMutation = useMutation({
    mutationFn: async () => {
      await createPhishingCampaign({ ...newCampaign, detailed_results: newCampaign.detailedResults } as any);
      for (let i = 0; i < updatedProfilesBatch.length; i += 500) await upsertPhishingProfiles(updatedProfilesBatch.slice(i, i + 500));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phishing'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success("Campagne enregistrée !"); setIsAddCampaignOpen(false); setUpdatedProfilesBatch([]);
    }
  });

  const delCampaignMutation = useMutation({
    mutationFn: async (campaign: PhishingCampaign) => {
      const detailed = campaign.detailedResults || (campaign as any).detailed_results || [];
      if (detailed.length > 0) {
        const currentProfiles = await fetchPhishingProfiles();
        const profilesMap = new Map(currentProfiles.map(p => [p.email, p]));
        const profilesToUpdate: PhishingProfile[] = [];

        detailed.forEach((res: any) => {
          const p = profilesMap.get(res.email);
          if (p) {
            p.totalCampaigns = Math.max(0, safeNum(p.totalCampaigns ?? (p as any).total_campaigns) - 1);
            p.openedCount = Math.max(0, safeNum(p.openedCount ?? (p as any).opened_count) - (res.opened ? 1 : 0));
            p.attachmentOpenedCount = Math.max(0, safeNum(p.attachmentOpenedCount ?? (p as any).attachment_opened_count) - (res.attachment ? 1 : 0));
            p.clickedCount = Math.max(0, safeNum(p.clickedCount ?? (p as any).clicked_count) - (res.clicked ? 1 : 0));
            p.compromisedCount = Math.max(0, safeNum(p.compromisedCount ?? (p as any).compromised_count) - (res.compromised ? 1 : 0));
            p.trainingCompletedCount = Math.max(0, safeNum(p.trainingCompletedCount ?? (p as any).training_completed_count) - (res.training ? 1 : 0));
            p.reportedCount = Math.max(0, safeNum(p.reportedCount ?? (p as any).reported_count) - (res.reported ? 1 : 0));

            if (p.clickedCount + p.attachmentOpenedCount <= 1) { p.isConsecutive = false; p.lastCampaignClicked = false; }
            p.riskScore = calculateRiskScore(p.clickedCount, p.attachmentOpenedCount, p.compromisedCount, p.reportedCount, p.trainingCompletedCount, p.isConsecutive || false);
            profilesToUpdate.push(p);
          }
        });
        for (let i = 0; i < profilesToUpdate.length; i += 500) await upsertPhishingProfiles(profilesToUpdate.slice(i, i + 500));
      }
      await deletePhishingCampaign(campaign.id);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['phishing'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success("Campagne supprimée !"); setSelectedCampaign(null); }
  });

  const saveLmsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: parsedLmsData.name, targetAudience: parsedLmsData.targetAudience, target_audience: parsedLmsData.targetAudience, formatType: "E-Learning", format_type: "E-Learning",
        totalAssigned: safeNum(parsedLmsData.totalAssigned), total_assigned: safeNum(parsedLmsData.totalAssigned), completedCount: safeNum(parsedLmsData.completedCount), completed_count: safeNum(parsedLmsData.completedCount),
        completedBy: parsedLmsData.completedBy, completed_by: parsedLmsData.completedBy, startDate: parsedLmsData.startDate || null, start_date: parsedLmsData.startDate || null, deadline: parsedLmsData.deadline || null,
      };
      if (parsedLmsData.selectedModuleId !== "new") await updateElearningModule(parsedLmsData.selectedModuleId, payload as any);
      else await createElearningModule(payload as any);
      for (let i = 0; i < updatedProfilesBatch.length; i += 500) await upsertPhishingProfiles(updatedProfilesBatch.slice(i, i + 500));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success("Statistiques synchronisées !"); setIsLmsImportOpen(false); }
  });

  const delModuleMutation = useMutation({
    mutationFn: async (module: ElearningModule) => {
      const completedEmails = module.completedBy || (module as any).completed_by || [];
      if (completedEmails.length > 0) {
        const currentProfiles = await fetchPhishingProfiles();
        const profilesMap = new Map(currentProfiles.map(p => [p.email, p]));
        const profilesToUpdate: PhishingProfile[] = [];
        completedEmails.forEach((email: string) => {
          const p = profilesMap.get(email);
          if (p) {
            p.trainingCompletedCount = Math.max(0, safeNum(p.trainingCompletedCount ?? (p as any).training_completed_count) - 1);
            p.riskScore = calculateRiskScore(safeNum(p.clickedCount), safeNum(p.attachmentOpenedCount), safeNum(p.compromisedCount), safeNum(p.reportedCount), p.trainingCompletedCount, p.isConsecutive || false);
            profilesToUpdate.push(p);
          }
        });
        for (let i = 0; i < profilesToUpdate.length; i += 500) await upsertPhishingProfiles(profilesToUpdate.slice(i, i + 500));
      }
      await deleteElearningModule(module.id);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success("Élément supprimé !"); setModuleToDelete(null); setSelectedModule(null); }
  });

  const addModuleMutation = useMutation({
    mutationFn: async (module: typeof newModule) => {
      await createElearningModule({
        name: module.name, targetAudience: module.targetAudience, target_audience: module.targetAudience, formatType: module.formatType, format_type: module.formatType,
        totalAssigned: module.totalAssigned, total_assigned: module.totalAssigned, completedCount: 0, completed_count: 0, completedBy: [], completed_by: [],
        startDate: module.startDate ? new Date(module.startDate).toISOString() : null, deadline: module.deadline ? new Date(module.deadline).toISOString() : null
      } as any);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Créé avec succès !"); setIsAddModuleOpen(false); }
  });

  const validateAttendanceMutation = useMutation({
    mutationFn: async ({ moduleId, rawEmails }: { moduleId: string, rawEmails: string }) => {
      const module = modules.find(m => m.id === moduleId);
      if (!module) throw new Error("Module introuvable");

      const emailRegex = /[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/g;
      const extractedEmails = rawEmails.match(emailRegex) || [];
      const existingCompletedEmails = module.completedBy || (module as any).completed_by || [];
      const newlyCompletedEmails: string[] = [];
      const profilesToUpdate: PhishingProfile[] = [];
      const currentProfilesMap = new Map(profiles.map(p => [p.email.toLowerCase(), p]));

      let completedAdded = 0;
      extractedEmails.forEach(email => {
        const lowerEmail = email.toLowerCase().trim();
        if (!existingCompletedEmails.includes(lowerEmail) && !newlyCompletedEmails.includes(lowerEmail) && currentProfilesMap.has(lowerEmail)) {
          newlyCompletedEmails.push(lowerEmail);
          const p = { ...currentProfilesMap.get(lowerEmail)! };
          p.trainingCompletedCount = safeNum(p.trainingCompletedCount ?? (p as any).training_completed_count) + 1;
          p.riskScore = calculateRiskScore(safeNum(p.clickedCount), safeNum(p.attachmentOpenedCount), safeNum(p.compromisedCount), safeNum(p.reportedCount), p.trainingCompletedCount, p.isConsecutive || false);
          profilesToUpdate.push(p);
          completedAdded++;
        }
      });

      const newCompletedCount = safeNum(module.completedCount) + completedAdded;
      const newCompletedBy = [...existingCompletedEmails, ...newlyCompletedEmails];
      await updateElearningModule(moduleId, { completedCount: newCompletedCount, completed_count: newCompletedCount, completedBy: newCompletedBy, completed_by: newCompletedBy } as any);

      for (let i = 0; i < profilesToUpdate.length; i += 500) await upsertPhishingProfiles(profilesToUpdate.slice(i, i + 500));
      return completedAdded;
    },
    onSuccess: (added) => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success(`${added} présences validées !`); setIsAttendanceModalOpen(false); setAttendanceEmails(""); }
  });

  const removeParticipantMutation = useMutation({
    mutationFn: async ({ moduleId, emailToRemove }: { moduleId: string, emailToRemove: string }) => {
      const module = modules.find(m => m.id === moduleId);
      if (!module) throw new Error("Module introuvable");
      const existingCompletedEmails = module.completedBy || (module as any).completed_by || [];
      const newCompletedBy = existingCompletedEmails.filter((email: string) => email !== emailToRemove);
      const newCompletedCount = Math.max(0, safeNum(module.completedCount) - 1);
      await updateElearningModule(moduleId, { completedCount: newCompletedCount, completed_count: newCompletedCount, completedBy: newCompletedBy, completed_by: newCompletedBy } as any);

      const currentProfiles = await fetchPhishingProfiles();
      const profile = currentProfiles.find(p => p.email.toLowerCase() === emailToRemove.toLowerCase());
      if (profile) {
        profile.trainingCompletedCount = Math.max(0, safeNum(profile.trainingCompletedCount ?? (profile as any).training_completed_count) - 1);
        profile.riskScore = calculateRiskScore(safeNum(profile.clickedCount), safeNum(profile.attachmentOpenedCount), safeNum(profile.compromisedCount), safeNum(profile.reportedCount), profile.trainingCompletedCount, profile.isConsecutive || false);
        await upsertPhishingProfiles([profile]);
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); queryClient.invalidateQueries({ queryKey: ['profiles'] }); toast.success("Participant retiré !"); setSelectedModule(null); }
  });

  const handleProofpointUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const results = processProofpointData(text, profiles);
      setUpdatedProfilesBatch(results.updatedProfiles);
      setNewCampaign(prev => ({
        ...prev, targetCount: results.target, openedCount: results.opened, attachmentOpenedCount: results.attachmentOpened,
        clickedCount: results.clicked, compromisedCount: results.compromised, trainingCompletedCount: results.trainingCompleted,
        reportedCount: results.reported, recidivistsCount: results.recidivists, failedEmails: results.failedEmails,
        detailedResults: results.detailedResults, fileLoaded: true
      }));
      toast.success(`Analyse terminée : ${results.target} collaborateurs traités.`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Erreur de lecture du fichier.");
    }
    e.target.value = '';
  };

  const handleLmsExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const results = processLmsWorkbookData(workbook, modules, profiles);

      setUpdatedProfilesBatch(results.profilesToUpdate);
      setParsedLmsData({
        name: results.moduleName, originalExcelName: results.originalExcelName, targetAudience: "Tous",
        totalAssigned: results.totalAssigned, completedCount: results.completedCount, inProgressCount: results.inProgressCount, notStartedCount: results.notStartedCount,
        completedBy: results.completedBy, startDate: results.startDateFound, deadline: results.endDateFound, fileLoaded: true,
        selectedModuleId: results.matchedModuleId, isRenewal: results.isRenewal
      });
      setIsLmsImportOpen(true);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
    e.target.value = '';
  };

  const renderTabActions = () => {
    if (activeTab === "profilage") {
      return (
        <div className="flex gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={() => setIsResetProfilesOpen(true)} className="text-destructive border-destructive/20 hover:bg-destructive/10">
            <Trash2 className="w-4 h-4 mr-2" /> Remettre à zéro
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><div className="cursor-not-allowed"><Button size="sm" variant="secondary" disabled className="pointer-events-none">Générer un rapport</Button></div></TooltipTrigger>
              <TooltipContent><p>À venir</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    }
    if (activeTab === "elearning") {
      return (
        <div className="flex gap-2 mb-2">
          <div className="relative">
            <Input type="file" id="lms-upload-top" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleLmsExcelUpload} />
            <Button variant="outline" size="sm" asChild>
              <label htmlFor="lms-upload-top" className="cursor-pointer"><Upload className="w-4 h-4 mr-2" /> Import (Excel)</label>
            </Button>
          </div>
          <Button size="sm" onClick={() => setIsAddModuleOpen(true)}><Plus className="w-4 h-4 mr-2" /> Nouvelle Session</Button>
        </div>
      );
    }
    return (
      <Button size="sm" onClick={() => setIsAddCampaignOpen(true)} className="mb-2">
        <Upload className="w-4 h-4 mr-2" /> Import Proofpoint
      </Button>
    );
  };

  const renderLmsSubmitLabel = () => {
    if (saveLmsMutation.isPending) return <Loader2 className="w-4 h-4 animate-spin" />;
    if (parsedLmsData.selectedModuleId !== "new") return "Mettre à jour la carte";
    return "Créer le module et mettre à jour";
  };

  if (isLoadingCampaigns || isLoadingProfiles || isLoadingModules) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">

      <KpiGrid campaigns={campaigns} profiles={profiles} elearningModules={elearningModules} sessionModules={sessionModules} />

      {/* --- TABS MAIN SECTION --- */}
      <Card className="shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b flex justify-between items-center flex-wrap gap-4">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="phishing" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">Campagnes</TabsTrigger>
              <TabsTrigger value="profilage" className="data-[state=active]:border-b-2 data-[state=active]:border-amber-500 rounded-none pb-3">Profilage des Risques</TabsTrigger>
              <TabsTrigger value="elearning" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">Sessions & E-Learning</TabsTrigger>
            </TabsList>

            {renderTabActions()}
          </div>

          <TabsContent value="phishing" className="m-0">
            <PhishingTabContent campaigns={campaigns} setSelectedCampaign={setSelectedCampaign} phishingView={phishingView} setPhishingView={setPhishingView} />
          </TabsContent>

          <TabsContent value="profilage" className="p-6">
            <ProfilageTabContent profiles={profiles} uniqueDepartments={uniqueDepartments} />
          </TabsContent>

          <TabsContent value="elearning" className="p-6">
             <ElearningTabContent
               elearningModules={elearningModules}
               sessionModules={sessionModules}
               handleLmsExcelUpload={handleLmsExcelUpload}
               setIsAddModuleOpen={setIsAddModuleOpen}
               setNewModule={setNewModule}
               newModule={newModule}
               setSelectedModule={setSelectedModule}
               setModuleToDelete={setModuleToDelete}
               setIsAttendanceModalOpen={setIsAttendanceModalOpen}
             />
          </TabsContent>
        </Tabs>
      </Card>

      {/* --- PANNEAUX DE DÉTAILS --- */}

      <Sheet open={!!selectedCampaign} onOpenChange={(open) => { if(!open) setSelectedCampaign(null); }}>
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

                <div className="relative">
                  <div className={`p-4 border rounded-lg text-center space-y-1 shadow-sm transition-all h-full flex flex-col justify-center ${selectedCampaign.recidivistsCount > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-500/5 border-amber-500/10 opacity-50'}`}>
                    {selectedCampaign.recidivistsCount > 0 && (
                       <button type="button" aria-label="Voir la liste des récidivistes" onClick={() => setIsRecidivistsDialogOpen(true)} className="absolute inset-0 w-full h-full bg-transparent border-none cursor-pointer z-0 hover:bg-amber-500/5 focus:ring-2 focus:ring-amber-500" />
                    )}
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider relative z-10 pointer-events-none">Récidivistes</p>
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-500 relative z-10 pointer-events-none">{selectedCampaign.recidivistsCount}</p>
                    {selectedCampaign.recidivistsCount > 0 && (
                      <p className="text-[10px] text-amber-600/60 mt-1 flex items-center justify-center gap-1 relative z-10 pointer-events-none">
                        <Eye className="w-3 h-3" /> Voir la liste
                      </p>
                    )}
                  </div>
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

      <Sheet open={!!selectedModule && !isAttendanceModalOpen} onOpenChange={(open) => !open && setSelectedModule(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl pr-4">{selectedModule?.name}</SheetTitle>
            <SheetDescription>Détails d'avancement de la session</SheetDescription>
          </SheetHeader>

          {selectedModule && (() => {
            const completed = safeNum(selectedModule.completedCount);
            const total = safeNum(selectedModule.totalAssigned);
            const inProgress = Math.max(0, total - completed);
            const completionRate = calculatePercentage(completed, total);
            const formatType = selectedModule.formatType || "E-Learning";
            const completedEmails = selectedModule.completedBy || [];

            return (
              <div className="space-y-6">
                {(selectedModule.startDate || selectedModule.deadline) && (
                  <div className="bg-muted/30 p-3 rounded-lg flex items-center justify-center gap-4 text-sm font-medium border border-border/50">
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-muted-foreground">Début</span>
                      <span>{selectedModule.startDate ? new Date(selectedModule.startDate).toLocaleDateString() : '--'}</span>
                    </div>
                    <div className="h-4 w-px bg-border"></div>
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-muted-foreground">Fin</span>
                      <span className="text-amber-600">{selectedModule.deadline ? new Date(selectedModule.deadline).toLocaleDateString() : '--'}</span>
                    </div>
                  </div>
                )}

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
                  <h4 className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Participation</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-md border bg-card">
                      <span className="text-sm font-medium flex items-center gap-2 text-muted-foreground"><Users className="w-4 h-4"/> Inscrits / Conviés</span>
                      <span className="font-bold">{total}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-md bg-amber-50 border border-amber-100 ml-4">
                      <span className="text-sm font-medium flex items-center gap-2 text-amber-700"><Clock className="w-4 h-4"/> Absents / Non réalisés</span>
                      <span className="font-bold text-amber-700">{inProgress}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-md bg-emerald-50 border border-emerald-100 ml-8">
                      <span className="text-sm font-medium flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-4 h-4"/> Présents / Terminés</span>
                      <span className="font-bold text-emerald-700">{completed}</span>
                    </div>
                  </div>
                </div>

                {/* LISTE DES PARTICIPANTS VALIDÉS AVEC SUPPRESSION IN-APP */}
                {completedEmails.length > 0 && (
                  <div className="pt-6 border-t space-y-3">
                     <h4 className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckSquare className="w-4 h-4" /> Liste des validés</h4>
                     <div className="max-h-48 overflow-y-auto border rounded-md divide-y text-xs">
                        {completedEmails.map((email: string) => {
                           const profile = profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
                           const displayName = profile ? `${profile.firstName} ${profile.lastName}` : email;

                           return (
                             <div key={email} className="flex justify-between items-center p-2 hover:bg-muted/50 group">
                               <div className="flex flex-col">
                                  <span className="font-medium">{displayName}</span>
                                  {profile && <span className="text-[10px] text-muted-foreground">{email}</span>}
                               </div>
                               <Button
                                 variant="ghost"
                                 size="sm"
                                 className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                 title="Retirer la validation"
                                 onClick={() => setParticipantToRemove(email)}
                               >
                                 <UserMinus className="w-3 h-3" />
                               </Button>
                             </div>
                           );
                        })}
                     </div>
                  </div>
                )}

                <div className="mt-8 pt-6 border-t flex flex-col gap-2">
                  {formatType !== "E-Learning" && (
                    <Button variant="default" className="w-full" onClick={() => setIsAttendanceModalOpen(true)}>
                      <CheckSquare className="w-4 h-4 mr-2" /> Déclarer des présences
                    </Button>
                  )}
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

      <Dialog open={isAttendanceModalOpen} onOpenChange={(open) => {
        setIsAttendanceModalOpen(open);
        if (!open) { setAttendanceEmails(""); setSelectedModule(null); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Valider les présences</DialogTitle>
            <DialogDescription>Copiez-collez la liste des emails des collaborateurs présents (séparés par des virgules ou retours à la ligne).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <Textarea
              placeholder="jean.dupont@entreprise.com&#10;marie.curie@entreprise.com"
              className="min-h-[150px] font-mono text-xs"
              value={attendanceEmails}
              onChange={(e) => setAttendanceEmails(e.target.value)}
            />
            <div className="text-xs text-muted-foreground bg-primary/5 p-2 rounded">
              L'algorithme va extraire automatiquement les adresses email valides de votre texte et créditer le bonus sur leur score de risque.
            </div>
            <Button
              className="w-full"
              disabled={!attendanceEmails || validateAttendanceMutation.isPending}
              onClick={() => {
                if (selectedModule) validateAttendanceMutation.mutate({ moduleId: selectedModule.id, rawEmails: attendanceEmails });
              }}
            >
              {validateAttendanceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Valider les présences et mettre à jour"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                {(() => {
                  const detailedResults = selectedCampaign?.detailedResults || (selectedCampaign as any)?.detailed_results || [];
                  return detailedResults.filter((r: any) => r.isRecidivist).map((r: any) => {
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
                            <Badge variant="outline" className={`font-bold ${getRiskBadgeClassOutline(safeNum(profile.riskScore))}`}>
                              {safeNum(profile.riskScore)} pts
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  });
                })()}
              </TableBody>
            </Table>

            {(() => {
              const detailedResults = selectedCampaign?.detailedResults || (selectedCampaign as any)?.detailed_results || [];
              if (detailedResults.filter((r: any) => r.isRecidivist).length === 0) {
                return (
                  <div className="p-8 text-center text-muted-foreground italic text-sm">
                    Aucun détail disponible. Veuillez réimporter le fichier CSV de cette campagne pour afficher cette liste.
                  </div>
                );
              }
            })()}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddCampaignOpen} onOpenChange={(open) => { setIsAddCampaignOpen(open); if(!open) setNewCampaign({ name: "", sendDate: new Date().toISOString().split('T')[0], difficulty: "moyen", targetCount: 0, openedCount: 0, attachmentOpenedCount: 0, clickedCount: 0, compromisedCount: 0, trainingCompletedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [], detailedResults: [], fileLoaded: false }); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
             <DialogTitle>Importer les résultats Proofpoint</DialogTitle>
             <DialogDescription className="sr-only">Importer le fichier CSV extrait de Proofpoint pour consolider les résultats.</DialogDescription>
          </DialogHeader>
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
        if(!open) setParsedLmsData({ name: "", originalExcelName: "", targetAudience: "Tous", totalAssigned: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0, completedBy: [], startDate: undefined, deadline: undefined, fileLoaded: false, selectedModuleId: "new", isRenewal: false });
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer un fichier E-Learning (LMS)</DialogTitle>
            <DialogDescription>Synchronisez les résultats avec une formation existante ou créez-en une nouvelle.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {parsedLmsData.fileLoaded && (
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 space-y-4">

                {parsedLmsData.isRenewal && (
                  <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-md text-sm text-blue-700 dark:text-blue-400 mb-4 flex items-start gap-2">
                    <Clock className="w-5 h-5 shrink-0 mt-0.5" />
                    <p><strong>Renouvellement détecté :</strong> Les dates de cette session diffèrent de la précédente. Un nouveau module va être créé automatiquement pour conserver l'historique.</p>
                  </div>
                )}

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
                      {elearningModules.map(m => (
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

                  {(parsedLmsData.startDate || parsedLmsData.deadline) && (
                    <div className="flex justify-between text-sm mb-2 text-primary">
                      <span className="text-muted-foreground">Période:</span>
                      <span className="font-medium">
                        {parsedLmsData.startDate ? new Date(parsedLmsData.startDate).toLocaleDateString() : '--'} au {parsedLmsData.deadline ? new Date(parsedLmsData.deadline).toLocaleDateString() : '--'}
                      </span>
                    </div>
                  )}

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
              {renderLmsSubmitLabel()}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddModuleOpen} onOpenChange={(open) => {
        setIsAddModuleOpen(open);
        if(!open) setNewModule({ name: "", formatType: "E-Learning", targetAudience: "Tous", totalAssigned: 100, startDate: "", deadline: "" });
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Déclarer une nouvelle session</DialogTitle>
            <DialogDescription>Crée une session pour y inscrire vos collaborateurs (Webinaire, Présentiel, etc.).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Format</Label>
                <Select value={newModule.formatType} onValueChange={(val) => setNewModule({...newModule, formatType: val})}>
                  <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="E-Learning">🖥️ E-Learning (LMS)</SelectItem>
                    <SelectItem value="Webinaire">🎥 Webinaire (En ligne)</SelectItem>
                    <SelectItem value="Présentiel">👥 Session Présentielle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Cible (Domaine)</Label>
                <Select value={newModule.targetAudience} onValueChange={(val) => setNewModule({...newModule, targetAudience: val})}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Tous">Tous collaborateurs</SelectItem>
                    {uniqueDepartments.map(dept => (
                      <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Nom de la formation</Label>
              <Input
                placeholder="Ex: Les bases du Phishing 2026"
                value={newModule.name}
                onChange={(e) => setNewModule({...newModule, name: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="space-y-1">
                <Label>Date {newModule.formatType === "E-Learning" ? "de début" : "de session"}</Label>
                <Input type="date" value={newModule.startDate} onChange={(e) => setNewModule({...newModule, startDate: e.target.value})} />
              </div>
              {newModule.formatType === "E-Learning" && (
                <div className="space-y-1">
                  <Label>Date d'échéance</Label>
                  <Input type="date" value={newModule.deadline} onChange={(e) => setNewModule({...newModule, deadline: e.target.value})} />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label>Nombre de participants attendus</Label>
              <Input type="number" min="1" value={newModule.totalAssigned} onChange={(e) => setNewModule({...newModule, totalAssigned: Number.parseInt(e.target.value, 10) || 0})} />
            </div>

            <Button
              className="w-full mt-4"
              disabled={!newModule.name || addModuleMutation.isPending}
              onClick={() => addModuleMutation.mutate(newModule as any)}
            >
              {addModuleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Créer la session
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isResetProfilesOpen} onOpenChange={setIsResetProfilesOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Purger les compteurs ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action va remettre <strong>à zéro</strong> tous les compteurs (Cibles, clics, etc.) et les Risk Scores de tous les collaborateurs.
              Utile pour nettoyer les données résiduelles d'anciennes campagnes supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => resetProfilesMutation.mutate()}
            >
              {resetProfilesMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Oui, tout remettre à zéro"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              Supprimer le module / la session ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 text-sm text-muted-foreground">
                Êtes-vous sûr de vouloir supprimer la session <strong>{moduleToDelete?.name}</strong> ? Son suivi sera perdu, <strong>et les scores de risques des collaborateurs associés seront recalculés (Rollback)</strong>.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (moduleToDelete) delModuleMutation.mutate(moduleToDelete);
              }}
            >
              Oui, supprimer la session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!participantToRemove} onOpenChange={(open) => !open && setParticipantToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Retirer ce participant ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 text-sm text-muted-foreground">
                Êtes-vous sûr de vouloir annuler la validation de <strong>{participantToRemove}</strong> pour cette session ? Son bonus de formation sera retiré et son Risk Score sera recalculé.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (participantToRemove && selectedModule) {
                  removeParticipantMutation.mutate({ moduleId: selectedModule.id, emailToRemove: participantToRemove });
                }
              }}
            >
              {removeParticipantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Oui, retirer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}