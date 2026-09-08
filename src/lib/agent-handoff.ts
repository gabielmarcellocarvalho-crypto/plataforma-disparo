// Passagem de bastão entre agentes (SDR → Closer).
//
// Só entra em ação quando o agente tem `handoff_to_agent_id` configurado. Sem isso, tudo aqui é
// no-op e o agente segue exatamente como sempre foi — é o que mantém os agentes já em produção
// intocados por essa feature.
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { agentSendText, type AgentChannel } from "@/lib/agent-channel";

// Mesmo tipo de cliente usado no resto do motor do agente. Descrever a forma do client à mão aqui
// fazia o TypeScript tentar resolver os genéricos do supabase-js do zero e estourar em recursão.
type AdminClient = ReturnType<typeof createAdminClient>;

export type HandoffMode = "papel" | "numero";

// Só o que o handoff precisa saber de um agente — evita arrastar o tipo Agent inteiro pra cá.
export type HandoffAgent = {
  id: string;
  workspace_id: string;
  name: string;
  system_prompt: string;
  config: unknown;
  handoff_to_agent_id: string | null;
  handoff_mode: string | null;
  handoff_signal: string | null;
  handoff_intro: string | null;
  handoff_notice: string | null;
  evolution_instance_name: string | null;
  whatsapp_instance_id: string | null;
};

export const HANDOFF_SIGNALS: ContactStage[] = ["abordado", "interessado", "encaminhamento", "fechando_proposta"];

const NOTICE_PADRAO =
  "Nossa equipe já está falando com você em outro número — pode responder por lá que a gente continua de onde parou.";

// A classificação alcançou (ou passou) o ponto configurado? Comparação por posição na ordem canônica
// pelo mesmo motivo do canAdvanceStage: o agente pode classificar direto num estágio mais adiante, e
// pular a passagem só porque não bateu exatamente no valor configurado deixaria o Closer de fora.
//
// Ganho e perda ficam de fora de propósito: quando o lead fecha ou morre, não há mais o que passar.
export function atingiuGatilho(signal: ContactStage, gatilho: string | null): boolean {
  const alvo = (HANDOFF_SIGNALS as string[]).includes(gatilho ?? "") ? (gatilho as ContactStage) : "encaminhamento";
  if (signal === "concluido" || signal === "descartado") return false;
  return STAGE_ORDER.indexOf(signal) >= STAGE_ORDER.indexOf(alvo);
}

// Resolve por onde um agente fala. Precisa disso pra que o agente de destino se apresente pelo
// número DELE no modo 'numero' — o canal que veio no webhook é o de quem recebeu, não o de quem
// assume. Devolve null quando o agente não tem número próprio (o caso normal do modo 'papel', em que
// ele existe só como cérebro).
export async function resolveAgentChannel(
  supabase: AdminClient,
  agent: Pick<HandoffAgent, "evolution_instance_name" | "whatsapp_instance_id">
): Promise<AgentChannel | null> {
  if (agent.evolution_instance_name) return { kind: "evolution", instanceName: agent.evolution_instance_name };
  if (!agent.whatsapp_instance_id) return null;

  const { data } = await supabase
    .from("whatsapp_instances")
    .select("channel, dialog360_api_key, phone_number_id")
    .eq("id", agent.whatsapp_instance_id)
    .maybeSingle();
  if (!data) return null;

  if (data.channel === "360dialog") {
    const apiKey = String(data.dialog360_api_key ?? "");
    return apiKey ? { kind: "360dialog", apiKey } : null;
  }
  const phoneNumberId = String(data.phone_number_id ?? "");
  return phoneNumberId ? { kind: "metacloud", phoneNumberId } : null;
}

export type HandoffResult = { entregue: boolean; motivo?: string };

// Executa a passagem. Grava quem é o cérebro da conversa daqui pra frente e, no modo 'numero',
// apresenta o agente que assume pelo número dele.
//
// A gravação acontece ANTES do envio: se a mensagem de apresentação falhar (número fora do ar, por
// exemplo), o lead ainda está corretamente atribuído e a equipe vê isso na tela — o contrário
// deixaria o lead num limbo, com o SDR achando que entregou e ninguém tendo assumido.
export async function aplicarHandoff(
  supabase: AdminClient,
  origem: HandoffAgent,
  destino: HandoffAgent,
  contactId: string,
  phone: string
): Promise<HandoffResult> {
  await supabase
    .from("contacts")
    .update({ active_agent_id: destino.id, handed_off_at: new Date().toISOString() })
    .eq("id", contactId);

  if ((origem.handoff_mode ?? "papel") !== "numero") return { entregue: true };

  const canal = await resolveAgentChannel(supabase, destino);
  if (!canal) return { entregue: true, motivo: "agente de destino sem número próprio — conversa segue no número atual" };

  // A apresentação fica na configuração de quem PASSA (é lá que a passagem é configurada), mas sai
  // pelo número de quem ASSUME.
  const texto = (origem.handoff_intro ?? "").trim();
  if (!texto) return { entregue: true, motivo: "sem mensagem de apresentação configurada" };

  try {
    await agentSendText(canal, phone, texto);
  } catch (e) {
    // Falhar aqui não desfaz a atribuição: o lead já é do agente de destino, e a equipe consegue
    // retomar pela tela. Reverter deixaria o lead sem dono nenhum.
    return { entregue: true, motivo: `apresentação não saiu: ${(e as Error).message}` };
  }
  return { entregue: true };
}

// Texto que o agente que passou o bastão responde se o cliente insistir no número antigo.
export function textoDoAviso(origem: HandoffAgent): string {
  return (origem.handoff_notice ?? "").trim() || NOTICE_PADRAO;
}
