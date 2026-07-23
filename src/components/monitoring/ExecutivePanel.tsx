import React from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Globe, ServerCrash, Cloud, Database,
  TrendingUp, TrendingDown, BadgeEuro,
  Lock, Scale, ArrowUpRight, ShieldCheck, Cpu, AlertTriangle
} from "lucide-react";

export default function ExecutivePanel() {
  // --- SYNTHÈSE STRATÉGIQUE HAUT NIVEAU (Périmètre 4000 collaborateurs) ---
  const executiveData = {
    macro: {
      globalScore: "740 / 900",
      trend: "+15 pts ce mois",
      varEstimate: "18.5 M€",
      varReduction: "-1.2 M€",
      complianceAvg: "80%",
      socAutomation: "82%"
    },
    pillars: [
      {
        title: "1. Périmètre Externe & Tiers (BitSight)",
        status: "Maîtrisé",
        score: "740 (Top 15%)",
        highlight: "19 fournisseurs sous surveillance critique",
        action: "Audit de conformité exigé sur 2 tiers clés.",
        icon: Globe,
        color: "border-l-emerald-500",
        badgeVariant: "default"
      },
      {
        title: "2. Infrastructure, Vulnérabilités & SOC (Qualys, QRadar, Cortex, Trend)",
        status: "Sous Tension",
        score: "SLA Patch: 72%",
        highlight: "3 450 failles critiques (MTTR 18j vs 14j cible)",
        action: "Validation requise d'une fenêtre de maintenance extraordinaire.",
        icon: ServerCrash,
        color: "border-l-destructive",
        badgeVariant: "destructive"
      },
      {
        title: "3. Gouvernance Data & Cloud (Netskope, Varonis)",
        status: "Risque Élevé",
        score: "Exposition Data",
        highlight: "2.3M fichiers en 'Global Access' & 12.5 TB Shadow IT",
        action: "Campagne de nettoyage des droits DAF et blocage cloud.",
        icon: Cloud,
        color: "border-l-orange-500",
        badgeVariant: "outline"
      }
    ],
    decisions: [
      {
        axis: "Arbitrage Budget / Patching (Qualys)",
        urgency: "Critique",
        impact: "L'accumulation de la dette technique sur les serveurs critiques menace la résilience opérationnelle (DORA).",
        recommendation: "Geler les déploiements fonctionnels pour prioriser la purge du catalogue CISA KEV sur 48h."
      },
      {
        axis: "Maîtrise des Usages Cloud (Netskope)",
        urgency: "Élevé",
        impact: "Volume important de données transitant vers des solutions non approuvées (WeTransfer, Mega.nz).",
        recommendation: "Activer le blocage strict des exfiltrations vers les stockages personnels non sanctionnés."
      }
    ]
  };

  return (
    <div className="space-y-6 mt-4">

      {/* 1. BLOC DES INDICATEURS MACRO-STRATÉGIQUES (4 Cartes Clés) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col justify-between border-t-4 border-t-emerald-500">
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500"/> Posture de Sécurité Globale
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black">{executiveData.macro.globalScore}</span>
            </div>
          </div>
          <p className="text-xs text-emerald-500 font-bold mt-4 flex items-center">
            <TrendingUp className="w-3.5 h-3.5 mr-1"/> {executiveData.macro.trend}
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col justify-between border-t-4 border-t-orange-500">
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <BadgeEuro className="w-4 h-4 text-orange-500"/> Value at Risk (VaR Financière)
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-orange-500">{executiveData.macro.varEstimate}</span>
            </div>
          </div>
          <p className="text-xs text-emerald-500 font-bold mt-4 flex items-center">
            <TrendingDown className="w-3.5 h-3.5 mr-1"/> {executiveData.macro.varReduction} d'exposition
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col justify-between border-t-4 border-t-blue-500">
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-500"/> Performance & Automatisation SOC
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-blue-500">{executiveData.macro.socAutomation}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Traitement automatisé (Cortex XSIAM / QRadar)
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col justify-between border-t-4 border-t-purple-500">
          <div>
            <span className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-500"/> Conformité Régalienne Moyenne
            </span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-foreground">{executiveData.macro.complianceAvg}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            NIS 2, ISO 27001, RGPD, DORA consolidés
          </p>
        </div>

      </div>

      {/* 2. SYNTHÈSE PAR GRAND PILIER MÉTIER */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {executiveData.pillars.map((pillar, index) => {
          const IconComp = pillar.icon;
          return (
            <div key={index} className={`p-6 rounded-2xl border border-border bg-card shadow-sm border-l-4 ${pillar.color} flex flex-col justify-between space-y-4`}>
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold uppercase tracking-wide flex items-center gap-2 text-foreground">
                    <IconComp className="w-4 h-4 text-primary" /> {pillar.title}
                  </span>
                  <Badge variant={pillar.badgeVariant as any}>{pillar.status}</Badge>
                </div>
                <div className="text-xl font-black text-foreground">{pillar.score}</div>
                <p className="text-xs text-muted-foreground"><strong className="text-foreground">Fait marquant :</strong> {pillar.highlight}</p>
              </div>
              <div className="pt-3 border-t border-border/60 text-xs font-medium text-foreground">
                📌 <span className="text-muted-foreground">Action requise :</span> {pillar.action}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. ARBITRAGES STRATÉGIQUES & RADAR DE CONFORMITÉ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Décisions COMEX */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm lg:col-span-2 space-y-4">
           <h3 className="text-lg font-bold flex items-center gap-2 text-foreground border-b border-border pb-4">
             <Scale className="w-5 h-5 text-primary" /> Notes d'Arbitrage & Décisions Requises (Comité des Risques)
           </h3>
           <div className="space-y-4 pt-2">
             {executiveData.decisions.map((dec, i) => (
               <div key={i} className="p-4 rounded-xl border border-border bg-secondary/5 space-y-2">
                 <div className="flex justify-between items-center">
                   <span className="font-bold text-sm text-foreground flex items-center gap-2">
                     <ArrowUpRight className="w-4 h-4 text-blue-500"/> {dec.axis}
                   </span>
                   <Badge variant={dec.urgency === 'Critique' ? 'destructive' : 'default'} className={dec.urgency === 'Élevé' ? 'bg-orange-500' : ''}>
                     {dec.urgency}
                   </Badge>
                 </div>
                 <p className="text-xs text-muted-foreground"><strong className="text-foreground">Impact métier :</strong> {dec.impact}</p>
                 <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium pt-1 border-t border-border/50">
                   💡 <strong className="underline">Recommandation RSSI :</strong> {dec.recommendation}
                 </p>
               </div>
             ))}
           </div>
        </div>

        {/* Radar de Conformité */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <h3 className="text-sm font-bold text-muted-foreground uppercase mb-6 flex items-center gap-2"><Lock className="w-4 h-4"/> Conformité par Cadre</h3>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2"><span className="text-sm font-medium">Directive NIS 2</span><span className="font-bold">78%</span></div>
              <Progress value={78} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2"><span className="text-sm font-medium">ISO 27001 (ISMS)</span><span className="font-bold">85%</span></div>
              <Progress value={85} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2"><span className="text-sm font-medium">RGPD (Data Privacy)</span><span className="font-bold text-emerald-500">92%</span></div>
              <Progress value={92} className="h-2 bg-emerald-500/20 [&>div]:bg-emerald-500" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2"><span className="text-sm font-medium">DORA (Résilience)</span><span className="font-bold text-orange-500">64%</span></div>
              <Progress value={64} className="h-2 bg-orange-500/20 [&>div]:bg-orange-500" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border text-[11px] text-muted-foreground text-center">
            Consolidé via les analyses Qualys, Varonis et Bitsight.
          </div>
        </div>

      </div>

    </div>
  );
}