import React from "react";

// Imports originaux mis en commentaire temporairement pour éviter les erreurs "unused variables"
/*
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import {
  Database, Users, Lock, ShieldAlert, AlertTriangle,
  UserX, FolderOpen, Activity, RefreshCw, CheckCircle, Clock
} from "lucide-react";

import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip
} from "recharts";
*/

export default function VaronisPanel() {

  // --- NOUVEAU RENDU (PLACEHOLDER GRISÉ) ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] mt-8 space-y-4 rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/10 p-8 text-center shadow-sm opacity-80">
      <h2 className="text-4xl md:text-5xl font-black text-muted-foreground tracking-tight">
        🚧 À venir
      </h2>
      <p className="text-lg text-muted-foreground/70 max-w-md">
        Le panneau Varonis est encore en cours de développement.
      </p>
    </div>
  );

  /* =========================================================================
     ANCIEN CODE SAUVEGARDÉ EN COMMENTAIRE
     =========================================================================

  // --- FONCTIONS UTILITAIRES ---
  const getRiskScoreColor = (score: number) => {
    if (score >= 80) return '#ef4444';
    if (score >= 60) return '#f97316';
    return '#10b981';
  };

  const getRiskLevelVariant = (riskLevel: string): "destructive" | "default" | "secondary" => {
    if (riskLevel === 'Critique') return 'destructive';
    if (riskLevel === 'Élevé') return 'default';
    return 'secondary';
  };

  const getSeverityColor = (severity: string) => {
    if (!severity) return 'secondary';
    const s = severity.toUpperCase();
    if (s.includes('HIGH') || s.includes('CRITICAL')) return 'destructive';
    if (s.includes('MEDIUM')) return 'default';
    return 'secondary';
  };

  // --- ÉTATS POUR LES VRAIES DONNÉES VARONIS ---
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('En attente de synchronisation...');
  const [varonisData, setVaronisData] = useState<{
    policies: any[];
    alerts: any[];
    jobId: string | null;
  }>({ policies: [], alerts: [], jobId: null });

  // --- MOCK DATA ENTERPRISE (Pour les KPIs nécessitant d'autres endpoints) ---
  const data = {
    kpis: {
      totalData: "1.8 PB",
      sensitiveDataFound: "450 TB",
      globalAccessFiles: "2.3M",
      staleData: "850 TB",
      dormantAccounts: 345
    },
    riskByDepartment: [
      { dept: "DAF (Finance)", score: 92, riskLevel: "Critique", sensitiveFiles: 145000, globalAccess: 4500 },
      { dept: "Ressources Humaines", score: 85, riskLevel: "Élevé", sensitiveFiles: 320000, globalAccess: 1200 },
      { dept: "Direction R&D", score: 65, riskLevel: "Moyen", sensitiveFiles: 85000, globalAccess: 34000 },
      { dept: "Marketing & Com", score: 40, riskLevel: "Faible", sensitiveFiles: 12000, globalAccess: 125000 },
      { dept: "DSI / IT", score: 78, riskLevel: "Élevé", sensitiveFiles: 45000, globalAccess: 800 }
    ],
    dataClassification: [
      { name: 'PII (Données Personnelles - RGPD)', value: 65, color: '#3b82f6' },
      { name: 'Données Financières (PCI-DSS)', value: 20, color: '#f97316' },
      { name: 'Propriété Intellectuelle (Secrets)', value: 10, color: '#ef4444' },
      { name: 'Données de Santé (HDS)', value: 5, color: '#10b981' }
    ],
    classificationDetails: [
      { category: "PII (RGPD)", criteria: "Noms, IBAN, Numéros de Sécu", filesCount: "1.2M", maxRiskLoc: String.raw`\\fs-corp\RH\Recrutement` },
      { category: "Financier (PCI-DSS)", criteria: "Numéros de CB, Bilans", filesCount: "350K", maxRiskLoc: String.raw`\\fs-corp\DAF\Cloture` },
      { category: "Propriété Intellectuelle", criteria: "Brevets, Code Source, Plans", filesCount: "85K", maxRiskLoc: String.raw`\\fs-corp\R&D\Projet_X` }
    ],
    excessivePermissions: [
      { path: String.raw`\\fs-corp\DAF\M&A_2026`, owner: "S. Martin (DAF)", issue: "Accessible au groupe 'Tout le monde'", sensitiveHits: 450, status: "Révocation Auto." },
      { path: String.raw`\\fs-corp\RH\Evaluations_2025`, owner: "L. Bernard (DRH)", issue: "Héritage cassé + Droits directs", sensitiveHits: 3200, status: "En attente Data Owner" },
      { path: String.raw`\\fs-corp\IT\Passwords_Backup`, owner: "Orphelin (Sans Prop.)", issue: "Dossier partagé publiquement", sensitiveHits: 15, status: "Révocation Immédiate" },
      { path: String.raw`\\fs-corp\Direction\Board_Minutes`, owner: "M. Dupont (PDG)", issue: "Accessible au groupe 'Utilisateurs du domaine'", sensitiveHits: 125, status: "Corrigé" }
    ],
    identityGovernance: [
      { metric: "Comptes utilisateurs dormants (> 90 jours)", value: 345, risk: "Désactivation automatique recommandée" },
      { metric: "Mots de passe qui n'expirent jamais", value: 12, risk: "Violation politique de sécurité" },
      { metric: "Comptes à privilèges (Admin) inactifs", value: 4, risk: "Risque de compromission critique" },
      { metric: "Groupes de sécurité vides ou sans owner", value: 142, risk: "Dette technique AD" }
    ]
  };

  // --- FONCTION DE SYNCHRONISATION ET DE POLLING ---
  const fetchRealAlerts = async () => {
    setIsRefreshing(true);
    setSyncStatus('Initialisation de la connexion...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non connecté à Supabase");

      const varonisProxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/varonis-proxy?path=/api/graphql`;
      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      };

      const callVaronis = async (query: string, variables?: Record<string, unknown>) => {
        const res = await fetch(varonisProxyUrl, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
        const json = await res.json();
        if (json.errors) throw new Error(json.errors[0].message);
        return json.data;
      };

      // 1. Dictionnaire des menaces
      setSyncStatus('Récupération du dictionnaire des menaces...');
      const metaData = await callVaronis(`
        query { threatDetectionPolicies { id name } }
      `);

      // 2. Introspection ultra-stricte
      setSyncStatus('Analyse du schéma de l\\'API...');
      const schemaData = await callVaronis(`
        query {
          __type(name: "Alert") {
            fields { name type { kind ofType { kind } } args { name } }
          }
        }
      `);

      const alertFields = schemaData?.__type?.fields || [];
      const simpleFields = alertFields
        .filter((f: any) => {
          const k = f.type?.kind;
          const ok = f.type?.ofType?.kind;
          return (k === 'SCALAR' || k === 'ENUM' || ok === 'SCALAR' || ok === 'ENUM') && (!f.args || f.args.length === 0);
        })
        .map((f: any) => f.name)
        .filter((name: string) => ['id', 'status', 'severity', 'alertDescription'].includes(name));

      if (simpleFields.length === 0) simpleFields.push('id'); // Fallback absolu

      const workingWhere = { status: { in: ["NEW", "UNDER_INVESTIGATION", "ESCALATED"] } };

      // 3. Initialisation du Job d'alertes (AVEC le champ results obligatoirement !)
      setSyncStatus('Génération du Job d\\'extraction...');
      const initData = await callVaronis(`
        query GetAlerts($where: Alert_FilterInput!) {
          alertsAsync(where: $where) {
            jobId
            results { id }
          }
        }
      `, { where: workingWhere });

      const generatedJobId = initData?.alertsAsync?.jobId;
      if (!generatedJobId) throw new Error("Varonis n'a pas renvoyé de jobId.");

      setVaronisData(prev => ({ ...prev, jobId: generatedJobId, policies: metaData.threatDetectionPolicies || [] }));
      setSyncStatus(`Job ${generatedJobId.split('-')[0]} en cours d'analyse...`);

      // 4. Boucle de Polling
      let isCompleted = false;
      let attempts = 0;
      let finalAlerts: any[] = [];

      while (!isCompleted && attempts < 8) {
        await new Promise(r => setTimeout(r, 4000)); // Pause de 4s
        attempts++;
        setSyncStatus(`Vérification des résultats (Tentative ${attempts}/8)...`);

        const pollData = await callVaronis(`
          query PollAlerts($where: Alert_FilterInput!) {
            alertsAsync(where: $where) {
              jobId
              results {
                ${simpleFields.join('\\n                ')}
              }
            }
          }
        `, { where: workingWhere });

        const results = pollData?.alertsAsync?.results;

        // Si l'API renvoie des résultats, c'est terminé.
        if (results !== null && results !== undefined) {
          isCompleted = true;
          finalAlerts = results;
        }
      }

      if (!isCompleted) {
        setSyncStatus("⚠️ Délai d'attente dépassé, mais le job tourne toujours côté Varonis.");
      } else {
        setSyncStatus(`✅ ${finalAlerts.length} alertes récupérées avec succès.`);
        setVaronisData(prev => ({ ...prev, alerts: finalAlerts }));
      }

    } catch (error: any) {
      console.error("❌ Échec :", error);
      setSyncStatus(`Erreur : ${error.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRealAlerts();
  }, []);

  return (
    <div className="space-y-6">

      {/* --- EN-TÊTE DU PANNEAU --- * /}
      <div className="flex justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-blue-600" /> Varonis Data Security Platform
          </h2>
          <p className="text-xs text-muted-foreground">{syncStatus}</p>
        </div>
        <div className="flex items-center gap-3">
          {varonisData.policies.length > 0 && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
              <CheckCircle className="w-3 h-3" /> API Connectée
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={fetchRealAlerts} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Actualisation...' : 'Actualiser'}
          </Button>
        </div>
      </div>

      {/* ==============================================================================
          1. BANDEAU SUPÉRIEUR (KPIs)
          ============================================================================== * /}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">

        <Card className="border-l-4 border-l-purple-500 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Données Scannées</CardTitle>
            <Database className="w-5 h-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-foreground">{data.kpis.totalData.split(' ')[0]}</span>
              <span className="text-sm text-muted-foreground font-medium">PB</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Dette data: {data.kpis.staleData} non consultés (&gt; 1an)</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Sur-exposition : "Global Access"</CardTitle>
            <FolderOpen className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{data.kpis.globalAccessFiles}</span>
              <span className="text-sm text-muted-foreground font-medium">Fichiers</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Données accessibles au groupe "Tout le monde" (Everyone).</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Comptes Fantômes</CardTitle>
            <UserX className="w-5 h-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-orange-500">{data.kpis.dormantAccounts}</span>
              <span className="text-sm text-muted-foreground font-medium">Dormants</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Comptes inactifs avec accès préservés.</p>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-destructive bg-card shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Alertes (Temps Réel)</CardTitle>
            <ShieldAlert className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-destructive">{varonisData.alerts.length || 0}</span>
              <span className="text-xs text-muted-foreground font-medium">Actives</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Statuts NEW / INVESTIGATION</p>
          </CardContent>
        </Card>

      </div>

      {/* ==============================================================================
          2. EXPOSITION PAR DÉPARTEMENT
          ============================================================================== * /}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" /> 1. Score de Risque et Exposition par Département
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4 text-center">Score de Risque Data par Direction (0-100)</h4>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.riskByDepartment} layout="vertical" margin={{ top: 10, right: 30, left: 30, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#333" opacity={0.2} />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="dept" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} width={120} />
                    <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="score" name="Score de Risque" radius={[0, 4, 4, 0]}>
                      {data.riskByDepartment.map((entry) => (
                        <Cell key={entry.dept} fill={getRiskScoreColor(entry.score)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="overflow-hidden flex flex-col justify-center">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/5">
                    <TableHead>Département / B.U.</TableHead>
                    <TableHead>Niveau</TableHead>
                    <TableHead>Fichiers Sensibles</TableHead>
                    <TableHead>Fichiers Global Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.riskByDepartment.map((r) => (
                    <TableRow key={r.dept}>
                      <TableCell className="font-bold text-sm">{r.dept}</TableCell>
                      <TableCell>
                        <Badge variant={getRiskLevelVariant(r.riskLevel)}>
                          {r.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.sensitiveFiles.toLocaleString()}</TableCell>
                      <TableCell className={`font-mono text-xs font-bold ${r.globalAccess > 10000 ? 'text-destructive' : 'text-orange-500'}`}>
                        {r.globalAccess.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ==============================================================================
          3. CLASSIFICATION DES DONNÉES
          ============================================================================== * /}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Lock className="w-5 h-5 text-emerald-500" /> 2. Classification Automatique
          </CardTitle>
          <Badge variant="outline" className="border-emerald-500 text-emerald-500">{data.kpis.sensitiveDataFound} de données sensibles identifiées</Badge>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-2 border-r border-border pr-4">
              <h4 className="text-xs font-bold text-muted-foreground uppercase text-center">Répartition des types de données</h4>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.dataClassification} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">
                      {data.dataClassification.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {data.dataClassification.map((c) => (
                  <div key={c.name} className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full" style={{backgroundColor: c.color}}></span>{c.name.split(' ')[0]}</div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-2 overflow-hidden flex flex-col justify-center">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/5">
                    <TableHead>Catégorie de Classification</TableHead>
                    <TableHead>Critères de détection</TableHead>
                    <TableHead>Volume Trouvé</TableHead>
                    <TableHead>Dossier le plus à risque (Top 1)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.classificationDetails.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-bold text-sm">{c.category}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.criteria}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{c.filesCount}</TableCell>
                      <TableCell className="font-mono text-xs text-blue-500 truncate max-w-[200px]">{c.maxRiskLoc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ==============================================================================
          ACCORDÉONS TECHNIQUES
          ============================================================================== * /}
      <Accordion type="multiple" defaultValue={["item-alerts"]} className="w-full space-y-4">

        {/* --- VRAIES ALERTES --- * /}
        <AccordionItem value="item-alerts" className="border border-destructive/30 rounded-2xl bg-card overflow-hidden shadow-sm">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-destructive/5">
            <div className="flex items-center gap-3 text-base font-bold text-destructive">
              <AlertTriangle className="w-5 h-5" /> 3. Flux d'Alertes en Temps Réel (Données de Prod)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <div className="p-4 bg-muted/30 border-b border-border flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Alertes remontées avec le statut NEW, UNDER_INVESTIGATION ou ESCALATED.</span>
              {varonisData.jobId && (
                <Badge variant="outline" className="font-mono bg-white flex items-center gap-1">
                  {isRefreshing ? <Clock className="w-3 h-3 animate-spin"/> : <CheckCircle className="w-3 h-3 text-emerald-500"/>}
                  Ticket API : {varonisData.jobId.split('-')[0]}
                </Badge>
              )}
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary/5 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="pl-6 w-24">ID Alerte</TableHead>
                    <TableHead>Horodatage</TableHead>
                    <TableHead>Sévérité</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Détails bruts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isRefreshing && varonisData.alerts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        <Activity className="w-8 h-8 mx-auto mb-3 animate-pulse text-blue-300" />
                        Interrogation de Varonis en cours...
                      </TableCell>
                    </TableRow>
                  ) : varonisData.alerts.length > 0 ? (
                    varonisData.alerts.map((alert: any, idx: number) => (
                      <TableRow key={alert.id || idx}>
                        <TableCell className="pl-6 font-mono text-xs text-muted-foreground">{alert.id}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          {alert.generationTime ? new Date(alert.generationTime).toLocaleString() : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getSeverityColor(alert.severity || '')}>
                            {alert.severity || 'Inconnu'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{alert.status || 'NEW'}</Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate" title={JSON.stringify(alert)}>
                          {Object.entries(alert)
                            .filter(([k]) => !['id', 'generationTime', 'severity', 'status'].includes(k))
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' | ')}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        <CheckCircle className="w-8 h-8 mx-auto mb-3 text-emerald-400 opacity-50" />
                        Aucune nouvelle alerte à traiter sur Varonis.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* --- PERMISSIONS EXCESSIVES (MOCK) --- * /}
        <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <FolderOpen className="w-5 h-5 text-orange-500" /> 4. Cartographie des Permissions Excessives
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Chemin du Répertoire / Fichier</TableHead>
                  <TableHead>Data Owner (Propriétaire)</TableHead>
                  <TableHead>Problème d'Habilitation</TableHead>
                  <TableHead>Hits Sensibles (PII)</TableHead>
                  <TableHead>Action / Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.excessivePermissions.map((p) => (
                  <TableRow key={p.path}>
                    <TableCell className="pl-6 font-mono text-xs font-bold text-foreground">{p.path}</TableCell>
                    <TableCell className="text-sm font-medium">{p.owner}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.issue}</TableCell>
                    <TableCell className={p.sensitiveHits > 100 ? "text-destructive font-black text-lg" : "text-muted-foreground"}>{p.sensitiveHits}</TableCell>
                    <TableCell>
                      <Badge variant={p.status.includes('Attente') ? 'secondary' : 'default'} className={p.status.includes('Révocation') ? 'bg-emerald-500' : ''}>
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* --- POLITIQUES DE MENACES REELLES --- * /}
        <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <Lock className="w-5 h-5 text-emerald-500" /> 5. Règles de Détection Varonis (Données Réelles API)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <div className="p-4 bg-muted/30 border-b border-border flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Liste des politiques de menaces comportementales (UEBA) actuellement actives sur votre instance.</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary/5 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="pl-6 w-20">ID</TableHead>
                    <TableHead>Nom de la Politique de Sécurité</TableHead>
                    <TableHead className="w-32 text-right pr-6">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {varonisData.policies.length > 0 ? (
                    varonisData.policies.slice(0, 50).map((policy) => (
                      <TableRow key={policy.id}>
                        <TableCell className="pl-6 font-mono text-xs text-muted-foreground">#{policy.id}</TableCell>
                        <TableCell className="font-semibold text-sm text-foreground">{policy.name}</TableCell>
                        <TableCell className="text-right pr-6">
                           <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">Active</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        {isRefreshing ? "Synchronisation en cours..." : "Aucune donnée récupérée. Cliquez sur Actualiser."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {varonisData.policies.length > 50 && (
              <div className="p-3 text-center bg-secondary/5 border-t border-border text-xs text-muted-foreground">
                + {varonisData.policies.length - 50} autres règles chargées en mémoire.
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* --- GOUVERNANCE (MOCK) --- * /}
        <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
          <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
            <div className="flex items-center gap-3 text-base font-bold">
              <Users className="w-5 h-5 text-blue-500" /> 6. Gouvernance des Identités (Active Directory & Entra ID)
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/5">
                  <TableHead className="pl-6">Indicateur de Santé AD</TableHead>
                  <TableHead>Volume Identifié</TableHead>
                  <TableHead>Impact Risque & Remédiation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.identityGovernance.map((g) => (
                  <TableRow key={g.metric}>
                    <TableCell className="pl-6 font-bold text-sm text-foreground">{g.metric}</TableCell>
                    <TableCell className="font-black text-xl text-orange-500">{g.value}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.risk}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

      </Accordion>
    </div>
  );
  ========================================================================= */
}