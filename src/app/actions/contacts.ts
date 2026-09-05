"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getCurrentUserName } from "@/lib/workspace";
import {
  normalizePhone,
  inspectSheet,
  suggestMapping,
  parseWithMapping,
  type ImportTarget,
  type SheetPreview,
} from "@/lib/import-contacts";
import { isContactStage, STAGE_ORDER, HIDEABLE_STAGES, resolveStageLabels, type ContactStage } from "@/lib/crm-stages";
import { normalizeCity } from "@/lib/territories";
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
  updated?: number;
  skippedDuplicate?: number;
  skippedInvalid?: number;
  total?: number;
  // Nome de vendedor/filial que veio na planilha e não bate com nenhum cadastro — devolvido pra
  // quem importou consertar, em vez de sumir em silêncio.
  unmatchedResponsaveis?: string[];
  unmatchedFiliais?: string[];
  newOptions?: number;
  // Quantos leads ganharam vendedor pelo mapa de territórios (a planilha não trazia responsável).
  roteadosPorTerritorio?: number;
};

// Passo 1 do importador: lê o arquivo e devolve abas, cabeçalhos, uma amostra e um de/para chutado.
// Nada é gravado aqui — é só pra montar a tela de mapeamento.
export async function inspectImportFile(formData: FormData): Promise<SheetPreview & { suggestion: Record<string, ImportTarget> }> {
  const vazio = { sheets: [], sheet: "", headers: [], sample: [], total: 0, suggestion: {} };
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { ...vazio, error: "Nenhum workspace ativo." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ...vazio, error: "Selecione um arquivo." };
  const sheetName = String(formData.get("sheet") || "") || undefined;

  let preview: SheetPreview;
  try {
    preview = inspectSheet(Buffer.from(await file.arrayBuffer()), sheetName);
  } catch (err) {
    return { ...vazio, error: `Não consegui ler o arquivo: ${(err as Error).message}` };
  }
  if (preview.error) return { ...preview, suggestion: {} };

  const defs = await listCustomFieldDefs();
  return { ...preview, suggestion: suggestMapping(preview.headers, defs) };
}

