"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getCurrentUserName } from "@/lib/workspace";
import { normalizePhone, parseContactsFile } from "@/lib/import-contacts";
import { isContactStage, STAGE_ORDER, HIDEABLE_STAGES, type ContactStage } from "@/lib/crm-stages";
import { buildCustomFields } from "@/lib/custom-fields";
import { LOST_STAGE } from "@/lib/lost-reasons";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";

export type ActionResult = { error: string | null; ok?: boolean };

// Se o workspace tem exatamente 1 número de disparo, todo contato novo já nasce ligado a ele —
// mantém o seletor Vendas/Financeiro correto sem precisar de escolha manual enquanto só existe 1
// número. Com 0 ou 2+ números, fica sem contexto (null) — 2+ instâncias ainda não tem seletor de
// escolha no formulário de contato, fica pra quando o segundo número (financeiro) entrar de verdade.
async function soleWhatsappInstanceId(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string): Promise<string | null> {
  const { data } = await supabase.from("whatsapp_instances").select("id").eq("workspace_id", workspaceId);
  return data && data.length === 1 ? data[0].id : null;
}

export async function addContact(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  const phoneRaw = String(formData.get("phone") || "").trim();
  const email = String(formData.get("email") || "").trim();

  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { error: "Telefone inválido." };
  if (!phone && !email) return { error: "Informe telefone ou e-mail." };

  const supabase = await createClient();
  const whatsappInstanceId = await soleWhatsappInstanceId(supabase, workspace.id);
  const { error } = await supabase.from("contacts").insert({
    workspace_id: workspace.id,
    name: name || null,
    phone,
    email: email || null,
    whatsapp_instance_id: whatsappInstanceId,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe um contato com esse telefone/e-mail neste workspace." };
    return { error: error.message };
  }

  revalidatePath("/contatos");
  return { error: null, ok: true };
}

export type ImportResult = {
  error: string | null;
  imported?: number;
  skippedDuplicate?: number;
  skippedInvalid?: number;
  total?: number;
};

export async function importContacts(_prevState: ImportResult, formData: FormData): Promise<ImportResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Selecione um arquivo." };

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseContactsFile(buffer);
  } catch (err) {
    return { error: `Não consegui ler o arquivo: ${(err as Error).message}` };
  }
  if (parsed.error) return { error: parsed.error };
  if (parsed.contacts.length === 0) return { error: "Nenhum contato válido encontrado na planilha." };

  const supabase = await createClient();
  const whatsappInstanceId = await soleWhatsappInstanceId(supabase, workspace.id);
  // E-mail repetido na planilha (ex.: mesma administradora/empresa em várias linhas) bate na
  // constraint de e-mail único por workspace — como o upsert só resolve conflito por telefone
  // (onConflict abaixo), um e-mail repetido derruba o LOTE INTEIRO de 500, não só a linha. Zera o
  // e-mail das repetições (mantém o contato pelo telefone, que é único e válido) em vez de perder
  // o lote inteiro por causa disso.
  const seenEmails = new Set<string>();
  const rows = parsed.contacts.map((c) => {
    let email = c.email || null;
    if (email) {
      if (seenEmails.has(email)) email = null;
      else seenEmails.add(email);
    }
    return {
      workspace_id: workspace.id,
      name: c.name || null,
      phone: c.phone,
      email,
      whatsapp_instance_id: whatsappInstanceId,
    };
  });

  // Upsert ignorando duplicados (telefone único por workspace), em lotes de 500. Lotes rodam em
  // grupos de até 5 em paralelo (não um por um) — sequencial puro é lento demais pra planilha grande
  // (11 mil contatos = 22 lotes; um por um passa fácil do tempo de execução da function e a
  // importação morre no meio sem terminar). Um lote com erro não aborta os outros — junta o que deu
  // certo e reporta o problema no final, em vez de perder uma importação grande por causa de 1 lote ruim.
  const BATCH_SIZE = 500;
  const CONCURRENCY = 5;
  const batches: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  let imported = 0;
  const batchErrors: string[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      group.map((batch) =>
        supabase.from("contacts").upsert(batch, { onConflict: "workspace_id,phone", ignoreDuplicates: true, count: "exact" })
      )
    );
    for (const { error, count } of results) {
      if (error) batchErrors.push(error.message);
      else imported += count ?? 0;
    }
  }

  if (batchErrors.length > 0) console.error(`importContacts: ${batchErrors.length} lote(s) falharam:`, batchErrors);
  if (imported === 0 && batchErrors.length > 0) return { error: `Erro ao importar: ${batchErrors[0]}` };

  revalidatePath("/contatos");
  return {
    error: null,
    imported,
    skippedDuplicate: rows.length - imported,
    skippedInvalid: parsed.skippedNoPhoneOrEmail,
    total: parsed.total,
  };
}

