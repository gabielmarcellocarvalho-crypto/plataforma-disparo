"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createInstance, setWebhook, connectionState, fetchQrCode, instanceNameFor } from "@/lib/evolution";
import { setDialog360Webhook, listDialog360Templates, type Dialog360Template } from "@/lib/dialog360";
import {
  exchangeMetaCloudCode,
  subscribeMetaCloudWebhook,
  registerMetaCloudPhone,
  getMetaCloudPhoneInfo,
  listMetaCloudTemplates,
  updateMetaCloudProfilePhoto,
  getMetaCloudProfilePhotoUrl,
} from "@/lib/metacloud";
import { headers } from "next/headers";

export type ConnectResult = { error: string | null; qrcodeBase64?: string | null };

export async function connectWhatsapp(): Promise<ConnectResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const instanceName = instanceNameFor(workspace.id);
  const supabase = await createClient();

  try {
    const { qrcodeBase64 } = await createInstance(instanceName);
    await setWebhook(instanceName).catch(() => null); // webhook é best-effort, não trava a conexão

    await supabase.from("whatsapp_instances").upsert(
      { workspace_id: workspace.id, instance_name: instanceName, connection_status: "conectando" },
      { onConflict: "instance_name" }
    );

    let qr = qrcodeBase64;
    if (!qr) {
      // instância já existia — busca um QR novo pra reconectar
      qr = await fetchQrCode(instanceName).catch(() => null);
    }

    revalidatePath("/configuracoes");
    return { error: null, qrcodeBase64: qr };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type Dialog360ConnectResult = { error: string | null; ok?: boolean };

// Conecta (ou edita) um número via API oficial (360dialog) — diferente do Evolution, não tem QR
// code: a conta e o número já são configurados no painel do 360dialog, aqui só guardamos a API key e
// o phone_number_id (a Meta manda esse id em todo webhook, é como sabemos qual número recebeu a
// mensagem) e registramos a URL de callback. Workspace pode ter mais de uma instância 360dialog (ex.:
// Vendas + Financeiro) — por isso recebe `instanceId`: null cria um número novo (exige API key e
// phone_number_id), preenchido edita o número existente (campos em branco mantêm o valor salvo, só
// troca o que foi digitado — ex.: trocar só o departamento sem reenviar a API key).
export async function connectDialog360(
  instanceId: string | null,
  department: string,
  apiKey: string,
  phoneNumberId: string
): Promise<Dialog360ConnectResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  let key = apiKey.trim();
  let phoneId = phoneNumberId.trim();

  if (instanceId) {
    if (!key || !phoneId) {
      const { data: current } = await supabase
        .from("whatsapp_instances")
        .select("dialog360_api_key, phone_number_id")
        .eq("id", instanceId)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (!current) return { error: "Número não encontrado." };
      key = key || current.dialog360_api_key || "";
      phoneId = phoneId || current.phone_number_id || "";
    }
    if (!key || !phoneId) return { error: "Informe a API key e o phone number id." };

    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ department: department || "vendas", dialog360_api_key: key, phone_number_id: phoneId, connection_status: "conectado" })
      .eq("id", instanceId)
      .eq("workspace_id", workspace.id);
    if (error) return { error: `Não foi possível salvar: ${error.message}` };
  } else {
    if (!key || !phoneId) return { error: "Informe a API key e o phone number id." };

    const { error } = await supabase.from("whatsapp_instances").insert({
      workspace_id: workspace.id,
      department: department || "vendas",
      channel: "360dialog",
      dialog360_api_key: key,
      phone_number_id: phoneId,
      connection_status: "conectado",
    });
    if (error) return { error: `Não foi possível salvar: ${error.message}` };
  }

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || ""}`;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    await setDialog360Webhook(key, `${siteUrl}/api/webhook/dialog360?secret=${secret}`).catch((err) =>
      console.error("Falha ao registrar webhook no 360dialog (configure manualmente):", err)
    );
  }

  revalidatePath("/configuracoes");
  return { error: null, ok: true };
}

export type MetaCloudConnectResult = { error: string | null; ok?: boolean };

// Finaliza a conexão de um número via Embedded Signup (Tech Provider direto, sem 360dialog no meio).
// waba_id/phone_number_id chegam do postMessage que o popup da Meta manda pro navegador — não dá pra
// confiar cegamente nisso vindo do client (poderia ser forjado), então antes de gravar: (1) troca o
// `code` do FB.login por token, provando que veio do fluxo real de OAuth da Meta, e (2) chama a Graph
// API com o token de System User da própria AutomaX pra confirmar que esse WABA/número é acessível de
// verdade — se não for, a chamada falha e nada é salvo.
export async function connectMetaCloudInstance(
  wabaId: string,
  phoneNumberId: string,
  code: string,
  department: string
): Promise<MetaCloudConnectResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (!wabaId || !phoneNumberId || !code) return { error: "Dados incompletos do Embedded Signup — tente conectar de novo." };

  try {
    await exchangeMetaCloudCode(code);
    await subscribeMetaCloudWebhook(wabaId);
    // Sem isso, todo envio (template, texto, mídia) falha com "(#133010) Account not registered" —
    // passo separado da assinatura do webhook, exigido pela Cloud API mesmo com o número já
    // aparecendo conectado no Business Manager.
    await registerMetaCloudPhone(phoneNumberId);
    const phoneInfo = await getMetaCloudPhoneInfo(phoneNumberId);

    // Upsert manual em vez de .upsert({onConflict:"phone_number_id"}) de propósito — esse índice é
    // parcial (where phone_number_id is not null), e o Postgres não infere conflito contra índice
    // parcial sem repetir o predicado, que o client do Supabase não deixa passar. Mesmo padrão de
    // "busca, depois insere ou atualiza" que connectDialog360 já usa.
    const supabase = await createClient();
    const { data: existing } = await supabase.from("whatsapp_instances").select("id").eq("phone_number_id", phoneNumberId).maybeSingle();

    const row = {
      workspace_id: workspace.id,
      department: department || "vendas",
      channel: "metacloud",
      meta_waba_id: wabaId,
      phone_number_id: phoneNumberId,
      connection_status: "conectado",
    };
    const { error } = existing
      ? await supabase.from("whatsapp_instances").update(row).eq("id", existing.id)
      : await supabase.from("whatsapp_instances").insert(row);
    if (error) return { error: `Conectou na Meta, mas não deu pra salvar: ${error.message}` };

    void phoneInfo; // só validação por ora — exibir nome/telefone formatado fica pra quando tiver UI de edição
    revalidatePath("/configuracoes");
    return { error: null, ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type ListTemplatesResult = { error: string | null; templates: Dialog360Template[] };

// Busca os Message Templates aprovados desse número — 360dialog ou metacloud, mesmo formato de
// retorno pros dois — usado pelo seletor de template na criação de campanha (em vez do cliente digitar
// o nome de cabeça).
export async function listWhatsappTemplates(instanceId: string): Promise<ListTemplatesResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo.", templates: [] };

  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("channel, dialog360_api_key, meta_waba_id")
    .eq("id", instanceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!instance) return { error: "Número não encontrado.", templates: [] };

  try {
    if (instance.channel === "360dialog") {
      if (!instance.dialog360_api_key) return { error: "Esse número ainda não tem API key do 360dialog salva.", templates: [] };
      return { error: null, templates: await listDialog360Templates(instance.dialog360_api_key) };
    }
    if (instance.channel === "metacloud") {
      if (!instance.meta_waba_id) return { error: "Esse número ainda não tem WABA vinculado.", templates: [] };
      return { error: null, templates: await listMetaCloudTemplates(instance.meta_waba_id) };
    }
    return { error: "Esse número não usa API oficial (360dialog/Meta).", templates: [] };
  } catch (err) {
    return { error: (err as Error).message, templates: [] };
  }
}

export async function refreshWhatsappStatus() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return;

  const instanceName = instanceNameFor(workspace.id);
  const supabase = await createClient();

  try {
    const state = await connectionState(instanceName);
    await supabase
      .from("whatsapp_instances")
      .update({ connection_status: state })
      .eq("workspace_id", workspace.id)
      .eq("instance_name", instanceName);
  } catch {
    // instância pode não existir ainda — ignora, o status no banco fica como está
  }

  revalidatePath("/configuracoes");
}

export type ProfilePhotoResult = { error: string | null; photoUrl?: string | null };

const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024; // teto da própria Meta pra foto de perfil

// Troca a foto de perfil do WhatsApp Business direto pela Graph API — só pra números conectados via
// Meta (metacloud); 360dialog e Evolution ainda não têm esse fluxo implementado.
export async function updateInstanceProfilePhoto(instanceId: string, formData: FormData): Promise<ProfilePhotoResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione uma imagem." };
  if (file.size > MAX_PROFILE_PHOTO_BYTES) return { error: "Imagem maior que 5MB — escolha um arquivo menor." };

  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("channel, phone_number_id")
    .eq("id", instanceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!instance) return { error: "Número não encontrado." };
  if (instance.channel !== "metacloud") return { error: "Troca de foto por aqui só funciona pra números conectados direto via Meta." };
  if (!instance.phone_number_id) return { error: "Esse número ainda não tem phone_number_id vinculado." };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await updateMetaCloudProfilePhoto(instance.phone_number_id, bytes, file.type || "image/jpeg");
    const photoUrl = await getMetaCloudProfilePhotoUrl(instance.phone_number_id);
    revalidatePath("/configuracoes");
    return { error: null, photoUrl };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getInstanceProfilePhoto(instanceId: string): Promise<ProfilePhotoResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("channel, phone_number_id")
    .eq("id", instanceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!instance || instance.channel !== "metacloud" || !instance.phone_number_id) return { error: null, photoUrl: null };

  try {
    return { error: null, photoUrl: await getMetaCloudProfilePhotoUrl(instance.phone_number_id) };
  } catch {
    return { error: null, photoUrl: null };
  }
}
