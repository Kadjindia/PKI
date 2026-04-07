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
  detailedResults?: any[];
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
  formatType?: string;
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
export const fetchPhishingProfiles = async (): Promise<PhishingProfile[]> => {
  let allData: any[] = [];
  let hasMore = true;
  let from = 0;
  let step = 1000;

  // Boucle pour contourner la limite des 1000 résultats de Supabase
  while (hasMore) {
    const { data, error } = await supabase
      .from('phishing_profiles')
      .select('*')
      .range(from, from + step - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      allData = [...allData, ...data];
      if (data.length < step) hasMore = false; // On est arrivé à la fin
      else from += step; // On passe aux 1000 suivants
    } else {
      hasMore = false;
    }
  }

  return allData.map(item => ({
    email: item.email,
    firstName: item.first_name || '',
    lastName: item.last_name || '',
    department: item.department || '',
    totalCampaigns: item.total_campaigns || 0,
    openedCount: item.opened_count || 0,
    attachmentOpenedCount: item.attachment_opened_count || 0,
    clickedCount: item.clicked_count || 0,
    compromisedCount: item.compromised_count || 0,
    trainingCompletedCount: item.training_completed_count || 0,
    reportedCount: item.reported_count || 0,
    riskScore: item.risk_score || 0,
    lastCampaignClicked: item.last_campaign_clicked || false,
    isConsecutive: item.is_consecutive || false
  }));
};

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
    formatType: item.format_type || 'E-Learning', // <-- NOUVEAU
    totalAssigned: item.total_assigned,
    completedCount: item.completed_count,
    completedBy: item.completed_by || [],
    startDate: item.start_date,
    deadline: item.deadline,
    createdAt: item.created_at
  }));
};

export const createElearningModule = async (module: Omit<ElearningModule, 'id' | 'createdAt'>): Promise<ElearningModule> => {
  const dbPayload = {
    name: module.name,
    target_audience: module.targetAudience || 'Tous',
    format_type: module.formatType || 'E-Learning', // <-- NOUVEAU
    total_assigned: module.totalAssigned || 0,
    completed_count: module.completedCount || 0,
    completed_by: module.completedBy || [],
    start_date: module.startDate,
    deadline: module.deadline
  };
  const { data, error } = await supabase.from('elearning_modules').insert([dbPayload]).select().single();
  if (error) throw error;
  return { ...module, id: data.id };
};

export const updateElearningModule = async (id: string, updates: Partial<ElearningModule>): Promise<void> => {
  const dbPayload: any = {};
  if (updates.name !== undefined) dbPayload.name = updates.name;
  if (updates.targetAudience !== undefined) dbPayload.target_audience = updates.targetAudience;
  if (updates.formatType !== undefined) dbPayload.format_type = updates.formatType; // <-- NOUVEAU
  if (updates.totalAssigned !== undefined) dbPayload.total_assigned = updates.totalAssigned;
  if (updates.completedCount !== undefined) dbPayload.completed_count = updates.completedCount;
  if (updates.completedBy !== undefined) dbPayload.completed_by = updates.completedBy;
  if (updates.startDate !== undefined) dbPayload.start_date = updates.startDate;
  if (updates.deadline !== undefined) dbPayload.deadline = updates.deadline;

  const { error } = await supabase.from('elearning_modules').update(dbPayload).eq('id', id);
  if (error) throw error;
};

export const deleteElearningModule = async (id: string): Promise<void> => {
  const { error } = await supabase.from('elearning_modules').delete().eq('id', id);
  if (error) throw error;
};