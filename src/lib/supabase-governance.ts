import { supabase } from "@/integrations/supabase/client";

// --- TYPES ---
export interface Policy {
  id: string;
  name: string;
  lastReviewDate: string | null;
  reviewFrequencyMonths: number;
  complianceScore: number;
  status: 'ok' | 'warning' | 'expired' | 'draft';
  owner?: string;
  gapsCount?: number; // Calculé à la volée
}

export interface PolicyGap {
  id: string;
  policyId: string;
  description: string;
  severity: 'faible' | 'moyen' | 'eleve' | 'critique';
  status: 'ouvert' | 'en_cours' | 'resolu';
  dueDate?: string;
}

// --- LECTURE ---
export async function fetchPolicies(): Promise<Policy[]> {
  const { data, error } = await supabase
    .from('policies')
    .select(`
      *,
      policy_gaps (count)
    `)
    .order('name');

  if (error) throw error;

  return data.map(row => ({
    id: row.id,
    name: row.name,
    lastReviewDate: row.last_review_date,
    reviewFrequencyMonths: row.review_frequency_months,
    complianceScore: row.compliance_score,
    status: row.status,
    owner: row.owner,
    // Supabase renvoie le count dans un tableau pour les jointures
    gapsCount: row.policy_gaps[0]?.count || 0
  }));
}

// --- ÉCRITURE (Le cœur de la dynamique) ---
export async function createPolicy(policy: Partial<Policy>): Promise<void> {
  const { error } = await supabase.from('policies').insert({
    name: policy.name,
    last_review_date: policy.lastReviewDate,
    review_frequency_months: policy.reviewFrequencyMonths || 24,
    status: policy.status || 'ok'
  });
  if (error) throw error;
}

export async function updatePolicy(id: string, updates: Partial<Policy>): Promise<void> {
  const payload: any = {};
  if (updates.name) payload.name = updates.name;
  if (updates.lastReviewDate !== undefined) payload.last_review_date = updates.lastReviewDate;
  if (updates.complianceScore !== undefined) payload.compliance_score = updates.complianceScore;
  if (updates.status) payload.status = updates.status;

  const { error } = await supabase.from('policies').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deletePolicy(id: string): Promise<void> {
  const { error } = await supabase.from('policies').delete().eq('id', id);
  if (error) throw error;
}

// --- ÉCARTS (PLANS D'ACTION) ---

export async function fetchGaps(): Promise<PolicyGap[]> {
  const { data, error } = await supabase
    .from('policy_gaps')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map(row => ({
    id: row.id,
    policyId: row.policy_id,
    description: row.description,
    severity: row.severity as any,
    status: row.status as any,
    dueDate: row.due_date || undefined
  }));
}

export async function createGap(gap: Omit<PolicyGap, 'id'>): Promise<void> {
  const { error } = await supabase.from('policy_gaps').insert({
    policy_id: gap.policyId,
    description: gap.description,
    severity: gap.severity,
    status: gap.status,
    due_date: gap.dueDate || null
  });
  if (error) throw error;
}

export async function updateGapStatus(id: string, status: 'ouvert' | 'en_cours' | 'resolu'): Promise<void> {
  const { error } = await supabase.from('policy_gaps').update({ status }).eq('id', id);
  if (error) throw error;
}