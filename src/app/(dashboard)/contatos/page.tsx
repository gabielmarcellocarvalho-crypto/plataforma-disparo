import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AddContactForm } from "@/components/add-contact-form";
import { ImportContactsForm } from "@/components/import-contacts-form";
import { PageSizeSelect, ContactsPageNav, PAGE_SIZES } from "@/components/contacts-pagination";

// Server Actions herdam o maxDuration da página que os chama. Sem isso, importContacts (que faz
// vários upserts em lote pra planilhas grandes) fica no limite padrão da Vercel — curto demais pra
// uma base de milhares de contatos, e a function morre no meio (sem erro visível, "a plataforma cai").
export const maxDuration = 120;

export default async function ContatosPage({ searchParams }: { searchParams: Promise<{ size?: string; page?: string }> }) {
  const sp = await searchParams;
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const size = PAGE_SIZES.includes(Number(sp.size) as (typeof PAGE_SIZES)[number]) ? Number(sp.size) : PAGE_SIZES[0];
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const offset = (page - 1) * size;

  const [{ data: contacts }, { count }] = workspace
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, opt_out_whatsapp, opt_out_email, created_at")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .range(offset, offset + size - 1),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
      ])
    : [{ data: [] }, { count: 0 }];

  const rows = contacts ?? [];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Contatos</h1>
          <p className="text-text-muted text-sm mt-1">
            {total} contato(s) em {workspace?.name}
            {total > 0 ? ` — mostrando ${offset + 1}–${offset + rows.length}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PageSizeSelect size={size} />
          <ImportContactsForm />
          <AddContactForm />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          {total > 0 ? (
            <p className="font-semibold text-text">Essa página não tem contatos — volte pra página anterior.</p>
          ) : (
            <>
              <p className="font-semibold text-text">Nenhum contato ainda</p>
              <p className="text-sm mt-1">Importe uma planilha ou adicione manualmente.</p>
            </>
          )}
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

      <ContactsPageNav page={page} totalPages={totalPages} />
    </div>
  );
}
