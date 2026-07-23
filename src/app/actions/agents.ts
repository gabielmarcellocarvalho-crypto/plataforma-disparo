"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createInstance, setWebhook, fetchQrCode, fetchInstanceInfo, agentInstanceNameFor } from "@/lib/evolution";
import { buildSystemPrompt, normalizeAgentConfig, type AgentConfig } from "@/lib/agent-prompt";
import { extractKnowledgeText } from "@/lib/agent-knowledge";
import { MAX_TOTAL_CHARS } from "@/lib/agent-knowledge-limits";

export type CreateAgentState = { error: string | null; ok?: boolean };

export async function createAgent(_prevState: CreateAgentState, formData: FormData): Promise<CreateAgentState> {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome do agente." };

  const config = normalizeAgentConfig({
    companyName: String(formData.get("company_name") || "").trim(),
    businessType: String(formData.get("business_type") || "").trim(),
  });

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  // Gera o id no client pra já mandar o evolution_instance_name (derivado do id) no mesmo insert —
  // a coluna é NOT NULL, não dá pra criar a linha e só depois preencher.
  const agentId = crypto.randomUUID();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      id: agentId,
      workspace_id: workspace.id,
      name,
      system_prompt: buildSystemPrompt(config),
      config,
      evolution_instance_name: agentInstanceNameFor(agentId),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Não foi possível criar o agente." };

  revalidatePath("/agentes");
  return { error: null, ok: true };
}

export type ConnectResult = { error: string | null; qrcodeBase64?: string | null };

