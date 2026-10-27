import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, Search, Download, Loader2, ChevronDown, ChevronRight, ArrowUpDown } from "lucide-react";
import {
  INVENTORY_LISTS, INACTIVE_BUCKETS, ouFromDn, matchesSearch, toCsv, formatBytes,
  type InventoryList, type AccountItem, type OwnerItem,
} from "@/lib/varonisPosture";

// Inventaire des comptes : listes de la dernière photo de posture (calcul de nuit),
// chargées seulement à l'ouverture de cet onglet.

type Item = AccountItem | OwnerItem;

async function fetchInventory(list: InventoryList): Promise<{ date: string | null; available: boolean; items: Item[] }> {
  const { data, error } = await supabase.functions.invoke("varonis-proxy", { body: { action: "posture-inventory", list } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const errBody = await error.context.json().catch(() => null);
      throw new Error(errBody?.error ?? `Erreur HTTP ${error.context.status}`);
    }
    throw error;
  }
  return data;
}

const PAGE_SIZE = 50;
const DAY = 86400000;
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);
const bucketLabel = (k?: string) => INACTIVE_BUCKETS.find((b) => b.key === k)?.label ?? "";

const PRIV_LABELS: Record<string, string> = { ADMIN: "Admin", SERVICE: "Service", EXECUTIVE: "Dirigeant" };
const STATUS_LABELS: Record<string, string> = { VALID: "Valide", ABOUT_TO_EXPIRE: "Expire bientôt", EXPIRED: "Expiré", NEVER_EXPIRES: "N'expire jamais" };

/** Colonnes de l'export CSV des comptes (tous les détails). */
const ACCOUNT_CSV = [
  { key: "name", label: "Nom" }, { key: "sam", label: "Identifiant (sAMAccountName)" }, { key: "upn", label: "UPN" },
  { key: "email", label: "E-mail" }, { key: "department", label: "Service" }, { key: "jobTitle", label: "Fonction" },
  { key: "company", label: "Société" }, { key: "ou", label: "Unité d'organisation" }, { key: "lastLogon", label: "Dernière connexion" },
  { key: "lastActivity", label: "Dernière activité" }, { key: "bucket", label: "Ancienneté" }, { key: "pwdLastSet", label: "Mot de passe changé le" },
  { key: "pwdStatus", label: "Statut du mot de passe" }, { key: "expiration", label: "Expiration du compte" },
  { key: "expirationStatus", label: "Statut d'expiration" }, { key: "created", label: "Créé le" }, { key: "privileged", label: "Privilèges" },
  { key: "apps", label: "Applications connectées (via groupes)" }, { key: "groupNames", label: "Groupes" },
  { key: "entraRoles", label: "Rôles Entra ID" }, { key: "exchangeRoles", label: "Groupes de rôles Exchange" },
  { key: "mfa", label: "Méthodes MFA" }, { key: "lockedOut", label: "Verrouillé" }, { key: "stale", label: "Inactif selon Varonis" },
  { key: "type", label: "Type" }, { key: "description", label: "Description" }, { key: "dn", label: "DN" },
];
const OWNER_CSV = [
  { key: "name", label: "Propriétaire" }, { key: "sam", label: "Identifiant" }, { key: "upn", label: "UPN" }, { key: "email", label: "E-mail" },
  { key: "department", label: "Service" }, { key: "jobTitle", label: "Fonction" }, { key: "folderCount", label: "Dossiers sensibles" },
  { key: "size", label: "Volume" }, { key: "folders", label: "Dossiers (les 50 plus gros)" },
];

/** Colonnes triables : valeur de tri d'un élément. */
const SORTS: Record<string, (i: Item) => string | number> = {
  name: (i) => (i.name ?? i.sam ?? "").toLowerCase(),
  department: (i) => (i.department ?? "").toLowerCase(),
  lastLogon: (i) => ("lastLogon" in i && i.lastLogon ? new Date(i.lastLogon).getTime() : 0),
  pwdLastSet: (i) => ("pwdLastSet" in i && i.pwdLastSet ? new Date(i.pwdLastSet).getTime() : 0),
  expiration: (i) => ("expiration" in i && i.expiration ? new Date(i.expiration).getTime() : 0),
  ou: (i) => ouFromDn("dn" in i ? i.dn : undefined).toLowerCase(),
  folderCount: (i) => ("folderCount" in i ? i.folderCount : 0),
  sizeBytes: (i) => ("sizeBytes" in i ? i.sizeBytes : 0),
};

function SortHead({ label, k, sort, setSort, className = "" }: {
  readonly label: string; readonly k: string; readonly sort: { key: string; dir: 1 | -1 };
  readonly setSort: (s: { key: string; dir: 1 | -1 }) => void; readonly className?: string;
}) {
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label} <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

function Tag({ children, tone = "muted" }: { readonly children: React.ReactNode; readonly tone?: "muted" | "red" | "orange" }) {
  const cls = tone === "red" ? "bg-red-500/10 text-red-600" : tone === "orange" ? "bg-orange-500/10 text-orange-600" : "bg-muted text-muted-foreground";
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>{children}</span>;
}

