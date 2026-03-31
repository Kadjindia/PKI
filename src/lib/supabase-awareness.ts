import { supabase } from "@/integrations/supabase/client";

export interface PhishingCampaign {
  id: string;
  name: string;
  sendDate: string;
  difficulty: 'facile' | 'moyen' | 'difficile';
  targetCount: number;
  openedCount: number;
  attachmentOpenedCount: number;
  clickedCount: number;
  compromisedCount: number;
  trainingCompletedCount: number;
  reportedCount: number;
  recidivistsCount: number;
  notes?: string;
  failedEmails: string[];
  detailedResults?: any[]; // NOUVEAU : Le journal exact de la campagne
}

export interface PhishingProfile {
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  totalCampaigns: number;
  openedCount: number;
  attachmentOpenedCount: number;
  clickedCount: number;
  compromisedCount: number;
  trainingCompletedCount: number;
  reportedCount: number;
  riskScore: number;
  lastCampaignClicked: boolean;
  isConsecutive: boolean;
}

export interface ElearningModule {
  id: string;
  name: string;
  targetAudience: string;
  totalAssigned: number;
  completedCount: number;
  deadline: string | null;
}

// --- API CAMPAGNES ---
export async function fetchPhishingCampaigns(): Promise<PhishingCampaign[]> {
  const { data, error } = await (supabase as any).from('phishing_campaigns').select('*').order('send_date', { ascending: false });
  if (error) throw error;
  return data.map((row: any) => ({
    id: row.id, name: row.name, sendDate: row.send_date, difficulty: row.difficulty,
    targetCount: row.target_count, openedCount: row.opened_count || 0,
    attachmentOpenedCount: row.attachment_opened_count || 0,
    clickedCount: row.clicked_count, compromisedCount: row.compromised_count,
    trainingCompletedCount: row.training_completed_count || 0,
    reportedCount: row.reported_count, recidivistsCount: row.recidivists_count, notes: row.notes,
    failedEmails: row.failed_emails || [],
    detailedResults: row.detailed_results || [] // NOUVEAU
  }));
}

export async function createPhishingCampaign(campaign: Omit<PhishingCampaign, 'id'>): Promise<void> {
  const { error } = await (supabase as any).from('phishing_campaigns').insert({
    name: campaign.name, send_date: campaign.sendDate, difficulty: campaign.difficulty,
    target_count: campaign.targetCount, opened_count: campaign.openedCount,
    attachment_opened_count: campaign.attachmentOpenedCount,
    clicked_count: campaign.clickedCount, compromised_count: campaign.compromisedCount,
    training_completed_count: campaign.trainingCompletedCount,
    reported_count: campaign.reportedCount, recidivists_count: campaign.recidivistsCount,
    failed_emails: campaign.failedEmails,
    detailed_results: campaign.detailedResults || [] // NOUVEAU
  });
  if (error) throw error;
}

export async function deletePhishingCampaign(id: string): Promise<void> {
  const { error } = await (supabase as any).from('phishing_campaigns').delete().eq('id', id);
  if (error) throw error;
}

// --- API PROFILS ---
export async function fetchPhishingProfiles(): Promise<PhishingProfile[]> {
  const { data, error } = await (supabase as any).from('phishing_profiles').select('*').order('risk_score', { ascending: false });
  if (error) throw error;
  return data.map((row: any) => ({
    email: row.email, firstName: row.first_name, lastName: row.last_name, department: row.department,
    totalCampaigns: row.total_campaigns, openedCount: row.opened_count || 0,
    attachmentOpenedCount: row.attachment_opened_count || 0,
    clickedCount: row.clicked_count, compromisedCount: row.compromised_count,
    trainingCompletedCount: row.training_completed_count || 0,
    reportedCount: row.reported_count, riskScore: row.risk_score,
    lastCampaignClicked: row.last_campaign_clicked, isConsecutive: row.is_consecutive
  }));
}

export async function upsertPhishingProfiles(profiles: PhishingProfile[]): Promise<void> {
  const payload = profiles.map(p => ({
    email: p.email,
    first_name: p.firstName,
    last_name: p.lastName,
    department: p.department,
    total_campaigns: p.totalCampaigns,
    opened_count: p.openedCount,
    attachment_opened_count: p.attachmentOpenedCount,
    clicked_count: p.clickedCount,
    compromised_count: p.compromisedCount,
    training_completed_count: p.trainingCompletedCount,
    reported_count: p.reportedCount,
    risk_score: p.riskScore, /* <--- LA CORRECTION EST ICI (risk_score) */
    last_campaign_clicked: p.lastCampaignClicked,
    is_consecutive: p.isConsecutive
  }));

  const { error } = await (supabase as any).from('phishing_profiles').upsert(payload, { onConflict: 'email' });
  if (error) throw error;
}

// --- API E-LEARNING ---
export async function fetchElearningModules(): Promise<ElearningModule[]> {
  const { data, error } = await (supabase as any).from('elearning_modules').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row: any) => ({
    id: row.id, name: row.name, targetAudience: row.target_audience,
    totalAssigned: row.total_assigned, completedCount: row.completed_count, deadline: row.deadline
  }));
}

export async function createElearningModule(module: Omit<ElearningModule, 'id' | 'completedCount'>): Promise<void> {
  const { error } = await (supabase as any).from('elearning_modules').insert({
    name: module.name, target_audience: module.targetAudience,
    total_assigned: module.totalAssigned, deadline: module.deadline
  });
  if (error) throw error;
}

export async function updateElearningModule(id: string, updates: Partial<ElearningModule>): Promise<void> {
  const payload: any = {};
  if (updates.completedCount !== undefined) payload.completed_count = updates.completedCount;
  const { error } = await (supabase as any).from('elearning_modules').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteElearningModule(id: string): Promise<void> {
  const { error } = await (supabase as any).from('elearning_modules').delete().eq('id', id);
  if (error) throw error;
}