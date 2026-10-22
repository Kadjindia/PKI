import { useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, Loader2, Copy, Check } from "lucide-react";

// Outil de diagnostic (affiché avec ?diag=1) : lit, via varonis-proxy, la liste
// des champs d'un type GraphQL Varonis. Lecture seule, aucune donnée d'alerte.

interface GqlTypeRef { name: string | null; kind: string; ofType?: GqlTypeRef | null }
interface GqlField { name: string; description: string | null; type: GqlTypeRef }
interface GqlType { name: string; kind: string; fields: GqlField[] | null; enumValues: { name: string }[] | null }

/** Type lisible : [User!]! -> "liste de User", String! -> "String". */
function typeLabel(t: GqlTypeRef | null | undefined): string {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return typeLabel(t.ofType);
  if (t.kind === "LIST") return `liste de ${typeLabel(t.ofType)}`;
  return t.name ?? t.kind;
}

export default function VaronisSchemaDiagnostic() {
  const [typeName, setTypeName] = useState("Alert");
  const [result, setResult] = useState<GqlType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const { data, error: err } = await supabase.functions.invoke("varonis-proxy", {
      body: { action: "schema", typeName: typeName.trim() },
    });
    if (err) {
      const body = err instanceof FunctionsHttpError ? await err.context.json().catch(() => null) : null;
      setError(body?.error ?? err.message);
    } else if (!data?.type) {
      setError(`Type « ${typeName} » introuvable dans l'API Varonis.`);
    } else {
      setResult(data.type as GqlType);
    }
    setLoading(false);
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 1));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-dashed border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" /> Diagnostic : champs disponibles dans l&apos;API Varonis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Type GraphQL"
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            className="bg-background border border-border text-foreground font-mono text-sm rounded-lg px-3 py-1.5 w-48 focus:ring-2 focus:ring-primary outline-none"
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !typeName.trim()}
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
          <div className="max-h-[420px] overflow-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2">Champ</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {(result.fields ?? []).map((f) => (
                  <tr key={f.name} className="border-t border-border">
                    <td className="p-2 font-mono font-semibold">{f.name}</td>
                    <td className="p-2 font-mono text-muted-foreground">{typeLabel(f.type)}</td>
                    <td className="p-2 text-muted-foreground">{f.description ?? ""}</td>
                  </tr>
                ))}
                {(result.enumValues ?? []).map((v) => (
                  <tr key={v.name} className="border-t border-border">
                    <td className="p-2 font-mono font-semibold">{v.name}</td>
                    <td className="p-2 text-muted-foreground" colSpan={2}>valeur possible</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
