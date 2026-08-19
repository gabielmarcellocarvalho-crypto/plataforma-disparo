// Responde automaticamente contatos que mandaram mensagem FORA do horário de atendimento
// (contacts.missed_offhours = true) assim que o agente entra em horário — sem precisar que o
// contato escreva de novo pra "acordar" o webhook. Antes disso, missed_offhours só era consumido
// reativamente dentro do webhook (recapitulava na PRÓXIMA mensagem do contato) — se o contato nunca
// mandasse outra, a mensagem perdida ficava sem resposta pra sempre.
//
// Chamado a cada minuto de dentro do motor de disparo (dispatch-campaigns), que já é invocado nessa
// cadência por um cron externo (VPS) — reaproveita a infra existente em vez de precisar de um cron
// novo. Qualquer mudança no horário configurado do agente já vale na consulta seguinte (isWithinBusinessHours
// lê o config atual do banco a cada chamada, sem cache) — inclusive corrigir só o dia certo (ex.: terça em
// vez de segunda) resolve sozinho, sem deploy nem ação manual.
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { generateReply, capBubbles, splitByCharLimit, type ConversationMessage } from "@/lib/agent-reply";
import { generateReplyGemini } from "@/lib/agent-reply-gemini";
import { normalizeAgentConfig, isWithinBusinessHours } from "@/lib/agent-prompt";
import { canAdvanceStage } from "@/lib/crm-stages";

type AdminClient = ReturnType<typeof createAdminClient>;

const HISTORY_LIMIT = 20;
// Orçamento conservador — essa função divide o maxDuration=60 da mesma invocação com o motor de
// disparo de campanhas, então não pode monopolizar o tempo gerando muitas respostas de IA numa tacada.
const MAX_SENDS_PER_RUN = 10;
const MESSAGE_GAP_MS = 900;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CatchupResult = { sent: number; skipped: number };

export async function runOffHoursCatchup(supabase: AdminClient): Promise<CatchupResult> {
  let sent = 0;
  let skipped = 0;

  const { data: agents } = await supabase
    .from("agents")
    .select("id, workspace_id, system_prompt, config, evolution_instance_name, llm_provider")
    .eq("status", "ativo");

  for (const agent of agents || []) {
    if (sent >= MAX_SENDS_PER_RUN) break;

    const agentConfig = normalizeAgentConfig(agent.config);
    if (!isWithinBusinessHours(agentConfig.hours)) continue; // só age quando o agente está ABERTO agora

    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, name, custom_fields, stage, phone")
      .eq("workspace_id", agent.workspace_id)
      .eq("missed_offhours", true)
      .eq("needs_attention", false)
      .eq("opt_out_whatsapp", false);
    // Filtro de estágio terminal em JS (mesmo padrão do worker de follow-up) em vez de operador SQL
    // "not in", pra não depender de sintaxe Postgrest menos comum no resto do código.
    const contacts = (contactRows || []).filter((c) => c.stage !== "concluido" && c.stage !== "descartado");
    if (contacts.length === 0) continue;

    const { data: knowledgeRows } = await supabase.from("agent_knowledge").select("file_name, content").eq("agent_id", agent.id);
    const knowledgeText = knowledgeRows?.length
      ? knowledgeRows.map((k) => `### ${k.file_name}\n${k.content}`).join("\n\n---\n\n")
      : undefined;

    for (const contact of contacts) {
      if (sent >= MAX_SENDS_PER_RUN) {
        skipped++;
        continue;
      }

      const { data: historyRows } = await supabase
        .from("messages")
        .select("role, content")
        .eq("agent_id", agent.id)
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      const history: ConversationMessage[] = (historyRows || [])
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Sem histórico, ou a última mensagem já é do agente (respondido por outro caminho nesse meio
      // tempo, ex.: humano mandou manual) — não há o que retomar, só limpa a flag.
      if (history.length === 0 || history[history.length - 1].role !== "user") {
        await supabase.from("contacts").update({ missed_offhours: false }).eq("id", contact.id);
        continue;
      }

      // Sem ferramentas (foto/arquivo) aqui — mesma simplificação já usada no worker de follow-up:
      // é uma retomada de texto, não o fluxo completo de mensagem ao vivo.
      const replyFn = agent.llm_provider === "gemini" ? generateReplyGemini : generateReply;
      const gen = await replyFn(agent.system_prompt, { name: contact.name, custom_fields: contact.custom_fields, missedOffHours: true }, history, [], [], undefined, knowledgeText);

      const preSplitParts = agentConfig.maxBubbles > 1 ? splitByCharLimit(gen.replyParts, agentConfig.bubbleCharLimit) : gen.replyParts;
      const replyParts = capBubbles(preSplitParts, agentConfig.maxBubbles);

      if (Object.keys(gen.collectedData).length) {
        const merged = { ...((contact.custom_fields as Record<string, unknown>) || {}), ...gen.collectedData };
        const updates: Record<string, unknown> = { custom_fields: merged };
        const findKey = (name: string) => Object.keys(gen.collectedData).find((k) => k.trim().toLowerCase() === name);
        const nomeKey = findKey("nome");
        if (nomeKey && gen.collectedData[nomeKey]) updates.name = gen.collectedData[nomeKey];
        const emailKey = findKey("email");
        const emailValue = emailKey ? gen.collectedData[emailKey].trim() : "";
        if (emailValue && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) updates.email = emailValue;
        await supabase.from("contacts").update(updates).eq("id", contact.id);
      }

      if (gen.stage && canAdvanceStage(contact.stage, gen.stage)) {
        await supabase.from("contacts").update({ stage: gen.stage, stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
      }

      if (replyParts.length > 0) {
        if (gen.needsHuman) {
          await supabase
            .from("contacts")
            .update({ flagged_reason: "O agente sinalizou que essa conversa pode precisar de atenção humana (retomada pós-horário)." })
            .eq("id", contact.id);
        }

        for (let i = 0; i < replyParts.length; i++) {
          const part = replyParts[i];
          await supabase.from("messages").insert({
            workspace_id: agent.workspace_id,
            contact_id: contact.id,
            agent_id: agent.id,
            role: "assistant",
            content: part,
            input_tokens: i === 0 ? gen.inputTokens : null,
            output_tokens: i === 0 ? gen.outputTokens : null,
            cache_creation_input_tokens: i === 0 ? gen.cacheCreationInputTokens : null,
            cache_read_input_tokens: i === 0 ? gen.cacheReadInputTokens : null,
          });
          await sendText(agent.evolution_instance_name, contact.phone, part).catch((err) => console.error("Erro ao enviar retomada pós-horário:", err));
          if (i < replyParts.length - 1) await sleep(MESSAGE_GAP_MS);
        }

        await supabase.from("contacts").update({ missed_offhours: false }).eq("id", contact.id);
        sent++;
      } else {
        // Igual ao webhook ao vivo: se o modelo não produziu resposta nenhuma, isso é atenção humana
        // de verdade — não silencia e não fica tentando de novo a cada minuto pra sempre.
        await supabase
          .from("contacts")
          .update({
            needs_attention: true,
            attention_reason: "O agente não conseguiu gerar a retomada automática pós-horário.",
            missed_offhours: false,
          })
          .eq("id", contact.id);
        skipped++;
      }
    }
  }

  return { sent, skipped };
}
