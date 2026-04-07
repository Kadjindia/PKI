type FilterContext = (row: any) => boolean;

export class DaxEngine {
  private data: any[];

  constructor(data: any[]) {
    this.data = data;
  }

  /**
   * Évalue une formule DAX complexe (ex: "SUM([Clics]) / COUNT([Cibles]) * 100")
   * Supporte le changement de contexte via CALCULATE.
   */
  evaluateMeasure(formula: string, baseFilters: FilterContext[] = []): number {
    let currentFormula = formula.trim();

    // 1. GESTION DU CHANGEMENT DE CONTEXTE : CALCULATE(Expression, Filtre1, Filtre2)
    if (currentFormula.toUpperCase().startsWith('CALCULATE')) {
      const content = currentFormula.substring(10, currentFormula.length - 1);
      // Sépare les arguments par virgule en ignorant les virgules dans les parenthèses
      const parts = content.split(/,(?![^\(]*\))/);
      const expr = parts[0];
      const newFilters = parts.slice(1).map(f => this.parseFilter(f));

      // Récursion avec le nouveau contexte de filtre
      return this.evaluateMeasure(expr, [...baseFilters, ...newFilters]);
    }

    // 2. ÉVALUATION DES AGRÉGATIONS
    // Trouve toutes les expressions type SUM([Col]), COUNT([Col]) et les calcule
    const aggRegex = /(SUM|AVERAGE|COUNT|DISTINCTCOUNT|MIN|MAX)\s*\(([^)]+)\)/gi;

    let mathExpression = currentFormula.replace(aggRegex, (match, op, col) => {
      // Applique le contexte de filtre actuel aux données
      let filteredData = this.data;
      for (const f of baseFilters) {
        filteredData = filteredData.filter(f);
      }

      op = op.toUpperCase();
      col = col.replace(/[\[\]'"]/g, '').trim(); // Nettoie [Nom de Colonne]

      if (op === 'COUNT') return filteredData.length.toString();
      if (op === 'DISTINCTCOUNT') return new Set(filteredData.map(r => r[col])).size.toString();

      const values = filteredData.map(r => Number(r[col]) || 0);
      if (values.length === 0) return "0";

      if (op === 'SUM') return values.reduce((a, b) => a + b, 0).toString();
      if (op === 'AVERAGE') return (values.reduce((a, b) => a + b, 0) / values.length).toString();
      if (op === 'MIN') return Math.min(...values).toString();
      if (op === 'MAX') return Math.max(...values).toString();

      return "0";
    });

    // 3. ÉVALUATION MATHÉMATIQUE FINALE (ex: "1500 / 300 * 100")
    try {
      // Remplacement des ratios pour éviter les divisions par zéro
      if (mathExpression.includes('/ 0')) return 0;
      const result = new Function(`return ${mathExpression}`)();
      return Math.round(result * 100) / 100; // Arrondi à 2 décimales
    } catch (e) {
      console.error("DaxEngine - Erreur de syntaxe:", mathExpression);
      return 0;
    }
  }

  /**
   * Évalue une "Colonne Calculée" (Contexte de Ligne)
   * Ex: "[Montant] * [Taxe]"
   */
  evaluateCalculatedColumn(formula: string): any[] {
    return this.data.map(row => {
      let evalStr = formula.replace(/\[(.*?)\]/g, (match, col) => {
        const val = row[col.trim()];
        return isNaN(Number(val)) ? `"${val}"` : (Number(val) || 0).toString();
      });
      try {
        const result = new Function(`return ${evalStr}`)();
        return { ...row, __calculated: Math.round(result * 100) / 100 };
      } catch (e) {
        return { ...row, __calculated: null };
      }
    });
  }

  /**
   * Regroupe les données et évalue une Mesure pour chaque catégorie (Comportement Power BI)
   */
  evaluateMeasureByGroup(measureFormula: string, groupByCol: string): { category: string, value: number }[] {
    const groups = new Map<string, any[]>();
    for (const row of this.data) {
      const key = String(row[groupByCol] || 'N/A');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const results = [];
    for (const [key, rows] of groups.entries()) {
      // Crée un sous-moteur avec les données de ce groupe spécifique (Propagation du filtre)
      const subEngine = new DaxEngine(rows);
      results.push({
        category: key,
        value: subEngine.evaluateMeasure(measureFormula)
      });
    }
    return results;
  }

  /**
   * Parse un texte de filtre en fonction JS (Ex: "[Pays] = 'France'")
   */
  private parseFilter(filterStr: string): FilterContext {
    const match = filterStr.match(/\[?(.*?)\]?\s*(=|>|<|>=|<=|<>)\s*(.*)/);
    if (!match) throw new Error(`Filtre invalide: ${filterStr}`);

    const [_, col, op, valStr] = match;
    const cleanCol = col.replace(/[\[\]]/g, '').trim();
    let val: any = valStr.replace(/['"]/g, '').trim();
    if (!isNaN(Number(val))) val = Number(val);

    return (row: any) => {
      const rowVal = row[cleanCol];
      switch (op) {
        case '=': return rowVal == val;
        case '<>': return rowVal != val;
        case '>': return Number(rowVal) > val;
        case '<': return Number(rowVal) < val;
        case '>=': return Number(rowVal) >= val;
        case '<=': return Number(rowVal) <= val;
        default: return false;
      }
    };
  }
}