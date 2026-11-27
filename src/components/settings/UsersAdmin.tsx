import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { PROFILES, isProfile, type Profile } from "@/lib/access";

interface AppUser {
  id: string; email: string | null; first_name: string | null; last_name: string | null;
  role: string | null; created_at: string | null; last_sign_in_at: string | null;
}

// La table users n'est pas dans les types générés : appels RPC non typés
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase as any).rpc(name, args) as Promise<{ data: unknown; error: { message: string } | null }>;

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
const fullName = (u: AppUser) => [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";

/** Gestion des profils des utilisateurs (RSSI seulement ; vérifié aussi par la base). */
export default function UsersAdmin() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await rpc("admin_list_users");
      if (error) throw new Error(error.message);
      return (data ?? []) as AppUser[];
    },
  });
  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Profile | null }) => {
      const { error } = await rpc("admin_set_role", { target: id, new_role: role });
      if (error) throw new Error(error.message);
    },
    onMutate: () => setError(null),
    onError: (e: Error) => setError(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const pending = (users.data ?? []).filter((u) => !isProfile(u.role)).length;

  return (
    <div className="kpi-card space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-primary" /></div>
        <div>
          <p className="font-medium text-foreground">Utilisateurs et profils</p>
          <p className="text-sm text-muted-foreground">
            Le profil détermine les onglets visibles et le droit de modifier. Un nouveau compte n&apos;a accès à rien tant qu&apos;un profil ne lui est pas attribué.
            {pending > 0 && <b className="text-amber-600"> {pending} compte{pending > 1 ? "s" : ""} en attente.</b>}
          </p>
        </div>
      </div>

      <ul className="grid sm:grid-cols-2 gap-2 text-xs">
        {PROFILES.map((p) => <li key={p.key} className="rounded-md border border-border px-3 py-2"><b className="text-foreground">{p.label}</b> <span className="text-muted-foreground">· {p.description}</span></li>)}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {users.isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement des utilisateurs…</p>}
      {users.error && <p className="text-sm text-destructive">{(users.error as Error).message}</p>}
      {users.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-semibold">Utilisateur</th>
                <th className="py-2 pr-3 font-semibold">Nom</th>
                <th className="py-2 pr-3 font-semibold whitespace-nowrap">Dernière connexion</th>
                <th className="py-2 font-semibold">Profil</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">{u.email}{u.id === user?.id && <span className="text-xs text-muted-foreground"> (vous)</span>}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{fullName(u)}</td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{fmtDate(u.last_sign_in_at)}</td>
                  <td className="py-2">
                    <select
                      aria-label={`Profil de ${u.email ?? "l'utilisateur"}`}
                      value={isProfile(u.role) ? u.role : ""}
                      disabled={setRole.isPending}
                      onChange={(e) => setRole.mutate({ id: u.id, role: isProfile(e.target.value) ? e.target.value : null })}
                      className={`bg-background border rounded-md px-2 py-1 text-sm ${isProfile(u.role) ? "border-border" : "border-amber-500 text-amber-600"}`}
                    >
                      <option value="">En attente (aucun accès)</option>
                      {PROFILES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
