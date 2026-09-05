import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AddContactForm } from "@/components/add-contact-form";
import { ImportContactsForm } from "@/components/import-contacts-form";
import { PageSizeSelect, ContactsPageNav } from "@/components/contacts-pagination";
import { ContactsTable } from "@/components/contacts-table";
import { ContactsFilterBar } from "@/components/contacts-filter-bar";
import { PAGE_SIZES } from "@/lib/contacts-pagination";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { listBranches, listTeamMembers } from "@/app/actions/team";

// Server Actions herdam o maxDuration da página que os chama. Sem isso, importContacts (que faz
// vários upserts em lote pra planilhas grandes) fica no limite padrão da Vercel — curto demais pra
// uma base de milhares de contatos, e a function morre no meio (sem erro visível, "a plataforma cai").
export const maxDuration = 120;

type SearchParams = { size?: string; page?: string; q?: string; resp?: string; filial?: string; campo?: string; valor?: string };

export default async function ContatosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const size = PAGE_SIZES.includes(Number(sp.size) as (typeof PAGE_SIZES)[number]) ? Number(sp.size) : PAGE_SIZES[0];
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const offset = (page - 1) * size;

  const [fieldDefs, teamMembers, branches] = workspace
    ? await Promise.all([listCustomFieldDefs(), listTeamMembers(), listBranches()])
    : [[], [], []];

  // Busca textual — vírgula e parêntese quebram a sintaxe do `or` do PostgREST, e `%` viraria
  // curinga solto; fora isso o termo vai como o usuário digitou.
  const term = sp.q?.trim() ? sp.q.trim().replace(/[%,()]/g, " ") : "";
  const orFilter = term ? `name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%` : "";

  // Os mesmos filtros valem pra listagem e pra contagem. Se os dois divergirem, a paginação promete
  // páginas que não existem — por isso as duas cadeias abaixo andam sempre juntas.
  let listQuery = supabase
    .from("contacts")
    .select("id, name, phone, email, opt_out_whatsapp, opt_out_email, custom_fields, team_member_id, branch_id, created_at")
    .eq("workspace_id", workspace?.id ?? "");
  let countQuery = supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace?.id ?? "");

  if (orFilter) {
    listQuery = listQuery.or(orFilter);
    countQuery = countQuery.or(orFilter);
  }
  if (sp.resp === "__nenhum__") {
    listQuery = listQuery.is("team_member_id", null);
    countQuery = countQuery.is("team_member_id", null);
  } else if (sp.resp) {
    listQuery = listQuery.eq("team_member_id", sp.resp);
    countQuery = countQuery.eq("team_member_id", sp.resp);
  }
  if (sp.filial === "__nenhum__") {
    listQuery = listQuery.is("branch_id", null);
    countQuery = countQuery.is("branch_id", null);
  } else if (sp.filial) {
    listQuery = listQuery.eq("branch_id", sp.filial);
    countQuery = countQuery.eq("branch_id", sp.filial);
  }
  // Containment em jsonb: casa tanto valor escalar ({"produto":"Trator"}) quanto o valor dentro de um
  // campo de múltipla escolha, que é gravado como array.
  if (sp.campo && sp.valor) {
    listQuery = listQuery.contains("custom_fields", { [sp.campo]: sp.valor });
    countQuery = countQuery.contains("custom_fields", { [sp.campo]: sp.valor });
  }

  const [{ data: contacts }, { count }] = workspace
    ? await Promise.all([listQuery.order("created_at", { ascending: false }).range(offset, offset + size - 1), countQuery])
    : [{ data: [] }, { count: 0 }];

  const rows = contacts ?? [];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const filtering = Boolean(sp.q || sp.resp || sp.filial || (sp.campo && sp.valor));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Contatos</h1>
          <p className="text-text-muted text-sm mt-1">
            {total} contato(s) {filtering ? "no filtro" : `em ${workspace?.name}`}
            {total > 0 ? ` — mostrando ${offset + 1}–${offset + rows.length}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PageSizeSelect size={size} />
          <ImportContactsForm fieldDefs={fieldDefs} />
          <AddContactForm />
        </div>
      </div>

      <ContactsFilterBar defs={fieldDefs} teamMembers={teamMembers} branches={branches} />

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          {filtering ? (
            <p className="font-semibold text-text">Nenhum contato bate com esse filtro.</p>
          ) : total > 0 ? (
            <p className="font-semibold text-text">Essa página não tem contatos — volte pra página anterior.</p>
          ) : (
            <>
              <p className="font-semibold text-text">Nenhum contato ainda</p>
              <p className="text-sm mt-1">Importe uma planilha ou adicione manualmente.</p>
            </>
          )}
        </div>
      ) : (
        <ContactsTable rows={rows} fieldDefs={fieldDefs} teamMembers={teamMembers} branches={branches} />
      )}

      <ContactsPageNav page={page} totalPages={totalPages} />
    </div>
  );
}