export async function connectAgent(agentId: string): Promise<ConnectResult> {
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };

  try {
    const { qrcodeBase64 } = await createInstance(agent.evolution_instance_name);
    await setWebhook(agent.evolution_instance_name).catch(() => null);

    await supabase.from("agents").update({ connection_status: "conectando" }).eq("id", agentId);

    let qr = qrcodeBase64;
    if (!qr) qr = await fetchQrCode(agent.evolution_instance_name).catch(() => null);

    revalidatePath("/agentes");
    return { error: null, qrcodeBase64: qr };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function refreshAgentStatus(agentId: string) {
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle();
  if (!agent) return;

  try {
    const { connectionStatus, phoneNumber, photoUrl } = await fetchInstanceInfo(agent.evolution_instance_name);
    await supabase
      .from("agents")
      .update({ connection_status: connectionStatus, phone_number: phoneNumber, photo_url: photoUrl })
      .eq("id", agentId);
  } catch {
    // instância pode não existir ainda — ignora, status no banco fica como está
  }

  revalidatePath("/agentes");
}

// O prompt final vem explícito (o operador pode editar o texto gerado à mão antes de salvar) —
// nunca recalculamos por conta própria aqui, senão uma edição manual seria perdida na próxima save.
export async function updateAgentConfig(agentId: string, rawConfig: AgentConfig, systemPrompt: string): Promise<{ error: string | null }> {
  const config = normalizeAgentConfig(rawConfig);
  const prompt = systemPrompt.trim();
  if (!prompt) return { error: "O prompt final não pode ficar vazio." };

  const supabase = await createClient();
  const { error } = await supabase.from("agents").update({ config, system_prompt: prompt }).eq("id", agentId);
  if (error) return { error: "Não foi possível salvar a configuração." };
  revalidatePath("/agentes");
  revalidatePath(`/agentes/${agentId}`);
  return { error: null };
}

export async function toggleAgentStatus(agentId: string, status: "ativo" | "pausado") {
  const supabase = await createClient();
  await supabase.from("agents").update({ status }).eq("id", agentId);
  revalidatePath("/agentes");
}

export async function addAgentMedia(
  agentId: string,
  category: string,
  url: string,
  caption: string
): Promise<{ error: string | null }> {
  const cat = category.trim();
  const link = url.trim();
  if (!cat || !link) return { error: "Categoria e URL são obrigatórias." };
  if (!/^https?:\/\//i.test(link)) return { error: "A URL precisa começar com http:// ou https://." };

  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("workspace_id").eq("id", agentId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };

  const { error } = await supabase.from("agent_media").insert({
    agent_id: agentId,
    workspace_id: agent.workspace_id,
    category: cat,
    url: link,
    caption: caption.trim() || null,
  });
  if (error) return { error: "Não foi possível salvar a foto." };

  revalidatePath("/agentes");
  return { error: null };
}

export async function deleteAgentMedia(mediaId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("agent_media").delete().eq("id", mediaId);
  if (error) return { error: "Não foi possível remover a foto." };
  revalidatePath("/agentes");
  return { error: null };
}

export type UploadMediaResult = { error: string | null; count?: number };

// Upload em massa: joga várias fotos de uma vez numa "pasta" (categoria). Sobe cada arquivo pro
// Supabase Storage (bucket público agent-media) e grava a URL na biblioteca do agente.
export async function uploadAgentMedia(agentId: string, category: string, formData: FormData): Promise<UploadMediaResult> {
  const cat = category.trim();
  if (!cat) return { error: "Dê um nome pra pasta (categoria)." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Selecione pelo menos uma foto." };

  const supabase = await createClient();
  // Valida acesso pelo client do usuário (RLS): se não enxerga o agente, não sobe nada.
  const { data: agent } = await supabase.from("agents").select("workspace_id").eq("id", agentId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };

  const admin = createAdminClient();
  let count = 0;
  for (const file of files) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const mediaType = isPdf ? "document" : "image";
    const ext = (file.name.split(".").pop() || (isPdf ? "pdf" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${agentId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from("agent-media").upload(path, file, {
      contentType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
      upsert: false,
    });
    if (upErr) {
      console.error("Erro no upload de arquivo:", upErr.message);
      continue;
    }
    const { data: pub } = admin.storage.from("agent-media").getPublicUrl(path);
    const { error: insErr } = await admin.from("agent_media").insert({
      agent_id: agentId,
      workspace_id: agent.workspace_id,
      category: cat,
      url: pub.publicUrl,
      caption: null,
      media_type: mediaType,
      file_name: isPdf ? file.name : null,
    });
    if (!insErr) count++;
  }

  if (count === 0) return { error: "Não foi possível subir as fotos." };
  revalidatePath("/agentes");
  return { error: null, count };
}

export type UploadKnowledgeResult = { error: string | null; count?: number };

// Material de estudo (PDF/planilha/texto) — extrai o texto e guarda como contexto do agente.
// Nunca é enviado ao cliente; só entra num bloco extra do prompt (ver src/lib/agent-reply.ts).
export async function uploadAgentKnowledge(agentId: string, formData: FormData): Promise<UploadKnowledgeResult> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Selecione pelo menos um arquivo." };

  const supabase = await createClient();
  const [{ data: agent }, { data: existing }] = await Promise.all([
    supabase.from("agents").select("workspace_id").eq("id", agentId).maybeSingle(),
    supabase.from("agent_knowledge").select("char_count").eq("agent_id", agentId),
  ]);
  if (!agent) return { error: "Agente não encontrado." };

  let totalChars = (existing || []).reduce((sum, r) => sum + r.char_count, 0);
  let count = 0;
  const errors: string[] = [];
  for (const file of files) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      errors.push(`${file.name}: limite total de material de estudo desse agente já foi atingido (~${Math.round(MAX_TOTAL_CHARS / 1000)}k caracteres). Remova algo antes de adicionar mais.`);
      continue;
    }
    const { text, error } = await extractKnowledgeText(file);
    if (error || !text) {
      errors.push(`${file.name}: ${error || "vazio"}`);
      continue;
    }
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const finalText = text.length > remaining ? text.slice(0, remaining) + "\n\n[conteúdo truncado — limite total do agente]" : text;
    const { error: insErr } = await supabase.from("agent_knowledge").insert({
      agent_id: agentId,
      workspace_id: agent.workspace_id,
      file_name: file.name,
      content: finalText,
      char_count: finalText.length,
    });
    if (!insErr) {
      count++;
      totalChars += finalText.length;
    } else errors.push(`${file.name}: erro ao salvar`);
  }

  if (count === 0) return { error: errors.join("; ") || "Não foi possível processar os arquivos." };
  revalidatePath("/agentes");
  revalidatePath(`/agentes/${agentId}`);
  return { error: errors.length ? errors.join("; ") : null, count };
}

export async function deleteAgentKnowledge(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("agent_knowledge").delete().eq("id", id);
  if (error) return { error: "Não foi possível remover." };
  revalidatePath("/agentes");
  return { error: null };
}

export async function updateAgentDelay(agentId: string, minSeconds: number, maxSeconds: number): Promise<{ error: string | null }> {
  if (minSeconds < 0 || maxSeconds < minSeconds) return { error: "Intervalo de delay inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .update({ reply_delay_min_seconds: minSeconds, reply_delay_max_seconds: maxSeconds })
    .eq("id", agentId);
  if (error) return { error: "Não foi possível salvar o delay." };
  revalidatePath("/agentes");
  return { error: null };
}