// Mover o card manualmente no Kanban — vale pra contato de qualquer canal (agente, disparo em
// massa ou e-mail), já que o estágio é um campo só, compartilhado.
//
// `lostReason` só é aceito quando o destino é a fase de perda. Sair dela LIMPA o motivo: um lead que
// voltou a ser trabalhado com "perdemos por preço" pendurado envenenaria o relatório de perdas.
export async function updateContactStage(contactId: string, stage: string, lostReason?: string | null): Promise<ActionResult> {
  if (!isContactStage(stage)) return { error: "Estágio inválido." };
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const patch: Record<string, unknown> = { stage, stage_changed_at: new Date().toISOString() };
  patch.lost_reason = stage === LOST_STAGE ? (lostReason?.trim() || null) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update(patch).eq("id", contactId).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível mover o contato." };

  revalidatePath("/crm");
  revalidatePath("/conversas");
  revalidatePath("/metricas");
  return { error: null, ok: true };
}

// Preencher/corrigir o motivo sem mexer na fase — usado quando o lead já está em perda e alguém
// só quer registrar o porquê depois.
export async function updateContactLostReason(contactId: string, lostReason: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ lost_reason: lostReason.trim().slice(0, 60) || null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar o motivo." };

  revalidatePath("/crm");
  revalidatePath("/metricas");
  return { error: null, ok: true };
}

// Lista de motivos aceitos nesse workspace. Vazia volta pro padrão de fábrica na leitura.
export async function updateLostReasons(workspaceId: string, reasons: string[]): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return { error: "Nenhum workspace ativo." };

  const limpos: string[] = [];
  const vistos = new Set<string>();
  for (const r of reasons) {
    const s = String(r ?? "").trim().slice(0, 60);
    if (!s || vistos.has(s)) continue;
    vistos.add(s);
    limpos.push(s);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ lost_reasons: limpos }).eq("id", workspaceId);
  if (error) return { error: "Não foi possível salvar os motivos." };

  revalidatePath("/crm");
  revalidatePath("/metricas");
  return { error: null, ok: true };
}

// Atribui/remove o vendedor responsável por um lead (só faz sentido em plano com SDR — quem entrega
// o handoff pra um humano). userId vazio limpa a atribuição.
export async function updateContactResponsible(contactId: string, userId: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ responsible_user_id: userId || null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atribuir o responsável." };

  revalidatePath("/crm");
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Renomeia os rótulos do funil pra esse workspace (o sinal interno que o agente classifica não muda,
// só o texto exibido) e escolhe quais das 3 fases opcionais do meio ficam visíveis — as 4 âncoras
// (não abordado, abordado, concluído, descartado) nunca podem ser escondidas.
export async function updateCrmStageSettings(
  workspaceId: string,
  labels: Record<string, string>,
  hiddenStages: string[]
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return { error: "Nenhum workspace ativo." };

  const cleanLabels: Record<string, string> = {};
  for (const stage of STAGE_ORDER) {
    const v = labels[stage];
    if (typeof v === "string" && v.trim()) cleanLabels[stage] = v.trim().slice(0, 40);
  }
  const cleanHidden = hiddenStages.filter((s): s is ContactStage => (HIDEABLE_STAGES as string[]).includes(s));

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ crm_stage_labels: cleanLabels, crm_hidden_stages: cleanHidden })
    .eq("id", workspaceId);
  if (error) return { error: "Não foi possível salvar as fases." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}

export type ContactDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  stage: string;
  stage_changed_at: string;
  custom_fields: Record<string, unknown> | null;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  created_at: string;
  message_count: number;
  company_id: string | null;
  company_name: string | null;
  // Atribuição na rede do cliente (vendedor/filial sem login) — ver actions/team.ts.
  team_member_id: string | null;
  branch_id: string | null;
  lost_reason: string | null;
};
export type ContactNote = { id: string; author_name: string | null; content: string; created_at: string };