const semAcento = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Passo 2: importa de verdade, com o de/para confirmado na tela.
//
// O arquivo é reenviado em vez de ficar guardado entre os dois passos — Server Action não tem
// sessão onde pendurar um upload, e um cache de arquivo por usuário seria estado pra manter e
// expirar sem necessidade nenhuma.
export async function importContacts(_prevState: ImportResult, formData: FormData): Promise<ImportResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Selecione um arquivo." };

  const sheetName = String(formData.get("sheet") || "");
  const modo = String(formData.get("mode") || "ignorar") === "atualizar" ? "atualizar" : "ignorar";

  let mapping: Record<string, ImportTarget>;
  try {
    mapping = JSON.parse(String(formData.get("mapping") || "{}"));
  } catch {
    return { error: "Mapeamento inválido." };
  }

  let parsed;
  try {
    parsed = parseWithMapping(Buffer.from(await file.arrayBuffer()), sheetName, mapping);
  } catch (err) {
    return { error: `Não consegui ler o arquivo: ${(err as Error).message}` };
  }
  if (parsed.error) return { error: parsed.error };
  if (parsed.rows.length === 0) return { error: "Nenhuma linha com telefone ou e-mail nessa aba." };

  const supabase = await createClient();
  const [defs, { data: team }, { data: branches }, { data: wsRow }] = await Promise.all([
    listCustomFieldDefs(),
    supabase.from("team_members").select("id, name").eq("workspace_id", workspace.id),
    supabase.from("branches").select("id, name").eq("workspace_id", workspace.id),
    supabase.from("workspaces").select("crm_stage_labels, city_field_key").eq("id", workspace.id).maybeSingle(),
  ]);

  const teamPorNome = new Map((team ?? []).map((m) => [semAcento(m.name), m.id]));
  const filialPorNome = new Map((branches ?? []).map((b) => [semAcento(b.name), b.id]));

  // Mapa de territórios: lead que chega sem vendedor na planilha, mas com cidade, cai no dono
  // daquela praça. É o mesmo roteamento que roda quando o agente descobre a cidade na conversa.
  const cityFieldKey = wsRow?.city_field_key ?? null;
  const territorios = new Map<string, { team_member_id: string | null; branch_id: string | null }>();
  if (cityFieldKey) {
    const { data: rotas } = await supabase
      .from("territories")
      .select("city_key, team_member_id, branch_id")
      .eq("workspace_id", workspace.id);
    for (const r of rotas ?? []) territorios.set(r.city_key, { team_member_id: r.team_member_id, branch_id: r.branch_id });
  }

  // Etapa aceita tanto a chave interna ("descartado") quanto o rótulo que o cliente vê
  // ("Finalizado sem compra") — quem exporta de uma planilha escreve o rótulo, não a chave.
  const stageLabels = resolveStageLabels(wsRow?.crm_stage_labels);
  const stagePorTexto = new Map<string, ContactStage>();
  for (const s of STAGE_ORDER) {
    stagePorTexto.set(s, s);
    stagePorTexto.set(semAcento(stageLabels[s]), s);
  }

  const defPorKey = new Map(defs.map((d) => [d.key, d]));
  const unmatchedResponsaveis = new Set<string>();
  const unmatchedFiliais = new Set<string>();
  // Valor de lista que a planilha traz e o campo ainda não conhece. Importar 76 cidades num campo
  // com 3 opções cadastradas deixaria o filtro inútil, então a lista cresce junto com o dado.
  const novasOpcoes = new Map<string, Set<string>>();
  let roteados = 0;

  const linhas = parsed.rows.map((r) => {
    const custom: Record<string, string> = {};
    for (const [key, valor] of Object.entries(r.campos)) {
      const def = defPorKey.get(key);
      if (!def) continue;
      custom[key] = valor;
      if ((def.type === "selecao" || def.type === "selecao_multipla") && !def.options.includes(valor)) {
        if (!novasOpcoes.has(key)) novasOpcoes.set(key, new Set());
        novasOpcoes.get(key)!.add(valor);
      }
    }

    let teamMemberId: string | null = null;
    if (r.responsavel) {
      teamMemberId = teamPorNome.get(semAcento(r.responsavel)) ?? null;
      if (!teamMemberId) unmatchedResponsaveis.add(r.responsavel);
    }
    let branchId: string | null = null;
    if (r.filial) {
      branchId = filialPorNome.get(semAcento(r.filial)) ?? null;
      if (!branchId) unmatchedFiliais.add(r.filial);
    }

    if (!teamMemberId && cityFieldKey && custom[cityFieldKey]) {
      const rota = territorios.get(normalizeCity(custom[cityFieldKey]));
      if (rota?.team_member_id) {
        teamMemberId = rota.team_member_id;
        roteados++;
        if (!branchId) branchId = rota.branch_id;
      }
    }

    const stage = r.etapa ? stagePorTexto.get(semAcento(r.etapa)) ?? null : null;

    return {
      name: r.name || null,
      phone: r.phone,
      email: r.email || null,
      custom_fields: custom,
      team_member_id: teamMemberId,
      branch_id: branchId,
      stage,
      lost_reason: r.motivoPerda || null,
    };
  });

  // Cresce a lista de opções ANTES de gravar os leads: se o import falhar depois, sobra uma opção a
  // mais numa lista (inofensivo), e não um lead com valor que o formulário recusa.
  for (const [key, valores] of novasOpcoes) {
    const def = defPorKey.get(key)!;
    await supabase
      .from("custom_field_defs")
      .update({ options: [...def.options, ...valores], updated_at: new Date().toISOString() })
      .eq("id", def.id)
      .eq("workspace_id", workspace.id);
  }

  const whatsappInstanceId = await soleWhatsappInstanceId(supabase, workspace.id);

  // E-mail repetido na planilha (ex.: mesma administradora em várias linhas) bate na constraint de
  // e-mail único por workspace — como o upsert só resolve conflito por telefone, um e-mail repetido
  // derrubaria o LOTE INTEIRO, não só a linha. Zera o e-mail das repetições.
  const emailsVistos = new Set<string>();

  // No modo "atualizar", o custom_fields do lead que já existe é MESCLADO com o da planilha em vez
  // de substituído: a planilha costuma trazer só algumas colunas, e sobrescrever apagaria o que foi
  // preenchido na plataforma depois.
  const existentes = new Map<string, { id: string; custom_fields: Record<string, unknown> | null }>();
  if (modo === "atualizar") {
    let offset = 0;
    for (;;) {
      const { data } = await supabase
        .from("contacts")
        .select("id, phone, custom_fields")
        .eq("workspace_id", workspace.id)
        .not("phone", "is", null)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const c of data) if (c.phone) existentes.set(c.phone, { id: c.id, custom_fields: c.custom_fields });
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  const rows = linhas.map((l) => {
    let email = l.email;
    if (email) {
      if (emailsVistos.has(email)) email = null;
      else emailsVistos.add(email);
    }
    const jaExiste = l.phone ? existentes.get(l.phone) : undefined;
    const custom = jaExiste ? { ...(jaExiste.custom_fields ?? {}), ...l.custom_fields } : l.custom_fields;

    const linha: Record<string, unknown> = {
      workspace_id: workspace.id,
      name: l.name,
      phone: l.phone,
      email,
      custom_fields: custom,
      team_member_id: l.team_member_id,
      branch_id: l.branch_id,
      lost_reason: l.lost_reason,
      whatsapp_instance_id: whatsappInstanceId,
    };
    // Etapa só entra quando a planilha mandou uma: sem isso, todo lead importado voltaria pra
    // "não abordado" a cada reimportação, desfazendo o trabalho do time no Kanban.
    if (l.stage) {
      linha.stage = l.stage;
      linha.stage_changed_at = new Date().toISOString();
    }
    return linha;
  });

  // O PostgREST recusa insert em massa quando os objetos do lote têm chaves diferentes
  // ("All object keys must match"), então stage/stage_changed_at precisam existir em TODA linha do
  // lote — os lotes são separados por presença de etapa em vez de preencher com um valor inventado.
  const comEtapa = rows.filter((r) => r.stage !== undefined);
  const semEtapa = rows.filter((r) => r.stage === undefined);

  const BATCH_SIZE = 500;
  let imported = 0;
  const batchErrors: string[] = [];

  for (const grupo of [comEtapa, semEtapa]) {
    for (let i = 0; i < grupo.length; i += BATCH_SIZE) {
      const lote = grupo.slice(i, i + BATCH_SIZE);
      const { error, count } = await supabase.from("contacts").upsert(lote, {
        onConflict: "workspace_id,phone",
        ignoreDuplicates: modo === "ignorar",
        count: "exact",
      });
      if (error) batchErrors.push(error.message);
      else imported += count ?? 0;
    }
  }

  if (batchErrors.length > 0) console.error(`importContacts: ${batchErrors.length} lote(s) falharam:`, batchErrors);
  if (imported === 0 && batchErrors.length > 0) return { error: `Erro ao importar: ${batchErrors[0]}` };

  for (const path of ["/contatos", "/crm", "/metricas"]) revalidatePath(path);

  const atualizados = modo === "atualizar" ? linhas.filter((l) => l.phone && existentes.has(l.phone)).length : 0;
  return {
    error: null,
    imported: imported - atualizados,
    updated: atualizados,
    skippedDuplicate: modo === "ignorar" ? linhas.length - imported : 0,
    skippedInvalid: parsed.skippedNoPhoneOrEmail,
    total: parsed.total,
    unmatchedResponsaveis: [...unmatchedResponsaveis].slice(0, 20),
    unmatchedFiliais: [...unmatchedFiliais].slice(0, 20),
    newOptions: [...novasOpcoes.values()].reduce((s, v) => s + v.size, 0),
    roteadosPorTerritorio: roteados,
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
