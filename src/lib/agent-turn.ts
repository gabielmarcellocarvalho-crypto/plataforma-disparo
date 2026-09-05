// Núcleo da conversa do agente de IA — igual pra qualquer canal (Evolution, 360dialog, metacloud).
// Cada webhook (src/app/api/webhook/whatsapp/route.ts pro Evolution, .../dialog360/route.ts pra API
// oficial) resolve a mensagem recebida do seu jeito (formato de payload bem diferente entre eles) e
// chama runAgentTurn com o resultado já normalizado — daqui pra frente é tudo compartilhado: contato,
// dedup, rate limit, delay humanizado, geração da resposta (Anthropic/Gemini), envio.
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchContactProfilePicture } from "@/lib/evolution";
import { generateReply, capBubbles, splitByCharLimit, type ConversationMessage, type AgentImage, type ToolExecutor } from "@/lib/agent-reply";
import { agentSendText, agentSendMedia, type AgentChannel } from "@/lib/agent-channel";
import { generateReplyGemini } from "@/lib/agent-reply-gemini";
import { uploadConversationMedia } from "@/lib/conversation-media";
import { normalizeAgentConfig, isWithinBusinessHours } from "@/lib/agent-prompt";
import { canAdvanceStage, isContactStage, type ContactStage } from "@/lib/crm-stages";
import { stageForSignal } from "@/lib/pipelines";
import { normalizeCity } from "@/lib/territories";
import { canonicalizeValue, parseOptions, type CustomFieldType } from "@/lib/custom-fields";
import { brPhoneVariant } from "@/lib/import-contacts";
import { getMonthToDateAgentCostUsd, COST_USD_TO_BRL } from "@/lib/cost-monitor";

type AdminClient = ReturnType<typeof createAdminClient>;

export type Agent = {
  id: string;
  workspace_id: string;
  system_prompt: string;
  config: unknown;
  status: string;
  evolution_instance_name: string | null;
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
  llm_provider: string;
};

export type RawIncomingMedia = { base64: string; mimetype: string; kind: "image" | "audio" };
export type ResolvedIncoming = {
  text: string | null;
  images: AgentImage[];
  unsupported: string | null;
  media: RawIncomingMedia | null;
  // Id da mensagem no provedor (Evolution key.id / wamid da Meta) — usado só pra dedup de retry/replay
  // de webhook (messages.external_id); null quando o canal não fornece isso.
  externalId?: string | null;
};

