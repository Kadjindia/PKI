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
  targetAudience?: string;
  totalAssigned: number;
  completedCount: number;
  completedBy?: string[];
  startDate?: string;
  deadline?: string;
  createdAt?: string;
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

// API E-LEARNING
export const fetchElearningModules = async (): Promise<ElearningModule[]> => {
  const { data, error } = await supabase.from('elearning_modules').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(item => ({
    id: item.id,
    name: item.name,
    targetAudience: item.target_audience,
    totalAssigned: item.total_assigned,
    completedCount: item.completed_count,
    completedBy: item.completed_by || [],
    startDate: item.start_date, // <-- NOUVEAU
    deadline: item.deadline,
    createdAt: item.created_at
  }));
};

export const createElearningModule = async (module: Omit<ElearningModule, 'id' | 'createdAt'>): Promise<ElearningModule> => {
  const dbPayload = {
    name: module.name,
    target_audience: module.targetAudience || 'Tous',
    total_assigned: module.totalAssigned || 0,
    completed_count: module.completedCount || 0,
    completed_by: module.completedBy || [],
    start_date: module.startDate, // <-- NOUVEAU
    deadline: module.deadline
  };
  const { data, error } = await supabase.from('elearning_modules').insert([dbPayload]).select().single();
  if (error) throw error;
  return {
    id: data.id, name: data.name, targetAudience: data.target_audience,
    totalAssigned: data.total_assigned, completedCount: data.completed_count,
    completedBy: data.completed_by, startDate: data.start_date, deadline: data.deadline
  };
};

export const updateElearningModule = async (id: string, updates: Partial<ElearningModule>): Promise<void> => {
  const dbPayload: any = {};
  if (updates.name !== undefined) dbPayload.name = updates.name;
  if (updates.targetAudience !== undefined) dbPayload.target_audience = updates.targetAudience;
  if (updates.totalAssigned !== undefined) dbPayload.total_assigned = updates.totalAssigned;
  if (updates.completedCount !== undefined) dbPayload.completed_count = updates.completedCount;
  if (updates.completedBy !== undefined) dbPayload.completed_by = updates.completedBy;
  if (updates.startDate !== undefined) dbPayload.start_date = updates.startDate; // <-- NOUVEAU
  if (updates.deadline !== undefined) dbPayload.deadline = updates.deadline;

  const { error } = await supabase.from('elearning_modules').update(dbPayload).eq('id', id);
  if (error) throw error;
};

export const deleteElearningModule = async (id: string): Promise<void> => {
  const { error } = await supabase.from('elearning_modules').delete().eq('id', id);
  if (error) throw error;
};