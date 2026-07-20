import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AddContactForm } from "@/components/add-contact-form";
import { ImportContactsForm } from "@/components/import-contacts-form";

export default async function ContatosPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: contacts }, { count }] = workspace
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, opt_out_whatsapp, opt_out_email, created_at")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
      ])
    : [{ data: [] }, { count: 0 }];

  const rows = contacts ?? [];
  const total = count ?? rows.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Contatos</h1>
          <p className="text-text-muted text-sm mt-1">
            {total} contato(s) em {workspace?.name}
            {total > rows.length ? ` — mostrando os ${rows.length} mais recentes` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ImportContactsForm />
          <AddContactForm />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhum contato ainda</p>
          <p className="text-sm mt-1">Importe uma planilha ou adicione manualmente.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-semibold">{c.name || "—"}</td>
                  <td className="px-4 py-3">{c.phone || "—"}</td>
                  <td className="px-4 py-3">{c.email || "—"}</td>
                  <td className="px-4 py-3">
                    {c.opt_out_whatsapp || c.opt_out_email ? (
                      <span className="text-danger font-semibold text-xs">opt-out</span>
                    ) : (
                      <span className="text-success font-semibold text-xs">ativo</span>
                    )}
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