const OPT_OUT = /\b(sair|pare|parar|remover|descadastr|n[aã]o quero (mais )?(receber|mensagem)|me tira da lista|stop)\b/i;
const HISTORY_LIMIT = 20;
// Rate limit por CONTATO+AGENTE (nunca global) — protege contra loop/abuso de um número específico
// gerando chamada paga à Anthropic sem limite, sem punir outros clientes: cada conversa tem seu
// próprio contador independente, escala junto com o número de clientes na plataforma.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 5; // 5-6 mensagens/min já é padrão de abuso; ainda dá folga pro humano real digitando rápido
// Rate limit agregado por WORKSPACE (todos os contatos somados) — o de cima protege 1 número
// específico, mas o número de WhatsApp de um agente é público por natureza (é o objetivo do produto);
// alguém mal-intencionado pode mandar mensagem de vários números de origem diferentes, cada um com seu
// próprio contador zerado. Teto bem mais alto (cobre atendimento real de pico de um cliente grande),
// só existe pra impedir a exploração óbvia de "trocar de número reinicia o limite".
const WORKSPACE_RATE_LIMIT_MAX_MESSAGES = 60;
// Intervalo entre bolhas de uma mesma resposta (quando o agente quebra em várias mensagens) —
// bem mais curto que o delay de "pensar" antes da primeira, só pra não parecer instantâneo/colado.
const BUBBLE_GAP_MS = 1100;
const BUBBLE_GAP_JITTER_MS = 1400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ferramentas disponíveis pro agente. `enviar_foto` já funciona ponta a ponta (biblioteca de
// mídia por agente). gerar_link_pagamento e consultar_disponibilidade são os pontos de
// integração externa por cliente (gateway de pagamento / PMS) — adicionar como novas tools aqui.
// A lista de pastas (categorias) entra na descrição pra o modelo escolher uma que existe de fato,
// junto com a nota de "quando usar" configurada no formulário do agente (varia muito por agente).
function buildAgentTools(categories: string[], folderNotes: Record<string, string>): Anthropic.Tool[] {
  const listado = categories.map((c) => (folderNotes[c] ? `${c} (usar quando: ${folderNotes[c]})` : c)).join("; ");
  return [
    {
      name: "enviar_arquivo",
      description:
        "Envia um ou mais arquivos (fotos ou documentos/PDF) pro cliente no WhatsApp. Use quando o " +
        "cliente pedir pra ver algo (fotos de quartos/áreas, cardápio, tabela de pacotes em PDF, etc.) " +
        "ou quando mostrar o arquivo ajudar a converter. " +
        `Pastas disponíveis: ${listado}. ` +
        "Passe em 'categoria' exatamente o nome de uma dessas pastas. Não prometa arquivo de pasta que não existe na lista.",
      input_schema: {
        type: "object",
        properties: {
          categoria: { type: "string", description: "Uma das pastas de arquivos disponíveis", enum: categories },
        },
        required: ["categoria"],
      },
    },
  ];
}

// Universal (qualquer agente com biblioteca de mídia): nunca reenvia o mesmo arquivo pro mesmo
// contato duas vezes na conversa — registra em contact_media_sent o que já foi mandado.
function makeToolExecutor(supabase: AdminClient, agent: Agent, channel: AgentChannel, phone: string, contactId: string): ToolExecutor {
  return async (name, input) => {
    if (name === "enviar_arquivo") {
      const categoria = String(input.categoria || "").trim();
      if (!categoria) return "Informe qual categoria de arquivo enviar.";
      const { data: media } = await supabase
        .from("agent_media")
        .select("id, url, caption, category, media_type, file_name")
        .eq("agent_id", agent.id)
        .ilike("category", `%${categoria}%`)
        .limit(20);
      if (!media || media.length === 0) {
        return `Nenhum arquivo cadastrado para "${categoria}". Não invente que enviou; ofereça outra opção ou diga que vai verificar.`;
      }

      const { data: sentRows } = await supabase
        .from("contact_media_sent")
        .select("agent_media_id")
        .eq("contact_id", contactId)
        .in(
          "agent_media_id",
          media.map((m) => m.id)
        );
      const alreadySent = new Set((sentRows || []).map((r) => r.agent_media_id));
      const novos = media.filter((m) => !alreadySent.has(m.id)).slice(0, 5);

      if (novos.length === 0) {
        return `Todos os arquivos da pasta "${categoria}" já foram enviados antes nessa mesma conversa. Não envie de novo — se o cliente pedir de novo, diga que já mandou antes.`;
      }

      for (const m of novos) {
        const mediatype = m.media_type === "document" ? "document" : "image";
        await agentSendMedia(channel, phone, m.url, {
          caption: m.caption || undefined,
          mediatype,
          fileName: m.file_name || undefined,
        }).catch((e) => console.error("Erro ao enviar arquivo:", e));
        // Registra na conversa (antes não gerava linha nenhuma em `messages` — a foto saía pro
        // WhatsApp mas sumia da tela de Conversas). Reaproveita a URL que já existe em agent_media,
        // sem subir de novo.
        await supabase.from("messages").insert({
          workspace_id: agent.workspace_id,
          contact_id: contactId,
          agent_id: agent.id,
          role: "assistant",
          content: m.caption || `[arquivo enviado: ${m.file_name || m.category}]`,
          media_url: m.url,
          media_type: mediatype,
        });
      }
      await supabase.from("contact_media_sent").upsert(novos.map((m) => ({ contact_id: contactId, agent_media_id: m.id })));

      const puladas = media.length - novos.length;
      return (
        `${novos.length} arquivo(s) novo(s) da categoria "${categoria}" enviado(s) ao cliente.` +
        (puladas > 0 ? ` (${puladas} já tinham sido enviados antes nessa conversa e foram pulados.)` : "")
      );
    }
    return `Ferramenta "${name}" não implementada.`;
  };
}

export async function runAgentTurn(
  supabase: AdminClient,
  agent: Agent,
  channel: AgentChannel,
  phone: string,
  pushName: string | null,
  resolved: ResolvedIncoming
) {
  const CONTACT_COLUMNS = "id, name, custom_fields, opt_out_whatsapp, needs_attention, stage, missed_offhours, photo_url, team_member_id, pipeline_id";

  // Contato pode ser um lead novo chegando pelo agente — cria se não existir. Antes de criar, tenta
  // também a variante do "9º dígito" do celular brasileiro (a Meta às vezes reporta o número de quem
  // respondeu com um dígito a mais ou a menos do que o que foi salvo na importação da campanha) — sem
  // isso, a resposta de um lead de campanha vira um contato novo em vez de continuar a mesma conversa.
  let { data: contact } = await supabase.from("contacts").select(CONTACT_COLUMNS).eq("workspace_id", agent.workspace_id).eq("phone", phone).maybeSingle();

  if (!contact) {
    const variant = brPhoneVariant(phone);
    if (variant) {
      const { data: byVariant } = await supabase
        .from("contacts")
        .select(CONTACT_COLUMNS)
        .eq("workspace_id", agent.workspace_id)
        .eq("phone", variant)
        .maybeSingle();
      contact = byVariant;
    }
  }

  if (!contact) {
    const { data: created } = await supabase
      .from("contacts")
      .insert({ workspace_id: agent.workspace_id, phone, name: pushName })
      .select(CONTACT_COLUMNS)
      .maybeSingle();
    contact = created;
  }
  if (!contact) return;
  // Da pra frente, `phone` continua sendo o número exato que a Meta usou pra entregar ESSA mensagem
  // (o que garantidamente funciona pra responder agora) — mesmo se o contato foi encontrado pela
  // variante do 9º dígito, não sobrescreve com o telefone salvo no contato (que pode ser a variante
  // que não bate mais com o que a Meta espera pra esse envio).

  if (contact.opt_out_whatsapp) return;

  // Busca a foto de perfil do WhatsApp só na 1ª vez (contato sem foto salva ainda) — não repete a
  // cada mensagem. Best-effort: sem foto pública, fica null e segue normal. Só existe no Evolution —
  // a Cloud API (360dialog/metacloud) não expõe foto de perfil.
  if (!contact.photo_url && channel.kind === "evolution") {
    const photoUrl = await fetchContactProfilePicture(channel.instanceName, phone);
    if (photoUrl) {
      await supabase.from("contacts").update({ photo_url: photoUrl }).eq("id", contact.id);
      contact.photo_url = photoUrl;
    }
  }

  const { text, images, unsupported, media, externalId } = resolved;

  // Idempotência: retry/replay do provedor (reconexão da Evolution, retry da Meta) reenviando o MESMO
  // messageId/wamid não deve gerar 2ª resposta do agente nem cobrar a API 2x pela mesma mensagem —
  // checa ANTES de qualquer insert/trabalho pago. Sem externalId (canal não informou), segue normal.
  if (externalId) {
    const { data: dup } = await supabase
      .from("messages")
      .select("id")
      .eq("workspace_id", agent.workspace_id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (dup) return;
  }

  if (!text && images.length === 0) {
    if (unsupported) {
      // Mesmo sem o agente conseguir processar (ex.: áudio sem transcrição disponível), ainda sobe e
      // registra a mídia na conversa — antes disso sumia por completo, só marcava atenção humana sem
      // deixar rastro nenhum pra quem fosse revisar depois.
      const mediaUrl = media ? await uploadConversationMedia(supabase, agent.workspace_id, contact.id, media.base64, media.mimetype) : null;
      await supabase.from("messages").insert({
        workspace_id: agent.workspace_id,
        contact_id: contact.id,
        agent_id: agent.id,
        role: "user",
        content: `[${unsupported} recebido — não processado automaticamente]`,
        media_url: mediaUrl,
        media_type: mediaUrl ? media!.kind : null,
        external_id: externalId || null,
      });
      await supabase
        .from("contacts")
        .update({ needs_attention: true, attention_reason: `Enviou ${unsupported}, o agente não conseguiu processar automaticamente.` })
        .eq("id", contact.id);
    }
    return;
  }

  // Foto sem legenda ainda precisa virar uma linha de texto no histórico — o modelo recebe a
  // imagem de fato via `images`, mas o registro guarda um marcador legível pra revisão humana.
  const userContent = text || "[o cliente enviou uma foto]";

  // Sobe o áudio/foto original pro storage — best-effort, não trava a resposta se falhar.
  const mediaUrl = media ? await uploadConversationMedia(supabase, agent.workspace_id, contact.id, media.base64, media.mimetype) : null;
  const mediaType = mediaUrl ? media!.kind : null;

  // Detecta mensagem repetida ANTES de logar a atual (a query já exclui ela por construção) — pega
  // loop/teste (copy-paste da mesma mensagem) sem esperar o limite de volume geral. Dois níveis:
  // 1ª repetição (2 iguais seguidas) = já responde igual antes, então pula silenciosamente (zero custo
  // extra, zero flag — pode ser só um humano reenviando por impaciência); 2ª repetição (3 iguais
  // seguidas) = aí sim escala pra atenção humana. No máximo 1 chamada paga pra qualquer streak de repetição.
  const { data: lastUserMsgs } = await supabase
    .from("messages")
    .select("content")
    .eq("agent_id", agent.id)
    .eq("contact_id", contact.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(2);
  const normalizedCurrent = userContent.trim().toLowerCase();
  const priorContents = (lastUserMsgs || []).map((m) => (m.content as string).trim().toLowerCase());
  const isFirstRepeat = priorContents[0] === normalizedCurrent;
  const isSecondRepeat = isFirstRepeat && priorContents[1] === normalizedCurrent;

  const { data: insertedUserMsg } = await supabase
    .from("messages")
    .insert({
      workspace_id: agent.workspace_id,
      contact_id: contact.id,
      agent_id: agent.id,
      role: "user",
      content: userContent,
      media_url: mediaUrl,
      media_type: mediaType,
      external_id: externalId || null,
    })
    .select("id")
    .single();
  const myMessageId = insertedUserMsg?.id ?? null;

  if (text && OPT_OUT.test(text)) {
    await supabase.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
    return;
  }

  if (contact.needs_attention) return; // humano já assumiu essa conversa — agente não responde até ser resolvido
  if (agent.status !== "ativo") return;

  const agentConfig = normalizeAgentConfig(agent.config);
  // Checagem REAL de horário — não é só o texto do prompt (o modelo pode ignorar). Fora do horário
  // configurado, não responde nada mesmo (sem marcar atenção — não é erro, é esperado). Marca
  // missed_offhours pra, quando o cliente mandar mensagem de novo dentro do horário, o agente abrir
  // com uma recapitulação curta em vez de agir como se nada tivesse ficado sem resposta.
  if (!isWithinBusinessHours(agentConfig.hours)) {
    if (!contact.missed_offhours) await supabase.from("contacts").update({ missed_offhours: true }).eq("id", contact.id);
    return;
  }

  // 1ª repetição: já respondeu igual há pouco, pular silenciosamente evita gastar outra chamada paga
  // pra dizer a mesma coisa de novo (zero custo, zero flag — pode ser só impaciência do cliente).
  if (isFirstRepeat && !isSecondRepeat) return;

  // 2ª repetição seguida (3 mensagens iguais no total): agora sim é padrão de teste/loop, escala.
  if (isSecondRepeat) {
    await supabase
      .from("contacts")
      .update({
        needs_attention: true,
        attention_reason: "Mensagem repetida várias vezes seguidas (possível teste ou loop) — agente pausado pra esse contato até revisão.",
      })
      .eq("id", contact.id);
    return;
  }

  const rateLimitSince = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentUserMessages } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agent.id)
    .eq("contact_id", contact.id)
    .eq("role", "user")
    .gte("created_at", rateLimitSince);

  if ((recentUserMessages || 0) > RATE_LIMIT_MAX_MESSAGES) {
    await supabase
      .from("contacts")
      .update({
        needs_attention: true,
        attention_reason: "Muitas mensagens em pouco tempo (possível loop ou abuso) — agente pausado pra esse contato até revisão.",
      })
      .eq("id", contact.id);
    return;
  }

  // Rate limit agregado por workspace — cobre o caso de abuso vindo de vários números de origem
  // diferentes ao mesmo tempo (cada um passaria no limite por-contato acima sozinho). Não marca
  // needs_attention no contato (seria falso-positivo pra um cliente legítimo pego no meio de um pico
  // real de outro número) — só recusa essa resposta específica; o contato tenta de novo no próximo tick.
  const { count: recentWorkspaceMessages } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", agent.workspace_id)
    .eq("role", "user")
    .gte("created_at", rateLimitSince);
  if ((recentWorkspaceMessages || 0) > WORKSPACE_RATE_LIMIT_MAX_MESSAGES) return;

  // Teto de orçamento mensal de IA (workspaces.monthly_cost_budget_brl) — antes só alimentava um
  // banner de alerta na tela, nunca bloqueava de verdade; sem isso, qualquer um que descubra o número
  // de WhatsApp de um agente pode gerar custo de API ilimitado contra o cliente. Checa aqui, o ponto
  // único por onde toda mensagem de todo canal passa antes de chamar o LLM.
  const { data: budgetRow } = await supabase.from("workspaces").select("monthly_cost_budget_brl").eq("id", agent.workspace_id).maybeSingle();
  if (budgetRow?.monthly_cost_budget_brl) {
    const costUsd = await getMonthToDateAgentCostUsd(supabase, agent.workspace_id);
    const costBrl = costUsd * COST_USD_TO_BRL;
    if (costBrl >= budgetRow.monthly_cost_budget_brl) {
      await supabase
        .from("contacts")
        .update({
          needs_attention: true,
          attention_reason: "Orçamento mensal de IA desse workspace foi atingido — agente pausado até revisão.",
        })
        .eq("id", contact.id);
      return;
    }
  }

  // Espera antes de responder (delay humanizado configurado no agente) e, ao acordar, confere se o
  // contato mandou mensagem NOVA nesse meio-tempo — comum quando alguém manda "oi" e "tudo bem" em
  // bolhas separadas. Se sim, essa chamada desiste sem responder: a invocação da mensagem mais nova
  // vai encontrar as duas já salvas no histórico e responder pelas duas juntas, uma vez só.
  const { reply_delay_min_seconds: min, reply_delay_max_seconds: max } = agent;
  const delaySeconds = min + Math.random() * Math.max(0, max - min);
  await sleep(delaySeconds * 1000);

  if (myMessageId) {
    const { data: latestUserMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("agent_id", agent.id)
      .eq("contact_id", contact.id)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestUserMsg && latestUserMsg.id !== myMessageId) return;
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

  // Pastas de fotos cadastradas pra esse agente — só habilita a ferramenta de foto se houver
  // alguma (agente sem fotos, tipo o da Hanoi, roda sem tools, igual antes).
  const { data: mediaCats } = await supabase.from("agent_media").select("category").eq("agent_id", agent.id);
  const categories = [...new Set((mediaCats || []).map((m) => m.category))];
  const { mediaFolderNotes, maxBubbles, bubbleCharLimit } = agentConfig;
  const tools = categories.length ? buildAgentTools(categories, mediaFolderNotes) : [];
  const executor = categories.length ? makeToolExecutor(supabase, agent, channel, phone, contact.id) : undefined;

  const { data: knowledgeRows } = await supabase.from("agent_knowledge").select("file_name, content").eq("agent_id", agent.id);
  const knowledgeText = knowledgeRows?.length
    ? knowledgeRows.map((k) => `### ${k.file_name}\n${k.content}`).join("\n\n---\n\n")
    : undefined;

  const replyFn = agent.llm_provider === "gemini" ? generateReplyGemini : generateReply;
  const gen = await replyFn(
    agent.system_prompt,
    { name: contact.name, custom_fields: contact.custom_fields, missedOffHours: contact.missed_offhours },
    history,
    images,
    tools,
    executor,
    knowledgeText
  );
  const { needsHuman, collectedData, stage, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } = gen;

  // Corta qualquer bolha grande demais em pedaços de até `bubbleCharLimit` caracteres (regra de
  // código, não depende do modelo respeitar instrução de prompt) — só quando o agente permite mais de
  // 1 bolha; com "mensagem única" (maxBubbles=1) o texto sai inteiro, sem quebra nenhuma, já que tudo
  // ia ser rejuntado pelo capBubbles de qualquer forma (evita inserir quebra de linha à toa). Depois
  // aplica o teto de QUANTIDADE de bolhas (custo: a Meta cobra por mensagem enviada a partir de
  // 01/10/2026), juntando o excedente na última em vez de mandar cobrança extra.
  const preSplitParts = maxBubbles > 1 ? splitByCharLimit(gen.replyParts, bubbleCharLimit) : gen.replyParts;
  const replyParts = capBubbles(preSplitParts, maxBubbles);

  // Já recapitulou (ou tentou) a mensagem perdida fora do horário — não repete isso nas próximas respostas.
  if (contact.missed_offhours) await supabase.from("contacts").update({ missed_offhours: false }).eq("id", contact.id);

  if (Object.keys(collectedData).length) {
    // O prompt manda o agente copiar a opção exata da lista, mas o modelo varia caixa e acento
    // (minúscula, sem acento). Aqui a definição real do campo é a autoridade: puxa o valor pra
    // grafia cadastrada quando é claramente a mesma coisa. Sem isso cada variação vira uma categoria
    // a mais no relatório, que era exatamente o problema da planilha que o CRM veio substituir.
    const { data: defsRaw } = await supabase
      .from("custom_field_defs")
      .select("key, type, options")
      .eq("workspace_id", agent.workspace_id);

    const defs = new Map(
      (defsRaw ?? []).map((d) => [
        d.key,
        { type: (d.type ?? "texto") as CustomFieldType, options: parseOptions(d.options) },
      ])
    );

    const normalizado: Record<string, string> = {};
    for (const [k, v] of Object.entries(collectedData)) {
      const def = defs.get(k.trim());
      normalizado[k] = def ? canonicalizeValue(def, v) : v;
    }

    const merged = { ...((contact.custom_fields as Record<string, unknown>) || {}), ...normalizado };
    const updates: Record<string, unknown> = { custom_fields: merged };

    // "nome" e "email" são tratados à parte: também viram os campos principais do lead (aparecem em
    // Contatos, CRM, Conversas), não só um campo dentro de custom_fields — sincroniza a cada atualização.
    // "telefone" fica de fora de propósito: contact.phone já é o número real do WhatsApp de origem,
    // sobrescrever com o que o agente ouviu poderia divergir do número que a gente realmente usa pra enviar.
    const findKey = (name: string) => Object.keys(normalizado).find((k) => k.trim().toLowerCase() === name);

    const nomeKey = findKey("nome");
    if (nomeKey && normalizado[nomeKey]) updates.name = normalizado[nomeKey];

    const emailKey = findKey("email");
    const emailValue = emailKey ? normalizado[emailKey].trim() : "";
    if (emailValue && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) updates.email = emailValue;

    await supabase.from("contacts").update(updates).eq("id", contact.id);

    // Roteamento por território: descobriu a cidade na conversa, o lead cai no vendedor daquela
    // praça sozinho. Só vale pra lead SEM dono — reatribuir um lead que alguém já pegou seria
    // arrancar o atendimento de quem está falando com o cliente agora.
    if (!contact.team_member_id) {
      const { data: wsRow } = await supabase.from("workspaces").select("city_field_key").eq("id", agent.workspace_id).maybeSingle();
      const cidade = wsRow?.city_field_key ? merged[wsRow.city_field_key] : null;
      if (cidade) {
        const { data: territorio } = await supabase
          .from("territories")
          .select("team_member_id, branch_id")
          .eq("workspace_id", agent.workspace_id)
          .eq("city_key", normalizeCity(String(cidade)))
          .maybeSingle();
        if (territorio?.team_member_id) {
          const patch: Record<string, unknown> = { team_member_id: territorio.team_member_id };
          if (territorio.branch_id) patch.branch_id = territorio.branch_id;
          await supabase.from("contacts").update(patch).eq("id", contact.id);
        }
      }
    }
  }

  // O agente classifica o estágio do funil a cada resposta — só avança o card no Kanban, nunca regride
  // (evita flicker por ruído do modelo), exceto pros estados terminais (concluído/descartado).
  if (stage && canAdvanceStage(contact.stage, stage)) {
    const patch: Record<string, unknown> = { stage, stage_changed_at: new Date().toISOString() };

    // Se o lead está num funil personalizado, o card também precisa andar LÁ. O agente continua
    // falando o vocabulário fixo dos 7 sinais (é o que ele acerta); a tradução pro nome que aquele
    // cliente deu à etapa acontece aqui. Funil sem etapa pro sinal cai na anterior mais próxima —
    // nunca joga o lead pra frente do que ele realmente é.
    if (contact.pipeline_id) {
      const { data: etapas } = await supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, name, signal, position")
        .eq("pipeline_id", contact.pipeline_id)
        .order("position");
      const alvo = stageForSignal(
        stage,
        (etapas ?? []).map((e) => ({
          id: e.id,
          pipeline_id: e.pipeline_id,
          name: e.name,
          signal: (isContactStage(e.signal) ? e.signal : "abordado") as ContactStage,
          position: e.position,
        }))
      );
      if (alvo) patch.pipeline_stage_id = alvo.id;
    }

    await supabase.from("contacts").update(patch).eq("id", contact.id);
  }

  if (replyParts.length > 0) {
    // O agente respondeu — não marca atenção humana mesmo que ele tenha sido cauteloso no texto.
    // "Precisa de atenção" fica só pros casos em que ele realmente NÃO conseguiu responder (abaixo).

    // O agente sinalizou [[PRECISA_HUMANO]] mas continuou respondendo normalmente (nunca revela isso
    // ao cliente) — só acende um alerta em Conversas pra equipe revisar, sem mutar o agente.
    if (needsHuman) {
      await supabase
        .from("contacts")
        .update({ flagged_reason: "O agente sinalizou que essa conversa pode precisar de atenção humana." })
        .eq("id", contact.id);
    }

    // Cada "ideia" vira uma bolha separada (mesma geração da Anthropic — custo de token já contabilizado
    // abaixo só na primeira, pra não somar o mesmo gasto várias vezes). Intervalo curto entre bolhas
    // imita alguém mandando mensagens seguidas, diferente do delay de "pensar" antes da primeira.
    for (let i = 0; i < replyParts.length; i++) {
      const part = replyParts[i];
      await supabase.from("messages").insert({
        workspace_id: agent.workspace_id,
        contact_id: contact.id,
        agent_id: agent.id,
        role: "assistant",
        content: part,
        input_tokens: i === 0 ? inputTokens : null,
        output_tokens: i === 0 ? outputTokens : null,
        cache_creation_input_tokens: i === 0 ? cacheCreationInputTokens : null,
        cache_read_input_tokens: i === 0 ? cacheReadInputTokens : null,
      });

      await agentSendText(channel, phone, part).catch((err) =>
        console.error("Erro ao enviar resposta do agente:", err)
      );

      if (i < replyParts.length - 1) await sleep(BUBBLE_GAP_MS + Math.random() * BUBBLE_GAP_JITTER_MS);
    }
  } else {
    // Só aqui é atenção humana de verdade: o agente não produziu nenhuma resposta.
    await supabase
      .from("contacts")
      .update({ needs_attention: true, attention_reason: "O agente não conseguiu responder automaticamente essa mensagem." })
      .eq("id", contact.id);
  }
}
