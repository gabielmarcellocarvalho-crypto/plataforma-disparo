import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { estimateAnthropicCostUsd, estimateGeminiCostUsd } from "@/lib/pricing-calculator";
import { AgentEditView } from "@/components/agent-edit-view";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

export default async function AgentEditPage({ params }: { params: Promise<{ id: string }> }) {
  await assertPageAccess("/agentes", { staffOnly: true });
  const { id } = await params;
  const { isStaff } = await getCurrentWorkspace();
  const supabase = await createClient();

  const { data: agentRow, error: agentError } = await supabase
    .from("agents")
    .select(
      "id, workspace_id, name, system_prompt, config, evolution_instance_name, whatsapp_instance_id, phone_number, photo_url, connection_status, status, reply_delay_min_seconds, reply_delay_max_seconds, llm_provider, handoff_to_agent_id, handoff_mode, handoff_signal, handoff_intro, handoff_notice, whatsapp_instances(channel)"
    )
    .eq("id", id)
    .maybeSingle();

  // Erro real de consulta (ex.: migration pendente) NUNCA deve virar 404 — um agente que existe de
  // verdade sumiria da tela como se tivesse sido apagado.
  if (agentError) {
    return (
      <div className="bg-danger-soft border border-danger/30 rounded-lg p-6 text-danger">
        <p className="font-bold text-sm">Não foi possível carregar o agente.</p>
        <p className="text-xs mt-1 font-mono">{agentError.message}</p>
      </div>
    );
  }
  if (!agentRow) notFound();

  const linkedInstance = agentRow.whatsapp_instances as unknown as { channel: string } | null;
  const agent = { ...agentRow, whatsapp_instance_channel: (linkedInstance?.channel as "360dialog" | "metacloud" | undefined) ?? null };

  const [{ data: usageRows }, { data: mediaRows }, { data: knowledgeRows }] = await Promise.all([
    supabase
      .from("messages")
      .select("input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
      .eq("agent_id", agent.id),
    supabase
      .from("agent_media")
      .select("id, category, url, caption, media_type, file_name")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("agent_knowledge")
      .select("id, file_name, char_count")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: true }),
  ]);

  // Campos do workspace — o agente escolhe o que coletar entre eles, em vez de inventar chave
  // própria: é isso que faz o dado coletado na conversa cair no mesmo campo que o CRM filtra e soma.
  const fieldDefs = await listCustomFieldDefs();

  // Candidatos a receber a conversa: os outros agentes do mesmo workspace. "Tem número" decide se o
  // modo "outro número" é viável — sem número conectado, o agente que assume não consegue se apresentar.
  const { data: outrosAgentes } = await supabase
    .from("agents")
    .select("id, name, evolution_instance_name, whatsapp_instance_id")
    .eq("workspace_id", agent.workspace_id)
    .neq("id", agent.id)
    .order("name");
  const handoffOptions = (outrosAgentes ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    temNumero: Boolean(a.evolution_instance_name || a.whatsapp_instance_id),
  }));

  // Números oficiais (360dialog/metacloud) conectados em Configurações que nenhum agente usa ainda —
  // viram a opção "usar número oficial" no card de conexão deste agente. Mesma lista que o formulário
  // de criação oferece (ver /agentes/page.tsx), filtrada pelos que já estão vinculados a outro agente.
  const [{ data: officialInstances }, { data: linkedRows }] = await Promise.all([
    supabase
      .from("whatsapp_instances")
      .select("id, department, channel, phone_number_id")
      .eq("workspace_id", agent.workspace_id)
      .in("channel", ["360dialog", "metacloud"]),
    supabase
      .from("agents")
      .select("whatsapp_instance_id")
      .eq("workspace_id", agent.workspace_id)
      .not("whatsapp_instance_id", "is", null),
  ]);
  const usedInstanceIds = new Set((linkedRows || []).map((r) => r.whatsapp_instance_id as string));
  const availableInstances = (officialInstances || [])
    .filter((i) => !usedInstanceIds.has(i.id))
    .map((i) => ({ id: i.id, department: i.department as string, channel: i.channel as "360dialog" | "metacloud", phone_number_id: i.phone_number_id as string | null }));

  const isGemini = agent.llm_provider === "gemini";
  const model = isGemini ? GEMINI_MODEL : ANTHROPIC_MODEL;
  const totalCostUsd = (usageRows || []).reduce(
    (sum, row) =>
      sum +
      (isGemini
        ? estimateGeminiCostUsd(GEMINI_MODEL, { inputTokens: row.input_tokens || 0, outputTokens: row.output_tokens || 0 })
        : estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
            inputTokens: row.input_tokens || 0,
            outputTokens: row.output_tokens || 0,
            cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
            cacheReadInputTokens: row.cache_read_input_tokens || 0,
          })),
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <Link href="/agentes" className="text-sm font-semibold text-text-muted hover:text-text w-fit flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Agentes
      </Link>
      <AgentEditView
        fieldDefs={fieldDefs}
        availableInstances={availableInstances}
        handoffOptions={handoffOptions}
        agent={agent}
        model={model}
        totalCostUsd={totalCostUsd}
        media={mediaRows || []}
        knowledge={knowledgeRows || []}
        canManage={isStaff}
      />
    </div>
  );
}
