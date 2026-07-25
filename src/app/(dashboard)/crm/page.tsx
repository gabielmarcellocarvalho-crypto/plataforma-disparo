import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { CrmBoard } from "@/components/crm-board";

const CONTACT_LIMIT = 500;

export default async function CrmPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: contacts }, { count }] = workspace
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, stage, stage_changed_at, custom_fields, needs_attention, flagged_reason, created_at")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(CONTACT_LIMIT),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
      ])
    : [{ data: [] }, { count: 0 }];

  const rows = contacts ?? [];
  const total = count ?? rows.length;

  return (
    <div className="flex flex-col gap-5 h-[calc(100vh-7.5rem)] min-h-0">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">CRM</h1>
        <p className="text-text-muted text-sm mt-1">
          Um funil só pra todo lead — vindo de conversa com agente, disparo em massa no WhatsApp ou campanha de e-mail.
          {total > rows.length ? ` Mostrando os ${rows.length} contatos mais recentes de ${total}.` : ""}
        </p>
      </div>
      <CrmBoard contacts={rows} />
    </div>
  );
}
