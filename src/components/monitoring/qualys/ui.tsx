import { createContext, useContext } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, ChevronRight } from "lucide-react";
import { FLAGS, type AssetType } from "@/lib/qualys";
import type { CatalogIndex, QFilters } from "@/lib/qualysDetails";

/** Définition d'un indicateur, au clic sur ⓘ. */
export function Help({ children }: { readonly children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger aria-label="Définition" className="text-muted-foreground hover:text-foreground shrink-0" onClick={(e) => e.stopPropagation()}>
        <Info className="w-4 h-4" />
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-relaxed">{children}</PopoverContent>
    </Popover>
  );
}

export type Tone = "red" | "orange" | "violet" | "sky" | "muted" | "green" | "amber";

export function Badge({ children, tone }: { readonly children: React.ReactNode; readonly tone: Tone }) {
  const cls = {
    red: "bg-red-500/10 text-red-600", orange: "bg-orange-500/10 text-orange-600", violet: "bg-violet-500/10 text-violet-600",
    sky: "bg-sky-500/10 text-sky-600", green: "bg-emerald-500/10 text-emerald-600", amber: "bg-amber-500/10 text-amber-600", muted: "bg-muted text-muted-foreground",
  }[tone];
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{children}</span>;
}

export const TYPE_TONE: Record<AssetType, "sky" | "muted" | "violet"> = { server: "violet", workstation: "sky", other: "muted" };
const SEV_TONE: Record<number, Tone> = { 5: "red", 4: "orange", 3: "amber" };
export const sevTone = (s: number | null | undefined): Tone => (s == null ? undefined : SEV_TONE[s]) ?? "muted";

export function FlagBadges({ flags, compact = false }: { readonly flags: number; readonly compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {Boolean(flags & FLAGS.kev) && <Badge tone="red">CISA KEV</Badge>}
      {Boolean(flags & FLAGS.ransomware) && <Badge tone="violet">Ransomware</Badge>}
      {Boolean(flags & FLAGS.activeAttacks) && !(flags & FLAGS.kev) && <Badge tone="orange">Attaques actives</Badge>}
      {Boolean(flags & FLAGS.exploitPublic) && !(flags & (FLAGS.kev | FLAGS.activeAttacks)) && <Badge tone="orange">Exploit public</Badge>}
      {!compact && Boolean(flags & FLAGS.patchable) && <Badge tone="muted">Correctif disponible</Badge>}
    </span>
  );
}

/** Élément cliquable qui filtre la page : surligné quand actif, estompé quand un autre choix l'est. */
export const clickable = (active: boolean, dimmed = false) =>
  `cursor-pointer rounded-md transition-colors hover:bg-muted/60 ${active ? "ring-2 ring-primary/60 bg-primary/5" : ""} ${dimmed ? "opacity-40" : ""}`;

/** Contexte partagé par toute la page : filtres et ouverture des fiches. */
export interface QualysCtx {
  filters: QFilters;
  setFilters: (f: QFilters | ((f: QFilters) => QFilters)) => void;
  idx: CatalogIndex | null;
  openAsset: (hostId: number) => void;
  openVuln: (qid: number) => void;
}
export const QualysContext = createContext<QualysCtx | null>(null);
export const useQualysCtx = () => useContext(QualysContext);

/** Titre d'une liste repliable : la liste est masquée par défaut, un clic l'affiche ou la masque. */
export function FoldTitle({ open, onToggle, children }: { readonly open: boolean; readonly onToggle: () => void; readonly children: React.ReactNode }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} title={open ? "Masquer la liste" : "Afficher la liste"}
      className="flex items-center gap-2 text-left hover:text-primary transition-colors min-w-0">
      <ChevronRight className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      {children}
    </button>
  );
}