export default function VaronisAccountsInventory({ list, onListChange }: { readonly list: InventoryList; readonly onListChange: (l: InventoryList) => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const def = INVENTORY_LISTS.find((l) => l.key === list)!;

  const { data, error, isLoading } = useQuery({
    queryKey: ["varonis-inventory", list],
    queryFn: () => fetchInventory(list),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const rows = useMemo(() => {
    const filtered = (data?.items ?? []).filter((i) => matchesSearch(i, search));
    const by = SORTS[sort.key] ?? SORTS.name;
    return filtered.sort((a, b) => (by(a) < by(b) ? -sort.dir : by(a) > by(b) ? sort.dir : 0));
  }, [data, search, sort]);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const changeList = (l: InventoryList) => { onListChange(l); setPage(0); setOpen(null); setSearch(""); };

  const exportCsv = () => {
    const csv = def.owners
      ? toCsv((rows as OwnerItem[]).map((o) => ({ ...o, size: formatBytes(o.sizeBytes), folders: o.folders.map((f) => f.path).join(" | ") })), OWNER_CSV)
      : toCsv((rows as AccountItem[]).map((a) => ({
          ...a, ou: ouFromDn(a.dn), bucket: bucketLabel(a.bucket),
          lastLogon: fmtDate(a.lastLogon), lastActivity: fmtDate(a.lastActivity), pwdLastSet: fmtDate(a.pwdLastSet),
          expiration: fmtDate(a.expiration), created: fmtDate(a.created),
          pwdStatus: a.pwdStatus ? STATUS_LABELS[a.pwdStatus] ?? a.pwdStatus : "",
          expirationStatus: a.expirationStatus ? STATUS_LABELS[a.expirationStatus] ?? a.expirationStatus : "",
          lockedOut: a.lockedOut ? "Oui" : "", stale: a.stale ? "Oui" : "",
        })), ACCOUNT_CSV);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `varonis-${list}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-black text-foreground flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" /> Inventaire des comptes
        </h3>
        <p className="text-sm text-muted-foreground">
          Listes détaillées issues de la dernière photo de posture{data?.date ? ` (${new Date(data.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })})` : ""} : à filtrer, trier et exporter.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {INVENTORY_LISTS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => changeList(l.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${list === l.key ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold">{def.label}{data?.available ? ` : ${rows.length.toLocaleString("fr-FR")}${search ? ` sur ${(data.items.length).toLocaleString("fr-FR")}` : ""}` : ""}</CardTitle>
              <p className="text-xs text-muted-foreground">{def.help}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label="Rechercher"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Nom, identifiant, service, OU…"
                  className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-background w-64 focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!rows.length}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Exporter (CSV)
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
          ) : error ? (
            <p className="text-sm text-destructive">{(error as Error).message}</p>
          ) : !data?.available ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Liste disponible après le prochain calcul de la posture (bouton « Recalcul rapide » de l&apos;onglet Posture, ou calcul de la nuit).</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-emerald-600 py-6 text-center">{search ? "Aucun résultat pour cette recherche." : "Aucun compte dans cette liste."}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6" />
                      <SortHead label={def.owners ? "Propriétaire" : "Compte"} k="name" sort={sort} setSort={setSort} />
                      <SortHead label="Service / fonction" k="department" sort={sort} setSort={setSort} />
                      {def.owners ? (
                        <>
                          <SortHead label="Dossiers sensibles" k="folderCount" sort={sort} setSort={setSort} className="text-right" />
                          <SortHead label="Volume" k="sizeBytes" sort={sort} setSort={setSort} className="text-right" />
                        </>
                      ) : (
                        <>
                          <SortHead label="Dernière connexion" k="lastLogon" sort={sort} setSort={setSort} />
                          <SortHead label="Mot de passe changé" k="pwdLastSet" sort={sort} setSort={setSort} />
                          <SortHead label="Expiration" k="expiration" sort={sort} setSort={setSort} />
                          <SortHead label="Unité d'organisation" k="ou" sort={sort} setSort={setSort} />
                          <TableHead>Indicateurs</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((item, i) => {
                      const idx = page * PAGE_SIZE + i;
                      const isOpen = open === idx;
                      const a = item as AccountItem;
                      const o = item as OwnerItem;
                      const age = daysSince(a.lastLogon);
                      return (
                        <Fragment key={idx}>
                          <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : idx)}>
                            <TableCell>{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}</TableCell>
                            <TableCell className="max-w-[240px]">
                              <div className="font-medium truncate" title={item.name}>{item.name ?? item.sam ?? "—"}</div>
                              <div className="text-[11px] text-muted-foreground font-mono truncate" title={item.upn ?? item.sam}>{item.sam ?? item.upn ?? ""}</div>
                            </TableCell>
                            <TableCell className="text-sm max-w-[200px]">
                              <div className="truncate" title={item.department}>{item.department ?? "—"}</div>
                              <div className="text-[11px] text-muted-foreground truncate" title={item.jobTitle}>{item.jobTitle ?? ""}</div>
                            </TableCell>
                            {def.owners ? (
                              <>
                                <TableCell className="text-right font-bold">{o.folderCount.toLocaleString("fr-FR")}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{formatBytes(o.sizeBytes)}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-sm whitespace-nowrap">
                                  {a.lastLogon ? <>{fmtDate(a.lastLogon)} <span className="text-[11px] text-muted-foreground">({age} j)</span></> : <span className="text-muted-foreground">Jamais / inconnue</span>}
                                  {a.bucket && <div className="text-[11px] text-muted-foreground">{bucketLabel(a.bucket)}</div>}
                                </TableCell>
                                <TableCell className="text-sm whitespace-nowrap">{fmtDate(a.pwdLastSet) || "—"}</TableCell>
                                <TableCell className="text-sm whitespace-nowrap">
                                  {a.expiration ? fmtDate(a.expiration) : a.expirationStatus === "NEVER_EXPIRES" ? "Jamais" : "—"}
                                </TableCell>
                                <TableCell className="text-xs max-w-[220px] truncate" title={ouFromDn(a.dn)}>{ouFromDn(a.dn) || "—"}</TableCell>
                                <TableCell className="space-x-1 whitespace-nowrap">
                                  {(a.privileged ?? []).map((p) => <Tag key={p} tone={p === "ADMIN" ? "red" : "muted"}>{PRIV_LABELS[p] ?? p}</Tag>)}
                                  {(a.apps ?? []).slice(0, 3).map((app) => <Tag key={app}>{app}</Tag>)}
                                  {(a.apps?.length ?? 0) > 3 && <Tag>{`+${a.apps!.length - 3}`}</Tag>}
                                  {(a.entraRoles?.length ?? 0) > 0 && <Tag tone="red">{`${a.entraRoles!.length} rôle${a.entraRoles!.length > 1 ? "s" : ""} Entra ID`}</Tag>}
                                  {a.inactive && <Tag tone="orange">Inactif</Tag>}
                                  {a.lockedOut && <Tag tone="orange">Verrouillé</Tag>}
                                  {a.expirationStatus === "EXPIRED" && <Tag tone="red">Expiré</Tag>}
                                  {a.pwdStatus === "EXPIRED" && <Tag tone="orange">Mot de passe expiré</Tag>}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={def.owners ? 4 : 7} className="text-xs">
                                {def.owners ? (
                                  <div className="space-y-1">
                                    <div className="text-muted-foreground">{[o.email, o.upn, o.company].filter(Boolean).join(" · ")}</div>
                                    <div className="font-semibold">Dossiers sensibles détenus ({o.folderCount > o.folders.length ? `les ${o.folders.length} plus gros sur ${o.folderCount}` : o.folderCount}) :</div>
                                    <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                      {o.folders.map((f, j) => (
                                        <li key={j} className="flex justify-between gap-3 font-mono">
                                          <span className="truncate" title={f.path ?? ""}>{f.path}</span>
                                          <span className="text-muted-foreground shrink-0">{formatBytes(f.sizeBytes)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                  {(a.groups?.length ?? 0) > 0 && (
                                    <div>
                                      <div className="font-semibold mb-1">Groupes ({a.groups!.length}){(a.apps?.length ?? 0) > 0 && <> · applications connectées : {a.apps!.join(", ")}</>}</div>
                                      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5">
                                        {a.groups!.map((g) => (
                                          <li key={g.name} className="truncate" title={g.description ?? ""}>
                                            <span className="font-mono">{g.name}</span>
                                            {g.inherited && <span className="text-muted-foreground"> (hérité)</span>}
                                            {(g.apps?.length ?? 0) > 0 && <span className="text-primary"> · {g.apps!.join(", ")}</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                                    {[
                                      ["E-mail", a.email], ["UPN", a.upn], ["Société", a.company],
                                      ["Dernière activité", fmtDate(a.lastActivity)], ["Créé le", fmtDate(a.created)],
                                      ["Statut du mot de passe", a.pwdStatus ? STATUS_LABELS[a.pwdStatus] ?? a.pwdStatus : ""],
                                      ["Statut d'expiration", a.expirationStatus ? STATUS_LABELS[a.expirationStatus] ?? a.expirationStatus : ""],
                                      ["Rôles Entra ID", (a.entraRoles ?? []).join(", ")],
                                      ["Groupes de rôles Exchange", (a.exchangeRoles ?? []).join(", ")],
                                      ["Méthodes MFA", (a.mfa ?? []).join(", ")], ["Type", a.type],
                                      ["Inactif selon Varonis", a.stale ? "Oui" : a.stale === false ? "Non" : ""],
                                      ["Description", a.description], ["DN", a.dn],
                                    ].filter(([, v]) => v).map(([k, v]) => (
                                      <div key={k} className="min-w-0">
                                        <dt className="text-muted-foreground inline">{k} : </dt>
                                        <dd className="inline break-all">{v}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-end gap-2 pt-3 text-sm">
                  <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-border disabled:opacity-40">Précédent</button>
                  <span className="text-muted-foreground">Page {page + 1} / {pages}</span>
                  <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-border disabled:opacity-40">Suivant</button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
