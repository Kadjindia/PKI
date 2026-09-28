import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// --- STYLES EXECUTIVE BOARD REPORT ---
const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 65, fontFamily: 'Helvetica', backgroundColor: '#ffffff' },

  // Page de Garde
  coverPage: { backgroundColor: '#0f172a', padding: 50, justifyContent: 'center', alignItems: 'center', fontFamily: 'Helvetica' },
  coverTitle: { fontSize: 36, fontWeight: 'bold', color: '#ffffff', marginBottom: 15, textAlign: 'center', textTransform: 'uppercase' },
  coverSubtitle: { fontSize: 16, color: '#94a3b8', marginBottom: 40, textAlign: 'center' },
  coverPowered: { fontSize: 12, color: '#64748b', marginTop: 'auto', marginBottom: 10 },
  coverBrand: { fontSize: 18, color: '#3b82f6', fontWeight: 'bold' },
  coverInfoBox: { backgroundColor: '#1e293b', padding: 25, borderRadius: 8, width: '100%', borderWidth: 1, borderColor: '#334155', marginTop: 40 },
  coverInfoText: { color: '#cbd5e1', fontSize: 12, marginBottom: 8 },
  coverDate: { color: '#10b981', fontSize: 12, fontWeight: 'bold', marginTop: 15 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#e2e8f0', paddingBottom: 15, marginBottom: 30 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  headerSub: { fontSize: 9, color: '#64748b', textTransform: 'uppercase' },

  // Sections
  section: { marginBottom: 35 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', marginBottom: 15, borderLeftWidth: 4, borderLeftColor: '#3b82f6', paddingLeft: 10, textTransform: 'uppercase' },

  // Score et KPIs
  scoreContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  mainScoreBox: { width: '35%', backgroundColor: '#f8fafc', borderRadius: 8, padding: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  scoreLabel: { color: '#475569', fontSize: 10, textTransform: 'uppercase', marginBottom: 10, fontWeight: 'bold' },
  scoreValue: { color: '#0f172a', fontSize: 48, fontWeight: 'bold' },
  scoreDesc: { color: '#64748b', fontSize: 9, marginTop: 5 },

  kpiGrid: { width: '60%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  kpiCard: { width: '48%', backgroundColor: '#ffffff', borderRadius: 8, padding: 15, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  kpiValue: { fontSize: 22, fontWeight: 'bold', color: '#0f172a', marginBottom: 4 },
  kpiLabel: { fontSize: 9, color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' },

  // Bloc Stratégique (Aide à la décision)
  strategicBox: { backgroundColor: '#f8fafc', padding: 20, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#0f172a' },
  strategicTitle: { fontSize: 12, fontWeight: 'bold', color: '#0f172a', marginBottom: 12, textTransform: 'uppercase' },
  strategicText: { fontSize: 10, color: '#334155', marginBottom: 8, lineHeight: 1.5 },

  // Macro-Cartographie (Boxes)
  macroGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  macroCard: { width: '31%', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#ffffff', alignItems: 'center' },
  macroVal: { fontSize: 26, fontWeight: 'bold', marginBottom: 5 },
  macroTitle: { fontSize: 10, color: '#475569', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' },
  macroSub: { fontSize: 9, color: '#94a3b8', marginTop: 5, textAlign: 'center' },

  // Footer
  footer: { position: 'absolute', bottom: 25, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
  footerText: { fontSize: 8, color: '#94a3b8' }
});

const getGradeColor = (grade: string) => {
  if (grade === 'A') return '#10b981'; if (grade === 'B') return '#3b82f6';
  if (grade === 'C') return '#f59e0b'; if (grade === 'D') return '#f97316';
  if (grade === 'F') return '#ef4444'; return '#94a3b8';
};

export interface BitsightReportConfig {
  date: string;
  data: any;
  reportFormat: 'one-pager' | 'standard' | 'qualys';
  options: {
    showExecutive: boolean;
    showDecisionSupport: boolean;
    showTechSurface: boolean;
    showHygiene: boolean;
  };
}

export const BitsightReport = ({ date, data, reportFormat, options }: BitsightReportConfig) => {
  const isOnePager = reportFormat === 'one-pager';

  const generateStrategicSummary = () => {
    let recs = [];

    if (data.executive.score >= 750) {
      recs.push(`Évaluation globale satisfaisante (Security Rating : ${data.executive.score}). La surface d'attaque est maîtrisée. L'enjeu est désormais le Maintien en Conditions de Sécurité (MCS).`);
    } else if (data.executive.score >= 600) {
      recs.push(`Vulnérabilité modérée du SI externe (Security Rating : ${data.executive.score}). Des budgets de remédiation doivent être alloués pour sécuriser les actifs exposés.`);
    } else {
      recs.push(`Niveau d'exposition critique (Security Rating : ${data.executive.score}). Un plan de réduction des risques d'urgence doit être validé par la Direction pour combler la dette technique externe.`);
    }

    if (data.executive.criticalRisks > 0) {
      recs.push(`Exposition Sévère : ${data.executive.criticalRisks} points de défaillance majeurs nécessitent une intervention opérationnelle immédiate pour prévenir une compromission.`);
    }

    if (data.hygiene?.ssl?.grade === 'F' || data.hygiene?.dns?.grade === 'F' || data.hygiene?.ssl?.grade === 'D') {
      recs.push("Gouvernance : Défaut de conformité identifié sur l'hygiène cryptographique et/ou la messagerie. Un audit de configuration est recommandé.");
    }

    return recs;
  };

  return (
    <Document>

      {/* PAGE DE GARDE */}
      {reportFormat === 'qualys' && (
        <Page size="A4" style={styles.coverPage}>
          <Text style={styles.coverTitle}>Revue de Direction Cyber</Text>
          <Text style={styles.coverSubtitle}>Note de Synthèse sur l'Exposition aux Risques Externes</Text>

          <View style={styles.coverInfoBox}>
            <Text style={styles.coverInfoText}>Périmètre d'analyse : Actifs connectés à Internet</Text>
            <Text style={styles.coverInfoText}>Méthode de notation : Évaluation continue (Risk Rating)</Text>
            <Text style={styles.coverInfoText}>Classification : Strictement Confidentiel (TLP:RED)</Text>
            <Text style={styles.coverDate}>Date de présentation : {date}</Text>
          </View>

          <Text style={styles.coverPowered}>Produit par</Text>
          <Text style={styles.coverBrand}>Direction de la Cybersécurité</Text>
        </Page>
      )}

      {/* PAGE PRINCIPALE : SYNTHÈSE EXECUTIVE */}
      <Page size="A4" style={styles.page}>

        <View style={styles.header} fixed>
          <View>
            <Text style={styles.headerTitle}>Tableau de Bord Exécutif</Text>
            <Text style={styles.headerSub}>Indicateurs de pilotage stratégique • {date}</Text>
          </View>
          <Text style={{ fontSize: 10, color: '#ef4444', fontWeight: 'bold' }}>TLP:RED</Text>
        </View>

        {/* 1. INDICATEURS CLÉS (Score et KPIs) */}
        {options.showExecutive && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>1. Évaluation de la Posture</Text>
            <View style={styles.scoreContainer}>
              <View style={styles.mainScoreBox}>
                <Text style={styles.scoreLabel}>Niveau de Confiance</Text>
                <Text style={styles.scoreValue}>{data.executive.score}</Text>
                <Text style={styles.scoreDesc}>Indice sur {data.executive.maxScore}</Text>
              </View>
              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiValue}>{data.executive.trends.d30}</Text>
                  <Text style={styles.kpiLabel}>Variation (30 jours)</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={[styles.kpiValue, { fontSize: 14, marginTop: 4, marginBottom: 6 }]}>{data.executive.percentile}</Text>
                  <Text style={styles.kpiLabel}>Position vs Secteur</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiValue}>{data.attackSurface.criticalAssetsCount}</Text>
                  <Text style={styles.kpiLabel}>Périmètre à risque élevé</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={[styles.kpiValue, { color: data.executive.criticalRisks > 0 ? '#ef4444' : '#10b981' }]}>
                    {data.executive.criticalRisks}
                  </Text>
                  <Text style={styles.kpiLabel}>Alertes Critiques Actives</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 2. SYNTHÈSE STRATÉGIQUE (Board feedback) */}
        {options.showDecisionSupport && (
          <View style={[styles.section, styles.strategicBox]} wrap={false}>
            <Text style={styles.strategicTitle}>2. Avis de la Direction Cybersécurité</Text>
            {generateStrategicSummary().map((rec, index) => (
              <Text key={index} style={styles.strategicText}>• {rec}</Text>
            ))}
          </View>
        )}

        {/* 3. VUE MACRO DE LA SURFACE */}
        {options.showTechSurface && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>3. Cartographie du Périmètre Exposé</Text>
            <View style={styles.macroGrid}>
              <View style={[styles.macroCard, { borderTopWidth: 3, borderTopColor: '#3b82f6' }]}>
                <Text style={[styles.macroVal, { color: '#3b82f6' }]}>{data.attackSurface.domainsCount}</Text>
                <Text style={styles.macroTitle}>Points d'Entrée Web</Text>
                <Text style={styles.macroSub}>Domaines identifiés</Text>
              </View>
              <View style={[styles.macroCard, { borderTopWidth: 3, borderTopColor: '#3b82f6' }]}>
                <Text style={[styles.macroVal, { color: '#3b82f6' }]}>{data.attackSurface.publicIpsCount}</Text>
                <Text style={styles.macroTitle}>Réseau Connecté</Text>
                <Text style={styles.macroSub}>IPs publiques actives</Text>
              </View>
              <View style={[styles.macroCard, { borderTopWidth: 3, borderTopColor: '#ef4444' }]}>
                <Text style={[styles.macroVal, { color: '#ef4444' }]}>{data.executive.totalFindings}</Text>
                <Text style={[styles.macroTitle, { color: '#ef4444' }]}>Volume de Failles</Text>
                <Text style={styles.macroSub}>Cumul (Toutes Sévérités)</Text>
              </View>
            </View>
          </View>
        )}

        {/* 4. CONFORMITÉ ET GOUVERNANCE */}
        {options.showHygiene && data.hygiene && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>4. Conformité aux Standards (Hygiène IT)</Text>
            <View style={styles.macroGrid}>
              <View style={styles.macroCard}>
                <Text style={[styles.macroVal, { color: getGradeColor(data.hygiene.ssl.grade) }]}>{data.hygiene.ssl.grade}</Text>
                <Text style={styles.macroTitle}>Chiffrement (SSL)</Text>
                <Text style={styles.macroSub}>Indice de conformité</Text>
              </View>
              <View style={styles.macroCard}>
                <Text style={[styles.macroVal, { color: getGradeColor(data.hygiene.dns.grade) }]}>{data.hygiene.dns.grade}</Text>
                <Text style={styles.macroTitle}>Anti-Usurpation Email</Text>
                <Text style={styles.macroSub}>Protocoles DNS sécurisés</Text>
              </View>
              <View style={styles.macroCard}>
                <Text style={[styles.macroVal, { color: getGradeColor(data.hygiene.ports.grade) }]}>{data.hygiene.ports.grade}</Text>
                <Text style={styles.macroTitle}>Étanchéité Réseau</Text>
                <Text style={styles.macroSub}>Gestion des ports ouverts</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Rapport strictement confidentiel - Réservé aux instances de Direction.</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>

      </Page>
    </Document>
  );
};