import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Globe, TrendingUp, TrendingDown, CheckCircle2, ShieldCheck,
  Activity, ArrowUpRight, ArrowDownRight, AlertOctagon,
  ShieldAlert, Lock, Cpu, BarChart, Wrench, X, Info, Server
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart as RechartsBarChart, Bar,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend
} from "recharts";

    // Dictionnaire officiel et complet des libellés de vecteurs de risque BitSight
    const BITSIGHT_VECTOR_NAMES: Record<string, string> = {
      ssl_configurations: "SSL Configurations",
      spf: "SPF",
      dmarc: "DMARC",
      dkim: "DKIM",
      open_ports: "Open Ports",
      patching: "Patching",
      vulnerabilities: "Vulnerabilities",
      botnets: "Botnets",
      malware: "Malware",
      desktop_software: "Desktop Software",
      server_software: "Server Software",
      file_sharing: "File Sharing",
      dns: "DNS",
      ip_reputation: "IP Reputation",
      web_application: "Application Security",
      social_engineering: "Social Engineering",
      mobile_applications: "Mobile Applications",
      network_filtering: "Network Filtering",
      tls_ssl: "SSL/TLS"
    };

    // 1. LA FONCTION D'APPEL API
    const fetchBitsightDetails = async () => {
      const token = import.meta.env.VITE_BITSIGHT_TOKEN;
      const guid = import.meta.env.VITE_BITSIGHT_COMPANY_GUID;

      const realData = {
        executive: {
          score: 0, maxScore: 900, trends: { d7: "N/A", d30: "N/A", d90: "N/A" },
          industryName: "N/A", percentile: "N/A", monitoredAssets: 0,
          newAssets: 0, totalFindings: 0, criticalRisks: 0
        },
        scorePosture: {
          historical: [] as any[],
          positiveFactors: [] as any[],
          negativeFactors: [] as any[],
          categories: [] as any[]
        },
        priorityRisks: [] as any[],
        attackSurface: {
          totalExposed: 0,
          newAssetsCount: 0,
          domainsCount: 0,
          subdomainsCount: 0,
          publicIpsCount: 0,
          criticalAssetsCount: 0,
          riskDistribution: [] as any[],
          topTechnologies: [] as any[],
          exposedServicesCount: 0,
          technologiesCount: 0,
          riskyAssets: [] as any[]
        },

        findings: {
          kpis: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
          severityDistribution: [], categoryDistribution: [], agingData: [], list: [] as any[]
        },
        hygiene: {
          sslTls: { expiredCerts: 0, expiringSoon: 0, weakProtocols: 0, score: 0 },
          dns: { dmarcPolicy: "N/A", score: 0 },
          services: { openPortsCount: 0, criticalServicesExposed: 0, score: 0 }
        },
        techShadowIt: { technologies: [], shadowIt: [] },
        benchmark: { radarData: [] },
        historyRecommendations: { timeline: [], actions: [] }
      };

      if (!token || !guid) {
        console.warn("⚠️ Token ou GUID manquant. Affichage du squelette vide.");
        return realData;
      }

      const credentials = btoa(`${token}:`);
      const headers = {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json'
      };

      // --- APPEL 1 : SCORE, TENDANCES, BENCHMARK & POSTURE ---
      try {
        const ratingResponse = await fetch(`/api/bitsight/ratings/v1/companies/${guid}`, { headers });
        if (ratingResponse.ok) {
          const ratingData = await ratingResponse.json();
          console.log("=== VRAIES DONNÉES SCORE (RATING) ===", ratingData);

          realData.executive.score = ratingData.current_rating || 0;
          realData.executive.industryName = ratingData.industry || "Secteur inconnu";

          if (ratingData.rating_industry_median === "below") realData.executive.percentile = "Sous la moyenne";
          else if (ratingData.rating_industry_median === "above") realData.executive.percentile = "Au-dessus";
          else realData.executive.percentile = "Dans la moyenne";

          realData.attackSurface.publicIpsCount = ratingData.ipv4_count || 0;
          realData.executive.monitoredAssets = ratingData.ipv4_count || 0;

          if (ratingData.rating_details && typeof ratingData.rating_details === 'object') {
            const categoriesList: any[] = [];
            const positiveList: any[] = [];
            const negativeList: any[] = [];

            Object.entries(ratingData.rating_details).forEach(([key, val]: [string, any]) => {
              const officialName = BITSIGHT_VECTOR_NAMES[key] || key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              const grade = val.grade || 'B';

              let progressScore = 70;
              if (grade === 'A' || grade === 'GOOD') {
                progressScore = 95;
                positiveList.push({ factor: officialName, impact: "Conforme (A)" });
              } else if (grade === 'B' || grade === 'WARN') {
                progressScore = 70;
              } else {
                progressScore = 40;
                negativeList.push({ factor: officialName, impact: `Risque (${grade})` });
              }

              categoriesList.push({
                name: officialName,
                score: progressScore,
                rating: grade.charAt(0).toUpperCase()
              });
            });

            realData.scorePosture.categories = categoriesList;
            realData.scorePosture.positiveFactors = positiveList.slice(0, 3);
            realData.scorePosture.negativeFactors = negativeList.slice(0, 3);
          }

          if (Array.isArray(ratingData.ratings) && ratingData.ratings.length > 0) {
            const sortedRatings = [...ratingData.ratings].sort((a: any, b: any) => a.rating_date.localeCompare(b.rating_date));
            const currentScore = realData.executive.score;

            const getRatingDaysAgo = (days: number) => {
              if (sortedRatings.length === 0) return null;
              const latestEntry = sortedRatings[sortedRatings.length - 1];
              const latestDate = new Date(latestEntry.rating_date);

              const targetDate = new Date(latestDate);
              targetDate.setDate(targetDate.getDate() - days);
              const targetStr = targetDate.toISOString().split('T')[0];

              let match = sortedRatings.find(r => r.rating_date === targetStr);
              if (!match) {
                const targetIdx = sortedRatings.length - 1 - days;
                if (targetIdx >= 0) match = sortedRatings[targetIdx];
              }
              return match ? match.rating : null;
            };

            const formatDiff = (pastScore: number | null) => {
              if (pastScore === null) return "N/A";
              const diff = currentScore - pastScore;
              if (diff === 0) return "0";
              return diff > 0 ? `+${diff}` : `${diff}`;
            };

            realData.executive.trends = {
              d7: formatDiff(getRatingDaysAgo(7)),
              d30: formatDiff(getRatingDaysAgo(30)),
              d90: formatDiff(getRatingDaysAgo(90))
            };

            const monthlyMap = new Map();
            sortedRatings.forEach((r: any) => {
              if (r.rating_date) {
                const monthKey = r.rating_date.substring(0, 7);
                monthlyMap.set(monthKey, r.rating);
              }
            });

            realData.scorePosture.historical = Array.from(monthlyMap.entries()).map(([monthKey, score]) => {
              const [year, month] = monthKey.split('-');
              const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
              const formattedLabel = dateObj.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
              return {
                month: formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1),
                score: score,
                industry: null,
                topPeers: null
              };
            });
          }
        }
      } catch (error) {
        console.error("Crash réseau sur le Score :", error);
      }

      // --- APPEL 2BIS : TOTAL GLOBAL DES FAILLES ---
      try {
        const allFindingsResponse = await fetch(`/api/bitsight/ratings/v1/companies/${guid}/findings?limit=1`, { headers });
        if (allFindingsResponse.ok) {
          const allData = await allFindingsResponse.json();
          console.log("=== TOTAL FINDINGS GLOBAL ===", allData.count);
          realData.executive.totalFindings = allData.count || 0;
          realData.findings.kpis.total = allData.count || 0;
        }
      } catch (error) {
        console.error("Erreur total findings", error);
      }

      // --- APPEL 2 : FAILLES SÉVÈRES (AVEC DÉTAILS DE REMÉDIATION) ---
      try {
        const findingsResponse = await fetch(`/api/bitsight/ratings/v1/companies/${guid}/findings?severity_category=severe&limit=10`, { headers });
        if (findingsResponse.ok) {
          const findingsData = await findingsResponse.json();
          console.log("=== VRAIES DONNÉES FAILLES SÉVÈRES ===", findingsData);

          if (findingsData && Array.isArray(findingsData.results)) {
            realData.executive.criticalRisks = findingsData.count || 0;

            const safeRisks = findingsData.results.map((finding: any, index: number) => {
              const riskName = finding.risk_vector_label || "Vulnérabilité critique";

              let assetList = "Actif inconnu";
              if (Array.isArray(finding.assets) && finding.assets.length > 0) {
                assetList = finding.assets.map((a: any) => a.asset).filter(Boolean).join(", ");
              }

              const remediations = finding.details?.remediations || [];
              const observedIps = finding.details?.observed_ips || [];
              const rawScore = finding.severity || 'N/A';

              return {
                id: `RSK-${index + 1}`,
                risk: riskName,
                severity: "Critique",
                impactScore: `Sévérité ${rawScore}`,
                assets: assetList,
                discoveryDate: finding.first_seen || "Récemment",
                lastSeen: finding.last_seen || "Récemment",
                status: "Ouvert",
                details: {
                  remediations: remediations,
                  ips: observedIps,
                  evidence: finding.evidence_key || assetList
                }
              };
            });

            realData.priorityRisks = safeRisks;
          }
        }
      } catch (error) {
        console.error("Crash réseau sur les Failles Sévères :", error);
      }

    // --- APPEL 3 : INVENTAIRE ET SURFACE D'ATTAQUE ---
      try {
        // Note : On pourrait monter la limite à 50 ou 100 si l'API le permet pour avoir des stats plus globales
        const assetsResponse = await fetch(`/api/bitsight/ratings/v1/companies/${guid}/assets?limit=50`, { headers });
        if (assetsResponse.ok) {
          const assetsData = await assetsResponse.json();

          if (assetsData && typeof assetsData.count === 'number') {
            realData.executive.monitoredAssets = assetsData.count;

            const ipCount = realData.attackSurface.publicIpsCount;
            const domainCount = assetsData.count > ipCount ? assetsData.count - ipCount : 0;
            realData.attackSurface.domainsCount = domainCount;
            realData.attackSurface.subdomainsCount = 0;
          }

          if (assetsData && Array.isArray(assetsData.results)) {
            const riskCounts = { Critique: 0, Élevé: 0, Moyen: 0, Faible: 0 };
            const techCounts: Record<string, number> = {};
            let criticalCount = 0;

            realData.attackSurface.riskyAssets = assetsData.results.map((asset: any) => {
              // 1. Gestion de la Criticité
              let riskLabel = "Normal";
              if (asset.importance_category === "critical") { riskLabel = "Critique"; criticalCount++; riskCounts.Critique++; }
              else if (asset.importance_category === "high") { riskLabel = "Élevé"; riskCounts.Élevé++; }
              else if (asset.importance_category === "medium") { riskLabel = "Moyen"; riskCounts.Moyen++; }
              else if (asset.importance_category === "low") { riskLabel = "Faible"; riskCounts.Faible++; }

              let typeLabel = "Inconnu";
              if (asset.asset_type === "IP" || asset.is_ip === true) typeLabel = "IP Publique";
              else if (asset.asset_type === "Domain") typeLabel = "Domaine";

              // 2. Extraction des Technologies (Products)
              if (Array.isArray(asset.products)) {
                asset.products.forEach((prod: any) => {
                  if (prod.vendor && prod.vendor !== "unknown") {
                    // Majuscule sur la première lettre du vendor (ex: cloudflare -> Cloudflare)
                    const vendorName = prod.vendor.charAt(0).toUpperCase() + prod.vendor.slice(1);
                    techCounts[vendorName] = (techCounts[vendorName] || 0) + 1;
                  }
                });
              }

              return {
                asset: asset.asset || "Actif sans nom",
                type: typeLabel,
                riskLevel: riskLabel,
                findings: asset.findings?.total_count || 0,
                // On peut garder quelques technos pour le tableau
                technologies: Array.isArray(asset.products) ? asset.products.map((p:any) => p.vendor).filter(Boolean).slice(0, 2).join(', ') : ""
              };
            });

            // 3. Alimentation des données pour l'UI
            realData.attackSurface.criticalAssetsCount = criticalCount;

            // Préparation des données du graphique Donut (Criticité)
            realData.attackSurface.riskDistribution = [
              { name: 'Critique', value: riskCounts.Critique, color: '#ef4444' }, // destructive
              { name: 'Élevé', value: riskCounts.Élevé, color: '#f97316' },       // orange
              { name: 'Moyen', value: riskCounts.Moyen, color: '#eab308' },       // yellow
              { name: 'Faible', value: riskCounts.Faible, color: '#22c55e' }      // green
            ].filter(item => item.value > 0);

            // Préparation des données du graphique Barres (Technologies Top 5)
            realData.attackSurface.topTechnologies = Object.entries(techCounts)
              .map(([name, count]) => ({ name, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5); // On garde le Top 5
          }
        }
      } catch (error) {
        console.error("Crash réseau sur la Surface d'Attaque :", error);
      }

      return realData;
    };

    // 2. COMPOSANT PRINCIPAL
    export default function BitsightPanel() {
      const { data, isLoading } = useQuery({
        queryKey: ['bitsight-real-data-only-v22'], // Clé v22
        queryFn: fetchBitsightDetails,
        refetchInterval: 1000 * 60 * 15,
      });

      const [selectedRisk, setSelectedRisk] = useState<any>(null);

      if (isLoading || !data) {
        return (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <Globe className="w-10 h-10 text-emerald-500 animate-spin opacity-50" />
            <p className="text-muted-foreground font-medium animate-pulse">Extraction des données brutes depuis BitSight...</p>
          </div>
        );
      }

      const getTrendStyle = (trend: string) => {
        if (trend.startsWith('+')) return { color: "text-emerald-500", bg: "bg-emerald-500/10", Icon: TrendingUp };
        if (trend.startsWith('-')) return { color: "text-destructive", bg: "bg-destructive/10", Icon: TrendingDown };
        return { color: "text-slate-500", bg: "bg-slate-500/10", Icon: Activity };
      };

      const d7Style = getTrendStyle(data.executive.trends.d7);
      const d30Style = getTrendStyle(data.executive.trends.d30);
      const d90Style = getTrendStyle(data.executive.trends.d90);

      let scoreBorder = "border-l-emerald-500";
      if (data.executive.score < 600) scoreBorder = "border-l-destructive";
      else if (data.executive.score < 700) scoreBorder = "border-l-orange-500";

      return (
        <div className="space-y-6 relative">

          {/* OVERLAY POP-UP LATÉRAL (DÉTAILS DU RISQUE) */}
          {selectedRisk && (
            <div className="fixed inset-0 z-50 flex justify-end bg-background/50 backdrop-blur-sm transition-opacity">
              <div className="w-full max-w-lg bg-card h-full shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right duration-300">

                <div className="flex items-start justify-between p-6 border-b border-border bg-secondary/20">
                  <div>
                    <Badge variant="destructive" className="mb-3 font-bold uppercase">{selectedRisk.impactScore}</Badge>
                    <h3 className="text-xl font-black flex items-center gap-2 text-foreground">
                      <AlertOctagon className="w-6 h-6 text-destructive" />
                      {selectedRisk.risk}
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono mt-2">{selectedRisk.id}</p>
                  </div>
                  <button onClick={() => setSelectedRisk(null)} className="p-2 bg-background border border-border hover:bg-secondary rounded-full transition-colors">
                    <X className="w-5 h-5 text-foreground" />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6 flex-1">

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Première découverte</span>
                      <p className="text-sm font-medium">{selectedRisk.discoveryDate}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Dernière vue</span>
                      <p className="text-sm font-medium">{selectedRisk.lastSeen}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-blue-500"/> Preuve d'exposition</h4>
                    <div className="p-3 bg-secondary/30 rounded-lg border border-border font-mono text-sm text-foreground break-all">
                      {selectedRisk.details.evidence}
                    </div>
                  </div>

                  {selectedRisk.details.ips && selectedRisk.details.ips.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold flex items-center gap-2"><Server className="w-4 h-4 text-purple-500"/> IPs Observées</h4>
                      <div className="p-3 bg-secondary/30 rounded-lg border border-border flex flex-wrap gap-2">
                        {selectedRisk.details.ips.map((ip: string, i: number) => (
                          <Badge key={i} variant="outline" className="font-mono bg-background">{ip}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 pt-4 border-t border-border">
                    <h4 className="text-sm font-bold flex items-center gap-2"><Info className="w-4 h-4 text-emerald-500"/> Pistes de Remédiation</h4>
                    {selectedRisk.details.remediations && selectedRisk.details.remediations.length > 0 ? (
                      <div className="space-y-3">
                        {selectedRisk.details.remediations.map((rem: any, idx: number) => (
                          <div key={idx} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                            <strong className="text-sm text-foreground block">{rem.message}</strong>
                            {rem.help_text && <p className="text-xs text-muted-foreground">{rem.help_text}</p>}
                            {rem.remediation_tip && (
                              <div className="text-xs text-blue-500 font-medium underline-offset-4 hover:underline mt-2"
                                   dangerouslySetInnerHTML={{ __html: rem.remediation_tip }} />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic p-4 bg-secondary/20 rounded-lg border border-border">
                        Aucune recommandation automatique fournie par l'API pour ce risque spécifique. Rapprochez-vous de l'équipe infrastructure.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 1. Bandeau Exécutif */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <Card className={`lg:col-span-2 border-l-4 ${scoreBorder} bg-card shadow-sm flex flex-col justify-between`}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">BitSight Rating</CardTitle>
                <ShieldCheck className={`w-5 h-5 ${data.executive.score >= 700 ? 'text-emerald-500' : data.executive.score >= 600 ? 'text-orange-500' : 'text-destructive'}`} />
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tight text-foreground">{data.executive.score}</span>
                  <span className="text-sm text-muted-foreground font-medium">/ {data.executive.maxScore}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge className={`${d30Style.bg} ${d30Style.color} font-bold border-none`}>
                    <d30Style.Icon className="w-3.5 h-3.5 mr-1" /> {data.executive.trends.d30} {data.executive.trends.d30 !== "N/A" && data.executive.trends.d30 !== "0" ? "pts (30j)" : ""}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tendance</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span>7 jours:</span>
                  <span className={`font-bold flex items-center gap-1 ${d7Style.color}`}><d7Style.Icon className="w-3 h-3" /> {data.executive.trends.d7}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>30 jours:</span>
                  <span className={`font-bold flex items-center gap-1 ${d30Style.color}`}><d30Style.Icon className="w-3 h-3" /> {data.executive.trends.d30}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>90 jours:</span>
                  <span className={`font-bold flex items-center gap-1 ${d90Style.color}`}><d90Style.Icon className="w-3 h-3" /> {data.executive.trends.d90}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Benchmark</CardTitle></CardHeader>
              <CardContent>
                <div className={`text-2xl font-black ${data.executive.percentile === 'Sous la moyenne' ? 'text-orange-500' : 'text-blue-500'}`}>{data.executive.percentile}</div>
                <p className="text-[11px] text-muted-foreground mt-1">Secteur: <strong className="uppercase">{data.executive.industryName}</strong></p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1 bg-card shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Actifs Exposés</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-foreground">{data.executive.monitoredAssets.toLocaleString()}</div>
                <p className="text-[11px] text-muted-foreground mt-1">Empreinte globale</p>
              </CardContent>
            </Card>

            <Card className={`lg:col-span-1 border-t-4 ${data.executive.criticalRisks > 0 ? 'border-t-destructive' : 'border-t-emerald-500'} bg-card shadow-sm flex flex-col justify-between`}>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Risques Actifs</CardTitle></CardHeader>
              <CardContent>
                <div className={`text-2xl font-black ${data.executive.criticalRisks > 0 ? 'text-destructive' : 'text-emerald-500'}`}>{data.executive.criticalRisks} <span className="text-xs text-muted-foreground font-normal">sévères</span></div>
                <p className="text-[11px] text-muted-foreground mt-1">Findings: {data.executive.totalFindings}</p>
              </CardContent>
            </Card>
          </div>

          {/* 2. Score & Posture */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="border-b border-border bg-secondary/10">
              <CardTitle className="text-base font-bold flex items-center gap-2"><Activity className="w-5 h-5 text-blue-500" /> 2. Score & Posture de Sécurité</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-2">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase">Évolution du Security Rating</h4>
                  <div className="h-64 w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.scorePosture.historical} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="scoreColor" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" opacity={0.1} />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                        <YAxis domain={[600, 850]} axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                        <RechartsTooltip />
                        <Legend verticalAlign="top" height={36}/>
                        <Area type="monotone" dataKey="score" name="Posture de l'Entreprise" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#scoreColor)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase">Facteurs d'impact</h4>
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1"><ArrowUpRight className="w-4 h-4"/> Impacts Positifs</span>
                    {data.scorePosture.positiveFactors.length === 0 ? <p className="text-xs text-muted-foreground italic">Aucun facteur positif majeur</p> : null}
                    {data.scorePosture.positiveFactors.map((f, i) => (
                      <div key={i} className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex justify-between items-center text-xs">
                        <span className="text-foreground truncate max-w-[150px]" title={f.factor}>{f.factor}</span><Badge className="bg-emerald-500 text-white font-bold">{f.impact}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 pt-2">
                    <span className="text-xs font-semibold text-destructive flex items-center gap-1"><ArrowDownRight className="w-4 h-4"/> Impacts Négatifs</span>
                    {data.scorePosture.negativeFactors.length === 0 ? <p className="text-xs text-muted-foreground italic">Aucun facteur négatif majeur</p> : null}
                    {data.scorePosture.negativeFactors.map((f, i) => (
                      <div key={i} className="p-2.5 bg-destructive/5 border border-destructive/20 rounded-lg flex justify-between items-center text-xs">
                        <span className="text-foreground truncate max-w-[150px]" title={f.factor}>{f.factor}</span><Badge variant="destructive" className="font-bold">{f.impact}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <h4 className="text-xs font-bold text-muted-foreground uppercase mb-4">Répartition par Catégorie (Vecteurs de Risque)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {data.scorePosture.categories.length === 0 ? <p className="text-xs text-muted-foreground col-span-4 italic">Données de catégorie non chargées</p> : null}
                  {data.scorePosture.categories.map((cat, i) => (
                    <div key={i} className="p-4 bg-secondary/20 rounded-xl border border-border space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-foreground truncate max-w-[160px]" title={cat.name}>{cat.name}</span>
                        <Badge variant={cat.rating === 'A' || cat.rating === 'G' ? 'default' : 'secondary'} className={cat.rating === 'A' || cat.rating === 'G' ? 'bg-emerald-500 text-white' : 'bg-orange-500 text-white'}>{cat.rating}</Badge>
                      </div>
                      <Progress value={cat.score} className="h-1.5" />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Risques Sévères Prioritaires */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="border-b border-border bg-secondary/10 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2"><AlertOctagon className="w-5 h-5 text-destructive" /> 3. Risques Sévères Prioritaires (Top 10)</CardTitle>
              <Badge variant="destructive">{data.executive.criticalRisks} Sévères au total</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/5">
                    <TableHead>Risque / Finding</TableHead>
                    <TableHead>Gravité</TableHead>
                    <TableHead>Impact Score</TableHead>
                    <TableHead>Actifs Concernés</TableHead>
                    <TableHead>Découverte</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.priorityRisks.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4 text-xs text-muted-foreground">Aucun risque sévère détecté</TableCell></TableRow>
                  ) : null}
                  {data.priorityRisks.map((r, i) => (
                    <TableRow
                      key={i}
                      onClick={() => setSelectedRisk(r)}
                      className="cursor-pointer hover:bg-secondary/40 transition-colors group"
                    >
                      <TableCell className="font-bold text-sm"><span className="block text-blue-600 group-hover:text-blue-500">{r.risk}</span><span className="text-xs text-muted-foreground font-mono">{r.id}</span></TableCell>
                      <TableCell><Badge variant="destructive">{r.severity}</Badge></TableCell>
                      <TableCell className="font-bold text-muted-foreground">{r.impactScore}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.assets}</TableCell>
                      <TableCell className="text-xs">{r.discoveryDate}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="group-hover:bg-background shadow-sm cursor-pointer">Détails</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Accordéons techniques */}
          <Accordion type="multiple" className="w-full space-y-4">

            {/* 4. Surface d'Attaque */}
            <AccordionItem value="item-4" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10">
                <div className="flex items-center gap-3 text-base font-bold"><Globe className="w-5 h-5 text-blue-500" /> 4. Surface d'Attaque Externe</div>
              </AccordionTrigger>
              <AccordionContent className="p-6 space-y-6">

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                  <div className="p-4 bg-secondary/20 border border-border rounded-xl">
                    <span className="block text-2xl font-black text-foreground">{data.attackSurface.domainsCount || 0}</span>
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Domaines & Sous-domaines</span>
                  </div>
                  <div className="p-4 bg-secondary/20 border border-border rounded-xl">
                    <span className="block text-2xl font-black text-foreground">{data.attackSurface.publicIpsCount || 0}</span>
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">IPs Publiques</span>
                  </div>
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
                    <span className="block text-2xl font-black text-destructive">{data.attackSurface.criticalAssetsCount || 0}</span>
                    <span className="text-[11px] font-bold text-destructive uppercase tracking-wider">Actifs Critiques</span>
                  </div>
                </div>

                {/* NOUVEAU : Zone des Graphiques (Criticité & Technologies) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Graphique Donut - Criticité */}
                  <div className="p-5 border border-border rounded-xl">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Répartition par criticité</h5>
                    <div className="h-48">
                      {data.attackSurface.riskDistribution.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.attackSurface.riskDistribution}
                              cx="50%" cy="50%"
                              innerRadius={50} outerRadius={70}
                              paddingAngle={3} dataKey="value"
                            >
                              {data.attackSurface.riskDistribution.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <RechartsTooltip />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
                          </PieChart>
                        </ResponsiveContainer>
                      ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Aucune donnée de criticité</div>}
                    </div>
                  </div>

                  {/* Graphique Barres - Technologies Détectées */}
                  <div className="p-5 border border-border rounded-xl">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Top 5 Technologies Exposées</h5>
                    <div className="h-48">
                      {data.attackSurface.topTechnologies.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsBarChart data={data.attackSurface.topTechnologies} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" tick={{fontSize: 11, fill: 'currentColor'}} axisLine={false} tickLine={false} width={80} />
                            <RechartsTooltip cursor={{fill: 'transparent'}} />
                            <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                              {data.attackSurface.topTechnologies.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={index === 0 ? '#3b82f6' : '#60a5fa'} />
                              ))}
                            </Bar>
                          </RechartsBarChart>
                        </ResponsiveContainer>
                      ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Aucune technologie détectée</div>}
                    </div>
                  </div>

                </div>

                {/* Tableau des actifs */}
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/5">
                      <TableHead>Actif</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Tech / OS</TableHead>
                      <TableHead>Niveau Risque</TableHead>
                      <TableHead className="text-right">Findings Associés</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.attackSurface.riskyAssets.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground">Aucun actif spécifique remonté</TableCell></TableRow> : null}
                    {data.attackSurface.riskyAssets.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs font-bold text-foreground">{a.asset}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.type}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground uppercase">{a.technologies || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={a.riskLevel === 'Critique' || a.riskLevel === 'Élevé' ? 'destructive' : 'secondary'}>
                            {a.riskLevel}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-bold text-sm text-right">{a.findings}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>

            {/* 5. Findings & Vulnérabilités */}
            <AccordionItem value="item-5" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><ShieldAlert className="w-5 h-5 text-orange-500" /> 5. Findings & Vulnérabilités</div></AccordionTrigger>
              <AccordionContent className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 border border-border rounded-xl">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Sévérité</h5>
                    <div className="h-44">
                      {data.findings.severityDistribution.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.findings.severityDistribution} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">{data.findings.severityDistribution.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><RechartsTooltip /></PieChart></ResponsiveContainer>
                      ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Données insuffisantes</div>}
                    </div>
                  </div>
                  <div className="p-4 border border-border rounded-xl">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase mb-4">Catégorie</h5>
                    <div className="h-44">
                      {data.findings.categoryDistribution.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%"><RechartsBarChart data={data.findings.categoryDistribution} layout="vertical" margin={{ left: 20 }}><XAxis type="number" hide /><YAxis dataKey="category" type="category" tick={{fontSize: 10}} axisLine={false} /><Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} /></RechartsBarChart></ResponsiveContainer>
                      ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Données insuffisantes</div>}
                    </div>
                  </div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Catégorie</TableHead><TableHead>Sévérité</TableHead><TableHead>Actif</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.findings.list.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground">Aucun finding à afficher</TableCell></TableRow> : null}
                    {data.findings.list.map((f, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-bold text-sm">{f.finding}</TableCell>
                        <TableCell><Badge variant="outline">{f.category}</Badge></TableCell>
                        <TableCell><Badge variant="destructive">{f.severity}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{f.asset}</TableCell>
                        <TableCell className="text-xs">{f.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>

            {/* 6. Hygiène Internet */}
            <AccordionItem value="item-6" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Lock className="w-5 h-5 text-emerald-500" /> 6. Hygiène Internet</div></AccordionTrigger>
              <AccordionContent className="p-6">
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 border border-border rounded-xl space-y-3">
                      <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">SSL / TLS</span><Badge className="bg-slate-500">{data.hygiene.sslTls.score}%</Badge></div>
                      <div className="text-xs space-y-2"><div className="flex justify-between"><span>Certificats Expirés:</span><span className="font-bold text-muted-foreground">{data.hygiene.sslTls.expiredCerts}</span></div></div>
                    </div>
                    <div className="p-4 border border-border rounded-xl space-y-3">
                      <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">DNS & Mail</span><Badge className="bg-slate-500">{data.hygiene.dns.score}%</Badge></div>
                      <div className="text-xs space-y-2"><div className="flex justify-between"><span>DMARC:</span><span className="font-bold text-muted-foreground">{data.hygiene.dns.dmarcPolicy}</span></div></div>
                    </div>
                    <div className="p-4 border border-border rounded-xl space-y-3">
                      <div className="flex justify-between items-center border-b border-border pb-2"><span className="font-bold text-sm">Services Exposés</span><Badge className="bg-slate-500">{data.hygiene.services.score}%</Badge></div>
                      <div className="text-xs space-y-2"><div className="flex justify-between"><span>Ports Ouverts:</span><span className="font-bold text-muted-foreground">{data.hygiene.services.openPortsCount}</span></div></div>
                    </div>
                 </div>
              </AccordionContent>
            </AccordionItem>

            {/* 7. Technologies & Shadow IT */}
            <AccordionItem value="item-7" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Cpu className="w-5 h-5 text-purple-500" /> 7. Technologies & Shadow IT</div></AccordionTrigger>
              <AccordionContent className="p-6">
                 <Table>
                    <TableHeader><TableRow><TableHead>Technologie</TableHead><TableHead>Version</TableHead><TableHead>Risque</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.techShadowIt.technologies.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-4 text-xs text-muted-foreground">Aucune technologie à risque listée</TableCell></TableRow> : null}
                      {data.techShadowIt.technologies.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-bold text-xs">{t.name}</TableCell>
                          <TableCell className="text-xs font-mono">{t.version}</TableCell>
                          <TableCell><Badge variant={t.risk === 'Élevé' ? 'destructive' : 'secondary'}>{t.risk}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              </AccordionContent>
            </AccordionItem>

            {/* 8. Benchmark */}
            <AccordionItem value="item-8" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><BarChart className="w-5 h-5 text-indigo-500" /> 8. Benchmark Externe</div></AccordionTrigger>
              <AccordionContent className="p-6">
                <div className="h-72 w-full">
                  {data.benchmark.radarData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={data.benchmark.radarData}>
                        <PolarGrid stroke="#333" opacity={0.2} />
                        <PolarAngleAxis dataKey="metric" tick={{fontSize: 12}} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} />
                        <Radar name="Notre Entreprise" dataKey="Enterprise" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
                        <Radar name="Moyenne Secteur" dataKey="Industry" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
                        <Legend />
                        <RechartsTooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Données sectorielles non chargées</div>}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 9. Historique & Recommandations */}
            <AccordionItem value="item-9" className="border border-border rounded-2xl bg-card overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-secondary/10"><div className="flex items-center gap-3 text-base font-bold"><Wrench className="w-5 h-5 text-emerald-500" /> 9. Recommandations</div></AccordionTrigger>
              <AccordionContent className="p-6">
                 <Table>
                    <TableHeader><TableRow><TableHead>Action Recommandée</TableHead><TableHead>Impact</TableHead><TableHead>Priorité</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.historyRecommendations.actions.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-4 text-xs text-muted-foreground">Aucune recommandation automatique</TableCell></TableRow> : null}
                      {data.historyRecommendations.actions.map((act, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-bold text-xs">{act.action}</TableCell>
                          <TableCell className="text-emerald-500 font-bold text-xs">{act.impact}</TableCell>
                          <TableCell><Badge variant="destructive">{act.priority}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </div>
      );
    }