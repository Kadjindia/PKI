import { supabase } from "@/integrations/supabase/client";

export interface PhishingCampaign {
  id: string;
  name: string;
  sendDate: string;
  difficulty: 'facile' | 'moyen' | 'difficile';
  targetCount: number;
  clickedCount: number;
  compromisedCount: number;
  reportedCount: number;
  recidivistsCount: number;
  notes?: string;
  failedEmails: string[];
}

export interface ElearningModule {
  id: string;
  name: string;
  targetAudience: string;
  totalAssigned: number;
  completedCount: number;
  deadline: string | null;
}

// --- PHISHING API ---
export async function fetchPhishingCampaigns(): Promise<PhishingCampaign[]> {
  const { data, error } = await supabase.from('phishing_campaigns').select('*').order('send_date', { ascending: false });
  if (error) throw error;
  return data.map(row => ({
    id: row.id, name: row.name, sendDate: row.send_date, difficulty: row.difficulty as any,
    targetCount: row.target_count, clickedCount: row.clicked_count, compromisedCount: row.compromised_count,
    reportedCount: row.reported_count, recidivistsCount: row.recidivists_count, notes: row.notes,
    failedEmails: row.failed_emails || []
  }));
}

export async function createPhishingCampaign(campaign: Omit<PhishingCampaign, 'id'>): Promise<void> {
  const { error } = await supabase.from('phishing_campaigns').insert({
    name: campaign.name, send_date: campaign.sendDate, difficulty: campaign.difficulty,
    target_count: campaign.targetCount, clicked_count: campaign.clickedCount,
    compromised_count: campaign.compromisedCount, reported_count: campaign.reportedCount,
    recidivists_count: campaign.recidivistsCount, failed_emails: campaign.failedEmails
  });
  if (error) throw error;
}

export async function deletePhishingCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('phishing_campaigns').delete().eq('id', id);
  if (error) throw error;
}

// --- E-LEARNING API ---
export async function fetchElearningModules(): Promise<ElearningModule[]> {
  const { data, error } = await supabase.from('elearning_modules').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(row => ({
    id: row.id, name: row.name, targetAudience: row.target_audience,
    totalAssigned: row.total_assigned, completedCount: row.completed_count, deadline: row.deadline
  }));
}

export async function createElearningModule(module: Omit<ElearningModule, 'id' | 'completedCount'>): Promise<void> {
  const { error } = await supabase.from('elearning_modules').insert({
    name: module.name, target_audience: module.targetAudience,
    total_assigned: module.totalAssigned, deadline: module.deadline
  });
  if (error) throw error;
}

export async function updateElearningModule(id: string, updates: Partial<ElearningModule>): Promise<void> {
  const payload: any = {};
  if (updates.completedCount !== undefined) payload.completed_count = updates.completedCount;
  const { error } = await supabase.from('elearning_modules').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteElearningModule(id: string): Promise<void> {
  const { error } = await supabase.from('elearning_modules').delete().eq('id', id);
  if (error) throw error;
}