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
    admin.from("workspace_members").select("user_id, workspace_id"),
    admin.auth.admin.listUsers(),
  ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));

  const rows: AccessRow[] = (usersList.data?.users ?? []).map((u) => {
    const accessType = profileById.get(u.id)?.access_type;
    return {
      id: u.id,
      email: u.email ?? "—",
      role: profileById.get(u.id)?.role ?? "cliente",
      fullName: profileById.get(u.id)?.full_name ?? null,
      accessType: isAccessType(accessType) ? accessType : null,
    };
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Cada workspace lista só quem foi adicionado nele. Quem está em mais de um aparece em cada um.
  // Developer tem acesso total e não depende de vínculo, então fica na própria seção, não aqui.
  const membersByWorkspace = new Map<string, AccessRow[]>();
  const linkedUserIds = new Set<string>();
  for (const m of memberships || []) {
    const row = rowById.get(m.user_id);
    if (!row || row.role === "developer") continue;
    linkedUserIds.add(row.id);
    const list = membersByWorkspace.get(m.workspace_id) || [];
    list.push(row);
    membersByWorkspace.set(m.workspace_id, list);
  }

  const developers = rows.filter((r) => r.role === "developer");
  // Login sem nenhum workspace: continua visível pra não virar conta "fantasma" sem ninguém ver.
  const unlinked = rows.filter((r) => r.role !== "developer" && !linkedUserIds.has(r.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Acessos</h1>
        <p className="text-text-muted text-sm mt-1">Logins por cliente e os developers da agência, com acesso a tudo.</p>
      </div>

      {(workspaces || []).map((w) => (
        <AccessSection
          key={w.id}
          title={w.name}
          subtitle="Acesso"
          rows={membersByWorkspace.get(w.id) ?? []}
          currentUserId={currentUser?.id}
          showPlan
          emptyText="Ninguém foi adicionado a este cliente ainda."
        />
      ))}

      {unlinked.length > 0 && (
        <AccessSection
          title="Sem cliente vinculado"
          subtitle="Logins que não pertencem a nenhum workspace"
          rows={unlinked}
          currentUserId={currentUser?.id}
          showPlan
        />
      )}

      <AccessSection
        title="Developers"
        subtitle="Acesso total à plataforma, a todos os clientes"
        rows={developers}
        currentUserId={currentUser?.id}
        showPlan={false}
        emptyText="Nenhum developer."
      />

      <CreateAccessForm workspaces={workspaces || []} />
    </div>
  );
}

type AccessRow = {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
  accessType: ReturnType<typeof asAccessType>;
};
function asAccessType(v: unknown) {
  return isAccessType(v) ? v : null;
}

function AccessSection({
  title,
  subtitle,
  rows,
  currentUserId,
  showPlan,
  emptyText,
}: {
  title: string;
  subtitle: string;
  rows: AccessRow[];
  currentUserId?: string;
  showPlan: boolean;
  emptyText?: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </div>
      <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-text-muted">{emptyText ?? "Nenhum acesso."}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Tipo</th>
                {showPlan && <th className="px-4 py-3">Plano</th>}
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
                  {showPlan && (
                    <td className="px-4 py-3">{r.role === "cliente" ? <AccessTypeEditor userId={r.id} current={r.accessType} /> : <span className="text-text-muted">—</span>}</td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <AccessRowActions userId={r.id} isSelf={r.id === currentUserId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
