// Abstrai o "como enviar" pro agente de IA independente do canal do número — Evolution (instância
// própria do agente) ou API oficial (número já conectado em Configurações, 360dialog/metacloud). O
// gerador de resposta (agent-reply.ts) e a orquestração da conversa não sabem nem precisam saber qual
// canal é; só chamam agentSendText/agentSendMedia com o AgentChannel resolvido.
import { sendText, sendMedia } from "@/lib/evolution";
import { sendDialog360Text, sendDialog360Media } from "@/lib/dialog360";
import { sendMetaCloudText, sendMetaCloudMedia } from "@/lib/metacloud";

export type AgentChannel =
  | { kind: "evolution"; instanceName: string }
  | { kind: "360dialog"; apiKey: string }
  | { kind: "metacloud"; phoneNumberId: string };

export async function agentSendText(channel: AgentChannel, to: string, text: string): Promise<void> {
  if (channel.kind === "evolution") return void (await sendText(channel.instanceName, to, text));
  if (channel.kind === "360dialog") return void (await sendDialog360Text(channel.apiKey, to, text));
  await sendMetaCloudText(channel.phoneNumberId, to, text);
}

export async function agentSendMedia(
  channel: AgentChannel,
  to: string,
  link: string,
  opts: { mediatype: "image" | "audio" | "document"; caption?: string; fileName?: string }
): Promise<void> {
  if (channel.kind === "evolution") return void (await sendMedia(channel.instanceName, to, link, opts));
  if (channel.kind === "360dialog") return void (await sendDialog360Media(channel.apiKey, to, opts.mediatype, link, opts.caption));
  await sendMetaCloudMedia(channel.phoneNumberId, to, opts.mediatype, link, opts.caption);
}

// Busca de foto de perfil e leitura de áudio/imagem recebidos (getMediaBase64) só existem hoje pro
// Evolution — a Cloud API não expõe foto de perfil, e mídia recebida por ela precisa de um fluxo de
// download próprio (endpoint de mídia da Graph API) ainda não implementado. Por isso essas duas coisas
// continuam condicionadas a `channel.kind === "evolution"` em vez de entrar nesse módulo.
export function describeAgentChannel(channel: AgentChannel): string {
  if (channel.kind === "evolution") return `evolution:${channel.instanceName}`;
  if (channel.kind === "360dialog") return "360dialog";
  return "metacloud";
}
