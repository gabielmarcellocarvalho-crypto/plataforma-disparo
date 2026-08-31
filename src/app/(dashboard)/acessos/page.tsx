import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserDeveloper } from "@/lib/workspace";
import { isAccessType } from "@/lib/access-types";
import { CreateAccessForm } from "@/components/create-access-form";
import { AccessRowActions } from "@/components/access-row-actions";
import { AccessTypeEditor } from "@/components/access-type-editor";

const ROLE_LABEL: Record<string, string> = { cliente: "cliente", colaborador: "colaborador", developer: "developer" };

export default async function AcessosPage() {
  // Página só de developer — nem colaborador (agora escopado) enxerga isso, muito menos cliente.
  if (!(await isCurrentUserDeveloper())) redirect("/");

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const [{ data: workspaces }, { data: profiles }, { data: memberships }, usersList] = await Promise.all([
    supabase.from("workspaces").select("id, name").order("created_at", { ascending: true }),
    admin.from("profiles").select("id, full_name, role, access_type"),
    admin.from("workspace_members").select("user_id, workspaces(name)"),
    admin.auth.admin.listUsers(),
  ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  // colaborador pode estar em mais de 1 workspace agora — junta todos os nomes, não só o último.
  const workspaceNamesByUser = new Map<string, string[]>();
  for (const m of memberships || []) {
    const name = (m.workspaces as unknown as { name: string } | null)?.name;
    if (!name) continue;
    const list = workspaceNamesByUser.get(m.user_id) || [];
    list.push(name);
    workspaceNamesByUser.set(m.user_id, list);
  }

  const rows = (usersList.data?.users ?? []).map((u) => {
    const accessType = profileById.get(u.id)?.access_type;
    return {
      id: u.id,
      email: u.email ?? "—",
      role: profileById.get(u.id)?.role ?? "cliente",
      fullName: profileById.get(u.id)?.full_name ?? null,
      workspaceNames: workspaceNamesByUser.get(u.id) ?? [],
      accessType: isAccessType(accessType) ? accessType : null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Acessos</h1>
        <p className="text-text-muted text-sm mt-1">Logins de clientes, colaboradores e developers da agência.</p>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente(s)</th>
              <th className="px-4 py-3">Plano</th>
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
                      r.role === "developer" ? "bg-primary-soft text-primary-strong" : r.role === "colaborador" ? "bg-warning-soft text-warning-text" : "bg-bg text-text-muted"
                    }`}
                  >
                    {ROLE_LABEL[r.role] ?? r.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {r.role === "developer" ? "todos" : r.workspaceNames.length > 0 ? r.workspaceNames.join(", ") : "—"}
                </td>
                <td className="px-4 py-3">{r.role === "cliente" ? <AccessTypeEditor userId={r.id} current={r.accessType} /> : <span className="text-text-muted">—</span>}</td>
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
