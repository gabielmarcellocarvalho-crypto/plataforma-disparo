import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserColaborador } from "@/lib/workspace";
import { CreateAccessForm } from "@/components/create-access-form";
import { AccessRowActions } from "@/components/access-row-actions";

export default async function AcessosPage() {
  // Página só da equipe da agência — cliente nem enxerga no menu, mas bloqueia direto também.
  if (!(await isCurrentUserColaborador())) redirect("/");

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const [{ data: workspaces }, { data: profiles }, { data: memberships }, usersList] = await Promise.all([
    supabase.from("workspaces").select("id, name").order("created_at", { ascending: true }),
    admin.from("profiles").select("id, full_name, role"),
    admin.from("workspace_members").select("user_id, workspaces(name)"),
    admin.auth.admin.listUsers(),
  ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const workspaceByUser = new Map<string, string>();
  for (const m of memberships || []) {
    const name = (m.workspaces as unknown as { name: string } | null)?.name;
    if (name) workspaceByUser.set(m.user_id, name);
  }

  const rows = (usersList.data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "—",
    role: profileById.get(u.id)?.role ?? "cliente",
    fullName: profileById.get(u.id)?.full_name ?? null,
    workspace: workspaceByUser.get(u.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Acessos</h1>
        <p className="text-text-muted text-sm mt-1">Logins de clientes e colaboradores da agência.</p>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold">{r.fullName || "—"}</td>
                <td className="px-4 py-3">{r.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      r.role === "colaborador" ? "bg-primary-soft text-primary-strong" : "bg-bg text-text-muted"
                    }`}
                  >
                    {r.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{r.role === "cliente" ? r.workspace || "—" : "todos"}</td>
                <td className="px-4 py-3 text-right">
                  <AccessRowActions userId={r.id} isSelf={r.id === currentUser?.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateAccessForm workspaces={workspaces || []} />
    </div>
  );
}
