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
    const currentFormula = formula.trim();

    // 1. GESTION DU CHANGEMENT DE CONTEXTE : CALCULATE(Expression, Filtre1, Filtre2)
    if (currentFormula.toUpperCase().startsWith('CALCULATE')) {
      const content = currentFormula.substring(10, currentFormula.length - 1);

      // Séparation des arguments manuelle (O(N)) pour éviter toute faille ReDoS d'une regex
      const parts: string[] = [];
      let current = "";
      let depth = 0;

      // Utilisation d'une boucle for-of pour satisfaire le linter
      for (const char of content) {
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) {
          parts.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      parts.push(current.trim());

      const expr = parts[0];
      const newFilters = parts.slice(1).map(f => this.parseFilter(f));

      // Récursion avec le nouveau contexte de filtre
      return this.evaluateMeasure(expr, [...baseFilters, ...newFilters]);
    }

    // 2. ÉVALUATION DES AGRÉGATIONS
    const aggRegex = /(SUM|AVERAGE|COUNT|DISTINCTCOUNT|MIN|MAX)\s*\(([^)]+)\)/gi;

    const mathExpression = currentFormula.replace(aggRegex, (_, opStr: string, colStr: string) => {
      // Applique le contexte de filtre actuel aux données
      let filteredData = this.data;
      for (const f of baseFilters) {
        filteredData = filteredData.filter(f);
      }

      const op = opStr.toUpperCase();
      // Correction Sonar: Échappement inutile de '[' retiré
      const col = colStr.replace(/[\]['"]/g, '').trim();

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

    // 3. ÉVALUATION MATHÉMATIQUE FINALE
    try {
      if (mathExpression.includes('/ 0')) return 0;

      // SÉCURITÉ : Validation stricte des caractères avant évaluation
      if (!/^[0-9+\-*/().\s]+$/.test(mathExpression)) {
        throw new Error("L'expression contient des caractères non mathématiques.");
      }

      // eslint-disable-next-line no-new-func
      const result = new Function(`return ${mathExpression}`)(); // nosonar
      return Math.round(result * 100) / 100;
    } catch (e) {
      if (e instanceof Error) {
        console.error(`DaxEngine - Erreur de calcul: ${e.message}`, mathExpression);
      }
      return 0;
    }
  }

  /**
   * Évalue une "Colonne Calculée" (Contexte de Ligne)
   * Ex: "[Montant] * [Taxe]"
   */
  evaluateCalculatedColumn(formula: string): any[] {
    return this.data.map(row => {
      // Correction ReDoS : Limite stricte interdisant les crochets internes
      const evalStr = formula.replace(/\[([^[\]]+)\]/g, (_, col: string) => {
        const val = row[col.trim()];
        return Number.isNaN(Number(val)) ? `"${val}"` : (Number(val) || 0).toString();
      });

      try {
        // SÉCURITÉ : Validation stricte des caractères (autorise les chaînes de texte basiques)
        if (!/^[0-9+\-*/().\s"']+$/.test(evalStr)) {
          throw new Error("Caractères interdits détectés dans la colonne calculée.");
        }

        // eslint-disable-next-line no-new-func
        const result = new Function(`return ${evalStr}`)(); // nosonar
        return { ...row, __calculated: Math.round(result * 100) / 100 };
      } catch (e) {
        if (e instanceof Error) {
          console.error(`DaxEngine - Erreur de colonne: ${e.message}`, evalStr);
        }
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
    // Utilisation explicite de RegExp.exec() au lieu de String.match()
    const opRegex = /(=|>=|<=|<>|>|<)/;
    const opMatch = opRegex.exec(filterStr);

    if (!opMatch) throw new Error(`Filtre invalide: ${filterStr}`);

    const op = opMatch[0];
    const parts = filterStr.split(op);

    // Nettoyage avec Regex O(1)
    const cleanCol = parts[0].replace(/[\][]/g, '').trim();
    const valStr = parts.slice(1).join(op).trim();

    let val: string | number = valStr.replace(/['"]/g, '').trim();
    if (!Number.isNaN(Number(val))) val = Number(val);

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