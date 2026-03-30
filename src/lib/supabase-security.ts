import { supabase } from "@/integrations/supabase/client";

// --- TYPES ---
export interface Project {
  id: string;
  name: string;
  manager: string;
  riskLevel: 'faible' | 'moyen' | 'fort';
  goLiveDate: string;
  pasStatus: 'draft' | 'review' | 'validated';
}

export interface Application {
  id: string;
  name: string;
  auditType: 'pentest' | 'configuration' | 'architecture' | 'gouvernance';
  criticality: 'mineure' | 'majeure' | 'critique';
  lastAuditDate: string | null;
  auditFrequencyMonths: number;
}

export interface Vulnerability {
  id: string;
  appId: string;
  cve?: string;
  title: string;
  description: string;
  severity: 'faible' | 'moyen' | 'eleve' | 'critique';
  status: 'ouvert' | 'resolu';
}

// ==========================================
// API PROJETS (PAS)
// ==========================================
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select('*').order('go_live_date', { ascending: true });
  if (error) throw error;
  return data.map(row => ({
    id: row.id, name: row.name, manager: row.manager,
    riskLevel: row.risk_level as any, goLiveDate: row.go_live_date, pasStatus: row.pas_status as any
  }));
}

export async function createProject(project: Omit<Project, 'id'>): Promise<void> {
  const { error } = await supabase.from('projects').insert({
    name: project.name, manager: project.manager, risk_level: project.riskLevel,
    go_live_date: project.goLiveDate, pas_status: project.pasStatus
  });
  if (error) throw error;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const payload: any = {};
  if (updates.name) payload.name = updates.name;
  if (updates.manager !== undefined) payload.manager = updates.manager;
  if (updates.riskLevel) payload.risk_level = updates.riskLevel;
  if (updates.goLiveDate) payload.go_live_date = updates.goLiveDate;
  if (updates.pasStatus) payload.pas_status = updates.pasStatus;

  const { error } = await supabase.from('projects').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ==========================================
// API AUDITS (APPLICATIONS / PÉRIMÈTRES)
// ==========================================
export async function fetchApplications(): Promise<Application[]> {
  const { data, error } = await supabase.from('applications').select('*').order('name');
  if (error) throw error;
  return data.map(row => ({
    id: row.id, name: row.name, auditType: row.audit_type as any, criticality: row.criticality as any,
    lastAuditDate: row.last_audit_date, auditFrequencyMonths: row.audit_frequency_months
  }));
}

export async function createApplication(app: Omit<Application, 'id'>): Promise<void> {
  const { error } = await supabase.from('applications').insert({
    name: app.name, audit_type: app.auditType, criticality: app.criticality,
    last_audit_date: app.lastAuditDate, audit_frequency_months: app.auditFrequencyMonths
  });
  if (error) throw error;
}

export async function updateApplication(id: string, updates: Partial<Application>): Promise<void> {
  const payload: any = {};
  if (updates.name) payload.name = updates.name;
  if (updates.auditType) payload.audit_type = updates.auditType;
  if (updates.criticality) payload.criticality = updates.criticality;
  if (updates.lastAuditDate !== undefined) payload.last_audit_date = updates.lastAuditDate;
  if (updates.auditFrequencyMonths !== undefined) payload.audit_frequency_months = updates.auditFrequencyMonths;

  const { error } = await supabase.from('applications').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteApplication(id: string): Promise<void> {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw error;
}

// ==========================================
// API VULNÉRABILITÉS (CONSTATS)
// ==========================================
export async function fetchVulnerabilities(): Promise<Vulnerability[]> {
  const { data, error } = await supabase.from('vulnerabilities').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(row => ({
    id: row.id, appId: row.app_id, cve: row.cve, title: row.title,
    description: row.description, severity: row.severity as any, status: row.status as any
  }));
}

export async function createVulnerability(vuln: Omit<Vulnerability, 'id'>): Promise<void> {
  const { error } = await supabase.from('vulnerabilities').insert({
    app_id: vuln.appId, cve: vuln.cve, title: vuln.title,
    description: vuln.description, severity: vuln.severity, status: vuln.status
  });
  if (error) throw error;
}

export async function updateVulnerabilityStatus(id: string, status: 'ouvert' | 'resolu'): Promise<void> {
  const { error } = await supabase.from('vulnerabilities').update({ status }).eq('id', id);
  if (error) throw error;
}