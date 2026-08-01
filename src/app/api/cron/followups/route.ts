import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { generateReply, capBubbles, type ConversationMessage } from "@/lib/agent-reply";
import { normalizeAgentConfig, isWithinBusinessHours } from "@/lib/agent-prompt";
import { canAdvanceStage } from "@/lib/crm-stages";

// Roda periodicamente (Vercel Cron, ver vercel.json) checando contatos que pararam de responder
// depois de uma resposta do agente. Cada agente configura, em AgentConfig.followUp: de quanto em
// quanto tempo (intervalDays) tenta de novo, e quantas vezes (maxCount) antes de desistir. Esgotado
// o limite sem resposta, o próprio worker move o contato pra "descartado" e deixa registrado o porquê
// (contact_notes) — não precisa de humano decidir isso.
export const maxDuration = 60;

const HISTORY_LIMIT = 20;
const MAX_SENDS_PER_RUN = 20; // limite de chamadas à Anthropic+Evolution por invocação, pra caber no maxDuration
const MESSAGE_GAP_MS = 900;

type AdminClient = ReturnType<typeof createAdminClient>;
type MessageRow = { contact_id: string; role: "user" | "assistant"; content: string; created_at: string; is_followup: boolean };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("id, workspace_id, system_prompt, config, evolution_instance_name, phone_number")
    .eq("status", "ativo");

  let sent = 0;
  let discarded = 0;
  let skipped = 0;

  for (const agent of agents || []) {
    const agentConfig = normalizeAgentConfig(agent.config);
    if (!agentConfig.followUp.enabled) continue;
    if (!isWithinBusinessHours(agentConfig.hours)) continue;

    const { intervalDays, maxCount } = agentConfig.followUp;
    const lookbackDays = Math.min(180, intervalDays * (maxCount + 2) + 5);
    const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

    const { data: msgs } = await supabase
      .from("messages")
      .select("contact_id, role, content, created_at, is_followup")
      .eq("agent_id", agent.id)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20000);

    const byContact = new Map<string, MessageRow[]>();
    for (const m of (msgs || []) as MessageRow[]) {
      const arr = byContact.get(m.contact_id) || [];
      arr.push(m);
      byContact.set(m.contact_id, arr);
    }
    if (byContact.size === 0) continue;

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, custom_fields, needs_attention, opt_out_whatsapp, stage, phone")
      .in("id", [...byContact.keys()]);
    const contactById = new Map((contacts || []).map((c) => [c.id, c]));

    const { data: knowledgeRows } = await supabase.from("agent_knowledge").select("file_name, content").eq("agent_id", agent.id);
    const knowledgeText = knowledgeRows?.length
      ? knowledgeRows.map((k) => `### ${k.file_name}\n${k.content}`).join("\n\n---\n\n")
      : undefined;

    for (const [contactId, arr] of byContact) {
      const contact = contactById.get(contactId);
      if (!contact) continue;
      if (contact.needs_attention || contact.opt_out_whatsapp) continue;
      if (contact.stage === "concluido" || contact.stage === "descartado") continue;

      const last = arr[arr.length - 1];
      if (last.role !== "assistant") continue; // esperando resposta normal — não é caso de follow-up

      let followupsSinceUser = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].role === "user") break;
        if (arr[i].is_followup) followupsSinceUser++;
      }

      if (followupsSinceUser >= maxCount) {
        await supabase
          .from("contacts")
          .update({ stage: "descartado", stage_changed_at: new Date().toISOString() })
          .eq("id", contactId);
        await supabase.from("contact_notes").insert({
          contact_id: contactId,
          workspace_id: agent.workspace_id,
          author_name: "Follow-up automático",
          content: `Descartado automaticamente: ${maxCount} follow-up(s) enviados (a cada ${intervalDays} dia(s)) sem resposta do contato.`,
        });
        discarded++;
        continue;
      }

      const daysSinceLast = (Date.now() - new Date(last.created_at).getTime()) / 86400_000;
      if (daysSinceLast < intervalDays) continue;

      if (sent >= MAX_SENDS_PER_RUN) {
        skipped++;
        continue;
      }

      const history: ConversationMessage[] = arr.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }));
      const attemptNum = followupsSinceUser + 1;
      const nudge =
        `O contato não responde há ${Math.floor(daysSinceLast)} dia(s) — você (o agente) foi quem mandou a última ` +
        "mensagem. Gere uma retomada (follow-up) curta e natural, sem soar como cobrança: pode perguntar se ainda há " +
        "interesse, oferecer ajuda adicional, ou propor um próximo passo simples. Nunca mencione que isso é uma " +
        `mensagem automática de follow-up. Essa é a tentativa ${attemptNum} de ${maxCount}.`;

      const gen = await generateReply(
        agent.system_prompt,
        { name: contact.name, custom_fields: contact.custom_fields },
        history,
        [],
        [],
        undefined,
        knowledgeText,
        nudge
      );

      // Follow-up é sempre bolha única — retomada curta não precisa (nem deve) virar várias mensagens.
      const replyParts = capBubbles(gen.replyParts, 1);
      if (replyParts.length === 0) {
        skipped++;
        continue;
      }

      if (gen.stage && canAdvanceStage(contact.stage, gen.stage)) {
        await supabase.from("contacts").update({ stage: gen.stage, stage_changed_at: new Date().toISOString() }).eq("id", contactId);
      }
      if (gen.needsHuman) {
        await supabase
          .from("contacts")
          .update({ flagged_reason: "O agente sinalizou que essa conversa pode precisar de atenção humana (follow-up)." })
          .eq("id", contactId);
      }

      for (let i = 0; i < replyParts.length; i++) {
        const part = replyParts[i];
        await supabase.from("messages").insert({
          workspace_id: agent.workspace_id,
          contact_id: contactId,
          agent_id: agent.id,
          role: "assistant",
          content: part,
          is_followup: i === 0,
          input_tokens: i === 0 ? gen.inputTokens : null,
          output_tokens: i === 0 ? gen.outputTokens : null,
          cache_creation_input_tokens: i === 0 ? gen.cacheCreationInputTokens : null,
          cache_read_input_tokens: i === 0 ? gen.cacheReadInputTokens : null,
        });
        await sendText(agent.evolution_instance_name, contact.phone, part).catch((err) =>
          console.error("Erro ao enviar follow-up:", err)
        );
        if (i < replyParts.length - 1) await sleep(MESSAGE_GAP_MS);
      }

      sent++;
    }
  }

  return NextResponse.json({ ok: true, sent, discarded, skipped });
}
