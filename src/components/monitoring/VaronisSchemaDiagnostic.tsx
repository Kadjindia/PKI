import { useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, Loader2, Copy, Check } from "lucide-react";

// Outil de diagnostic (affiché avec ?diag=1) : lit, via varonis-proxy, les champs
// d'un ou plusieurs types GraphQL Varonis. Lecture seule, aucune donnée métier.

interface GqlTypeRef { name: string | null; kind: string; ofType?: GqlTypeRef | null }
interface GqlArg { name: string; type: GqlTypeRef }
interface GqlField { name: string; description: string | null; type: GqlTypeRef; args?: GqlArg[] | null }
interface GqlType {
  name: string;
  kind?: string;
  missing?: boolean;
  fields?: GqlField[] | null;
  inputFields?: GqlArg[] | null; // types de filtre (INPUT_OBJECT)
  enumValues?: { name: string }[] | null;
}

/** Type lisible : [User!]! -> "liste de User", String! -> "String". */
function typeLabel(t: GqlTypeRef | null | undefined): string {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return typeLabel(t.ofType);
  if (t.kind === "LIST") return `liste de ${typeLabel(t.ofType)}`;
  return t.name ?? t.kind;
}

/** Résumé texte compact, facile à copier-coller. */
function toCompactText(types: GqlType[]): string {
  return types.map((t) => {
    if (t.missing) return `## ${t.name} : introuvable`;
    const lines = [`## ${t.name} (${t.kind})`];
    for (const f of t.fields ?? []) {
      const args = (f.args ?? []).map((a) => `${a.name}: ${typeLabel(a.type)}`).join(", ");
      const desc = (f.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      lines.push(`- ${f.name}: ${typeLabel(f.type)}${args ? ` (${args})` : ""}${desc ? ` — ${desc}` : ""}`);
    }
    for (const f of t.inputFields ?? []) lines.push(`- [filtre] ${f.name}: ${typeLabel(f.type)}`);
    if (t.enumValues?.length) lines.push(`- valeurs : ${t.enumValues.map((v) => v.name).join(", ")}`);
    return lines.join("\n");
  }).join("\n\n");
}

export default function VaronisSchemaDiagnostic() {
  const [typeNames, setTypeNames] = useState("Alert");
  const [result, setResult] = useState<GqlType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const names = typeNames.split(/[,\s]+/).map((n) => n.trim()).filter(Boolean);
    const { data, error: err } = await supabase.functions.invoke("varonis-proxy", {
      body: { action: "schema", typeNames: names },
    });
    if (err) {
      const body = err instanceof FunctionsHttpError ? await err.context.json().catch(() => null) : null;
      setError(body?.error ?? err.message);
    } else {
      setResult((data?.types ?? []) as GqlType[]);
    }
    setLoading(false);
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(toCompactText(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-dashed border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" /> Diagnostic : champs disponibles dans l&apos;API Varonis
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">Un ou plusieurs types séparés par des virgules (15 au maximum)</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Types GraphQL"
            value={typeNames}
            onChange={(e) => setTypeNames(e.target.value)}
            className="bg-background border border-border text-foreground font-mono text-sm rounded-lg px-3 py-1.5 flex-1 min-w-[260px] focus:ring-2 focus:ring-primary outline-none"
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !typeNames.trim()}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Lire le schéma
          </button>
          {result && (
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copié" : "Copier le résultat"}
            </button>
          )}
        </div>

        {error && <p className="font-mono text-xs text-destructive break-all">{error}</p>}

        {result && (
          <pre className="max-h-[480px] overflow-auto border border-border rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-foreground bg-muted/30">
            {toCompactText(result)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