// Puxa o contato + histórico de observações pro painel de detalhe do CRM (aberto ao clicar no card).
export async function getContactDetail(contactId: string): Promise<{ contact: ContactDetail; notes: ContactNote[] } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const supabase = await createClient();
  const [{ data: contact }, { data: notes }, { count: messageCount }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, name, phone, email, photo_url, stage, stage_changed_at, custom_fields, needs_attention, attention_reason, flagged_reason, created_at, company_id, team_member_id, branch_id, lost_reason, companies(name)"
      )
      .eq("id", contactId)
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("contact_notes")
      .select("id, author_name, content, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id),
  ]);
  if (!contact) return null;

  const { companies, ...contactFields } = contact as typeof contact & { companies: { name: string } | null };
  return {
    contact: { ...contactFields, company_name: companies?.name ?? null, message_count: messageCount ?? 0 },
    notes: notes || [],
  };
}

// Edição manual de "infos pessoais" — nome/telefone/e-mail e os campos personalizados.
//
// `customFields` são os campos COM definição (migration 0063): validados aqui contra o esquema do
// workspace, não só no cliente — Server Action é chamável direto, sem passar pelo formulário.
// `extraFields` são pares chave/valor sem definição: o formato antigo, mais o que o agente de IA
// grava sozinho via [[DADOS: chave=valor]]. Continuam sendo aceitos pra não perder dado do cliente.
export async function updateContactInfo(
  contactId: string,
  fields: {
    name: string;
    phone: string;
    email: string;
    customFields: Record<string, string | string[]>;
    extraFields?: Record<string, string>;
  }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const phone = fields.phone.trim() ? normalizePhone(fields.phone) : null;
  if (fields.phone.trim() && !phone) return { error: "Telefone inválido." };

  const defs = await listCustomFieldDefs();
  const { values: cleanFields, error: fieldError } = buildCustomFields(defs, fields.customFields, fields.extraFields ?? {});
  if (fieldError) return { error: fieldError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({
      name: fields.name.trim() || null,
      phone,
      email: fields.email.trim() || null,
      custom_fields: cleanFields,
    })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) {
    if (error.code === "23505") return { error: "Já existe outro contato com esse telefone/e-mail." };
    return { error: "Não foi possível salvar." };
  }

  revalidatePath("/crm");
  revalidatePath("/contatos");
  return { error: null, ok: true };
}

// Observação interna do time — vira uma linha no histórico, nunca some/sobrescreve a anterior.
export async function addContactNote(contactId: string, content: string): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Escreva alguma coisa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const authorName = await getCurrentUserName();
  const supabase = await createClient();
  const { error } = await supabase.from("contact_notes").insert({
    contact_id: contactId,
    workspace_id: workspace.id,
    author_name: authorName,
    content: trimmed,
  });
  if (error) return { error: "Não foi possível salvar a observação." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}

// Exclusão de leads em massa (Contatos → selecionar → excluir). Apaga a LINHA de `contacts`, e o
// resto some junto pelas FKs `on delete cascade` que já existem no banco: mensagens, fila de
// campanha (campaign_recipients), observações, mídia já enviada, matrícula em sequência de e-mail,
// ticket de atendimento e matrícula em workflow. O card do Pipeline não é um registro separado — o
// estágio é coluna do próprio contato — então sumir do /crm é consequência direta, sem passo extra.
//
// Tarefa é a única exceção: a FK é `on delete set null`, então tarefa que era SÓ desse contato
// viraria item órfão na Agenda ("ligar pro João" sem João). Essas a gente apaga explicitamente
// antes; a que também aponta pra uma empresa fica de pé, perdendo só o vínculo com o contato.
export async function deleteContacts(ids: string[]): Promise<ActionResult & { deleted?: number }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { error: "Nenhum contato selecionado." };

  const supabase = await createClient();

  // Nunca mandar a seleção inteira num `.in()` só: com algumas centenas de ids a URL do PostgREST
  // estoura o limite do servidor e a chamada falha (mesma armadilha que deixava /conversas vazia).
  const CHUNK = 100;
  let deleted = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);

    await supabase
      .from("tasks")
      .delete()
      .eq("workspace_id", workspace.id)
      .is("company_id", null)
      .in("contact_id", chunk);

    // `workspace_id` no filtro não é redundância: garante que um id de outro workspace passado na
    // mão pela request não apaga nada, mesmo antes da RLS.
    const { data, error } = await supabase
      .from("contacts")
      .delete()
      .eq("workspace_id", workspace.id)
      .in("id", chunk)
      .select("id");
    if (error) return { error: "Não foi possível excluir os contatos selecionados." };
    deleted += data?.length ?? 0;
  }

  for (const path of ["/contatos", "/crm", "/conversas", "/empresas", "/agenda", "/metricas", "/"]) {
    revalidatePath(path);
  }
  return { error: null, ok: true, deleted };
}
