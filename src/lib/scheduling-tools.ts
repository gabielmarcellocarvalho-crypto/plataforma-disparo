import type Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";
import { bookMeeting, cancelMeeting, formatWhen, offerSlots, rescheduleMeeting, type SchedulingContext } from "@/lib/scheduling";

// Ferramentas de agenda que o agente SDR recebe quando o agendamento está ligado e há closer com
// agenda conectada (ver getSchedulingContext). Sem isso o agente nem sabe que elas existem.

type AdminClient = ReturnType<typeof createAdminClient>;
type AgentLike = { id: string; workspace_id: string; config: unknown };
type ContactLike = Parameters<typeof offerSlots>[2];

export const SCHEDULING_TOOL_NAMES = new Set(["ver_horarios_disponiveis", "marcar_reuniao", "remarcar_reuniao", "cancelar_reuniao"]);

export function buildSchedulingTools(ctx: SchedulingContext): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "ver_horarios_disponiveis",
      description:
        "Consulta os horários livres pra reunião online (Google Meet) com o time. Use SEMPRE que for oferecer ou " +
        "mudar horário — nunca invente horário. Devolve opções com um opcao_id cada.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
  ];
  if (!ctx.activeMeeting) {
    tools.push({
      name: "marcar_reuniao",
      description:
        "Marca a reunião no horário que o cliente escolheu. Só chame depois de o cliente confirmar o horário. " +
        "Se o cliente tiver informado e-mail, passe pra ele receber o convite.",
      input_schema: {
        type: "object",
        properties: {
          opcao_id: { type: "string", description: "O opcao_id do horário escolhido, exatamente como veio de ver_horarios_disponiveis" },
          email: { type: "string", description: "E-mail do cliente, se ele informou (opcional)" },
        },
        required: ["opcao_id"],
      },
    });
  } else {
    tools.push(
      {
        name: "remarcar_reuniao",
        description: "Muda a reunião já marcada pra outro horário que o cliente escolheu. Só chame depois de o cliente confirmar o novo horário.",
        input_schema: {
          type: "object",
          properties: { opcao_id: { type: "string", description: "O opcao_id do novo horário, de ver_horarios_disponiveis" } },
          required: ["opcao_id"],
        },
      },
      {
        name: "cancelar_reuniao",
        description: "Cancela a reunião marcada. Só chame se o cliente pedir claramente pra cancelar.",
        input_schema: { type: "object", properties: {}, required: [] },
      }
    );
  }
  return tools;
}

// Instrução anexada ao prompt em tempo de execução (não fica no system_prompt salvo do agente,
// porque depende de haver closer conectado e de o lead já ter reunião).
export function schedulingPromptBlock(ctx: SchedulingContext): string {
  const base =
    "\n\n## Agendamento de reunião\n" +
    "Você pode marcar uma reunião online (Google Meet) com o time. Quando o lead estiver qualificado segundo o seu " +
    "objetivo, conduza pro agendamento: chame ver_horarios_disponiveis e ofereça as opções em texto natural. " +
    "Nunca invente horário nem diga que marcou sem a ferramenta confirmar. Confirme o horário escolhido antes de marcar. " +
    "Pergunte o e-mail só se o cliente quiser receber o convite; não é obrigatório.";
  if (!ctx.activeMeeting) return base;
  return (
    base +
    `\n\nEste cliente JÁ TEM reunião marcada: ${formatWhen(ctx.activeMeeting.starts_at)} (horário de Brasília)` +
    (ctx.activeMeeting.meet_link ? `, link ${ctx.activeMeeting.meet_link}` : "") +
    ". Agora trate só de assuntos dessa reunião: tirar dúvida sobre ela, remarcar (remarcar_reuniao) ou cancelar " +
    "(cancelar_reuniao) se ele pedir. Não volte a qualificar nem a vender."
  );
}

export function makeSchedulingExecutor(admin: AdminClient, ctx: SchedulingContext, agent: AgentLike, contact: ContactLike) {
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    try {
      if (name === "ver_horarios_disponiveis") return await offerSlots(admin, ctx, contact);
      if (name === "marcar_reuniao") return await bookMeeting(admin, ctx, agent, contact, String(input.opcao_id || ""), input.email ? String(input.email) : null);
      if (name === "remarcar_reuniao") return await rescheduleMeeting(admin, ctx, agent, contact, String(input.opcao_id || ""));
      if (name === "cancelar_reuniao") return await cancelMeeting(admin, ctx, agent, contact);
      return `Ferramenta "${name}" não implementada.`;
    } catch (err) {
      console.error(`Agenda (${name}) falhou:`, err instanceof Error ? err.message : err);
      // PRECISA_HUMANO no resultado marca a conversa pra atenção (agent-reply). O agente segue a conversa.
      return (
        "ERRO_AGENDA: não foi possível acessar a agenda agora. Diga ao cliente que o time vai confirmar o horário com ele " +
        "em breve. Não diga que marcou nada. [[PRECISA_HUMANO]]"
      );
    }
  };
}
