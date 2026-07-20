import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { WhatsappConnect } from "@/components/whatsapp-connect";

export default async function ConfiguracoesPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const { data: instance } = workspace
    ? await supabase
        .from("whatsapp_instances")
        .select("connection_status")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Configurações</h1>
        <p className="text-text-muted text-sm mt-1">Conexões do workspace {workspace?.name}.</p>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
        <h3 className="font-bold text-[15px] mb-1">WhatsApp</h3>
        <p className="text-xs text-text-muted mb-4">
          Conecta o número desse cliente via QR code (mesma tecnologia usada no piloto da Hanoi).
        </p>
        <WhatsappConnect initialStatus={instance?.connection_status || "desconectado"} />
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
        <h3 className="font-bold text-[15px] mb-1">E-mail</h3>
        <p className="text-xs text-text-muted">Remetente de e-mail ainda não configurado (precisa de RESEND_API_KEY).</p>
      </div>
    </div>
  );
}
