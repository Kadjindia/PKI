import React from "react";

// Imports originaux mis en commentaire temporairement pour éviter les erreurs "unused variables"
/*
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Download, Loader2, ShieldCheck, File, LayoutTemplate, Layers } from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { BitsightReport } from '@/components/reports/BitsightReport';
*/

export default function ReportsView() {

  // --- NOUVEAU RENDU (PLACEHOLDER GRISÉ) ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] mt-8 space-y-4 rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/10 p-8 text-center shadow-sm opacity-80">
      <h2 className="text-4xl md:text-5xl font-black text-muted-foreground tracking-tight">
        🚧 À venir
      </h2>
      <p className="text-lg text-muted-foreground/70 max-w-md">
        Le générateur de rapports PDF est encore en cours de développement.
      </p>
    </div>
  );

  /* =========================================================================
     ANCIEN CODE SAUVEGARDÉ EN COMMENTAIRE
     =========================================================================

  // ============================================================================
  // RÉCUPÉRATION DES DONNÉES (Identique)
  // ============================================================================
  const BITSIGHT_VECTOR_NAMES: Record<string, string> = {
    ssl_configurations: "SSL Configurations", spf: "SPF", dmarc: "DMARC", dkim: "DKIM",
    open_ports: "Open Ports", patching: "Patching", vulnerabilities: "Vulnerabilities",
    botnets: "Botnets", malware: "Malware", desktop_software: "Desktop Software",
    server_software: "Server Software", file_sharing: "File Sharing", dns: "DNS",
    ip_reputation: "IP Reputation", web_application: "Application Security",
    social_engineering: "Social Engineering", mobile_applications: "Mobile Applications",
    network_filtering: "Network Filtering", tls_ssl: "SSL/TLS"
  };

  const fetchReportBitsightData = async () => {
    const realData = {
      executive: { score: 0, maxScore: 900, trends: { d30: "N/A" }, percentile: "N/A", monitoredAssets: 0, criticalRisks: 0 },
      scorePosture: { positiveFactors: [] as any[], negativeFactors: [] as any[], categories: [] as any[] },
      priorityRisks: [] as any[],
      attackSurface: { domainsCount: 0, publicIpsCount: 0, criticalAssetsCount: 0 },
      hygiene: { ssl: { grade: "N/A", findings: 0, status: "Inconnu" }, dns: { grade: "N/A", findings: 0, status: "Inconnu" }, ports: { grade: "N/A", findings: 0, status: "Inconnu" } },
      techShadowIt: { technologies: [] as any[] }
    };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return realData;

    const call = async (path: string, params: Record<string, string> = {}) => {
      const query = new URLSearchParams({ path, ...params }).toString();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bitsight-proxy?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
      return res.json();
    };

    try {
      const ratingData = await call("");
      realData.executive.score = ratingData.current_rating || 0;
      realData.executive.monitoredAssets = ratingData.ipv4_count || 0;
      realData.executive.percentile = ratingData.rating_industry_median === "below" ? "Sous la moyenne" : "Dans la moyenne";

      if (ratingData.rating_details) {
        Object.entries(ratingData.rating_details).forEach(([key, val]: [string, any]) => {
          const name = BITSIGHT_VECTOR_NAMES[key] || key.replace(/_/g, ' ');
          const grade = val.grade || 'B';
          if (grade === 'A') realData.scorePosture.positiveFactors.push({ factor: name, impact: "Conforme" });
          else if (grade !== 'B') realData.scorePosture.negativeFactors.push({ factor: name, impact: grade });
          realData.scorePosture.categories.push({ name, key, rating: grade.charAt(0).toUpperCase() });
        });
      }
    } catch (e) {}

    try {
      const allData = await call("findings", { limit: "500" });
      if (allData.results) {
        allData.results.forEach((f: any) => {
          if (['ssl_configurations', 'tls_ssl'].includes(f.risk_vector)) realData.hygiene.ssl.findings++;
          if (['spf', 'dkim', 'dmarc', 'dns'].includes(f.risk_vector)) realData.hygiene.dns.findings++;
          if (['open_ports'].includes(f.risk_vector)) realData.hygiene.ports.findings++;
        });
      }
    } catch (e) {}

    try {
      const findingsData = await call("findings", { severity_category: "severe", limit: "50" }); // On charge jusqu'à 50 failles pour Qualys
      if (findingsData.results) {
        realData.executive.criticalRisks = findingsData.count || 0;
        realData.priorityRisks = findingsData.results.map((f: any) => ({
          risk: f.risk_vector_label || "Vulnérabilité", severity: "Critique", discoveryDate: f.first_seen || "Récemment"
        }));
      }
    } catch (e) {}

    try {
      const assetsData = await call("assets", { limit: "1000" });
      if (assetsData.results) {
        assetsData.results.forEach((a: any) => {
          if (a.is_ip || a.type === "ip") realData.attackSurface.publicIpsCount++; else realData.attackSurface.domainsCount++;
          if (String(a.importance_category) === "critical" || Number(a.importance) === 1 || (a.findings?.counts_by_severity?.severe || 0) > 0) realData.attackSurface.criticalAssetsCount++;

          if (Array.isArray(a.products)) {
            a.products.forEach((prod: any) => {
              if (prod.vendor && prod.vendor !== "unknown") {
                const risk = (prod.version?.startsWith('7.') || prod.version?.startsWith('5.') || prod.vendor === 'centos') ? "Élevé" : "Normal";
                realData.techShadowIt.technologies.push({ name: `${prod.vendor} ${prod.product || ''}`, version: prod.version || 'Inconnue', risk });
              }
            });
          }
        });
        realData.techShadowIt.technologies.sort((a: any, b: any) => (a.risk === 'Élevé' ? -1 : 1));
      }
    } catch (e) {}

    const setHyg = (target: any, keys: string[]) => {
      const cat = realData.scorePosture.categories.find((c: any) => keys.includes(c.key));
      if (cat) { target.grade = cat.rating; target.status = cat.rating === 'A' ? "Optimal" : "À vérifier"; }
    };
    setHyg(realData.hygiene.ssl, ['ssl_configurations', 'tls_ssl']);
    setHyg(realData.hygiene.dns, ['spf', 'dkim', 'dmarc', 'dns']);
    setHyg(realData.hygiene.ports, ['open_ports']);

    return realData;
  };


  // ============================================================================
  // COMPOSANT PRINCIPAL UI
  // ============================================================================
  const [reportFormat, setReportFormat] = useState<'one-pager' | 'standard' | 'qualys'>('standard');

  const [options, setOptions] = useState({
    showExecutive: true, showDecisionSupport: true, showImpactFactors: true,
    showHygiene: true, showVectors: true, showTechSurface: true,
    showShadowIt: false, showTechRisks: false
  });

  const handleFormatSelect = (format: 'one-pager' | 'standard' | 'qualys') => {
    setReportFormat(format);
    if (format === 'one-pager') {
      // 1 Page max : Synthèse extrême
      setOptions({ showExecutive: true, showDecisionSupport: true, showImpactFactors: true, showHygiene: true, showVectors: false, showTechSurface: false, showShadowIt: false, showTechRisks: false });
    } else if (format === 'standard') {
      // Équilibre
      setOptions({ showExecutive: true, showDecisionSupport: true, showImpactFactors: true, showHygiene: true, showVectors: true, showTechSurface: true, showShadowIt: false, showTechRisks: false });
    } else {
      // Qualys : On coche TOUT
      setOptions({ showExecutive: true, showDecisionSupport: true, showImpactFactors: true, showHygiene: true, showVectors: true, showTechSurface: true, showShadowIt: true, showTechRisks: true });
    }
  };

  const handleToggle = (key: keyof typeof options) => {
    setReportFormat('standard'); // Si l'utilisateur modifie à la main, on repasse en standard
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { data: bitsightData, isLoading } = useQuery({
    queryKey: ['bitsight-report-data'],
    queryFn: fetchReportBitsightData
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" /> Générateur de Rapports PDF
        </h1>
        <p className="text-muted-foreground mt-1">Choisissez un template prédéfini ou personnalisez les blocs à exporter.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* COLONNE GAUCHE (Sélection) * /}
        <div className="space-y-6">

          <div className="space-y-4">
            <h2 className="text-sm font-bold uppercase text-muted-foreground">1. Format du Livrable</h2>
            <div className="flex flex-col gap-3">

              <div onClick={() => handleFormatSelect('one-pager')} className={`p-4 rounded-xl border-2 cursor-pointer flex items-center gap-3 transition-all ${reportFormat === 'one-pager' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-secondary/20'}`}>
                <File className={`w-6 h-6 ${reportFormat === 'one-pager' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <h3 className={`font-bold ${reportFormat === 'one-pager' ? 'text-primary' : 'text-foreground'}`}>One-Pager (Comex)</h3>
                  <p className="text-xs text-muted-foreground">Synthèse exécutive sur 1 page.</p>
                </div>
              </div>

              <div onClick={() => handleFormatSelect('standard')} className={`p-4 rounded-xl border-2 cursor-pointer flex items-center gap-3 transition-all ${reportFormat === 'standard' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-secondary/20'}`}>
                <LayoutTemplate className={`w-6 h-6 ${reportFormat === 'standard' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <h3 className={`font-bold ${reportFormat === 'standard' ? 'text-primary' : 'text-foreground'}`}>Standard (Modulable)</h3>
                  <p className="text-xs text-muted-foreground">Rapport d'hygiène classique.</p>
                </div>
              </div>

              <div onClick={() => handleFormatSelect('qualys')} className={`p-4 rounded-xl border-2 cursor-pointer flex items-center gap-3 transition-all ${reportFormat === 'qualys' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-secondary/20'}`}>
                <Layers className={`w-6 h-6 ${reportFormat === 'qualys' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <h3 className={`font-bold ${reportFormat === 'qualys' ? 'text-primary' : 'text-foreground'}`}>Audit Complet (Qualys-like)</h3>
                  <p className="text-xs text-muted-foreground">Exhaustif avec page de garde.</p>
                </div>
              </div>

            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-bold uppercase text-muted-foreground">2. Source Active</h2>
            <div className="p-4 rounded-xl border-2 border-emerald-500/50 bg-emerald-500/5 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-emerald-600" />
              <div>
                <h3 className="font-bold text-emerald-800 dark:text-emerald-400">BitSight API</h3>
                <p className="text-xs text-emerald-600 dark:text-emerald-500">Connexion établie</p>
              </div>
            </div>
          </div>
        </div>

        {/* COLONNE CENTRALE (Options & Bouton) * /}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-bold uppercase text-muted-foreground">3. Personnalisation des Modules</h2>

          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex justify-between items-center">
                <span>Contenu du PDF</span>
                {reportFormat === 'qualys' && <span className="text-xs font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded">Page de garde incluse</span>}
                {reportFormat === 'one-pager' && <span className="text-xs font-bold text-orange-500 bg-orange-500/10 px-2 py-1 rounded">Format restreint 1 page</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-exec" checked={options.showExecutive} onCheckedChange={() => handleToggle('showExecutive')} />
                <label htmlFor="opt-exec" className="text-sm font-medium cursor-pointer flex-1">Résumé Exécutif</label>
              </div>

              <div className="flex items-center space-x-3 bg-blue-500/5 p-3 rounded-lg border border-blue-500/20">
                <Checkbox id="opt-dec" checked={options.showDecisionSupport} onCheckedChange={() => handleToggle('showDecisionSupport')} />
                <label htmlFor="opt-dec" className="text-sm font-medium cursor-pointer flex-1 text-blue-700 dark:text-blue-400">Plan d'action</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-imp" checked={options.showImpactFactors} onCheckedChange={() => handleToggle('showImpactFactors')} />
                <label htmlFor="opt-imp" className="text-sm font-medium cursor-pointer flex-1">Impacts (+/-)</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-hyg" checked={options.showHygiene} onCheckedChange={() => handleToggle('showHygiene')} />
                <label htmlFor="opt-hyg" className="text-sm font-medium cursor-pointer flex-1">Hygiène (SSL, DNS)</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-vec" checked={options.showVectors} onCheckedChange={() => handleToggle('showVectors')} />
                <label htmlFor="opt-vec" className="text-sm font-medium cursor-pointer flex-1">Vecteurs de Risques</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-surf" checked={options.showTechSurface} onCheckedChange={() => handleToggle('showTechSurface')} />
                <label htmlFor="opt-surf" className="text-sm font-medium cursor-pointer flex-1 text-muted-foreground">Surface d'Attaque (IPs)</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-shad" checked={options.showShadowIt} onCheckedChange={() => handleToggle('showShadowIt')} />
                <label htmlFor="opt-shad" className="text-sm font-medium cursor-pointer flex-1 text-muted-foreground">Shadow IT (Technos)</label>
              </div>

              <div className="flex items-center space-x-3 bg-secondary/10 p-3 rounded-lg border border-border/50">
                <Checkbox id="opt-risk" checked={options.showTechRisks} onCheckedChange={() => handleToggle('showTechRisks')} />
                <label htmlFor="opt-risk" className="text-sm font-medium cursor-pointer flex-1 text-muted-foreground">Vulnérabilités Critiques</label>
              </div>

            </CardContent>
          </Card>

          {/* BOUTON GÉNÉRATION * /}
          <div className="pt-4 flex justify-end">
             {isLoading ? (
               <Button disabled className="gap-2" size="lg"><Loader2 className="w-5 h-5 animate-spin" /> Connexion API...</Button>
             ) : (
               bitsightData && (
                 <PDFDownloadLink
                   document={<BitsightReport date={new Date().toLocaleDateString('fr-FR')} data={bitsightData} reportFormat={reportFormat} options={options} />}
                   fileName={`Rapport_${reportFormat.toUpperCase()}_BitSight_${new Date().toISOString().split('T')[0]}.pdf`}
                 >
                   {({ loading }) => (
                     <Button className="gap-2 px-8" size="lg" disabled={loading || !Object.values(options).some(Boolean)}>
                       {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                       {loading ? "Construction PDF..." : `Télécharger Rapport ${reportFormat === 'qualys' ? 'Complet' : 'Synthèse'}`}
                     </Button>
                   )}
                 </PDFDownloadLink>
               )
             )}
          </div>
        </div>
      </div>
    </div>
  );
  ========================================================================= */
}