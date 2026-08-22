"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_WORKSPACE_COOKIE, isCurrentUserColaborador } from "@/lib/workspace";
import { isWorkspacePlan } from "@/lib/workspace-plan";
import { extractDominantColor } from "@/lib/logo-color";

export type CreateWorkspaceState = { error: string | null };

export async function createWorkspace(
  _prevState: CreateWorkspaceState,
  formData: FormData
): Promise<CreateWorkspaceState> {
  const name = String(formData.get("name") || "").trim();
  const plan = String(formData.get("plan") || "");
  if (!name) return { error: "Informe o nome do cliente." };
  if (!isWorkspacePlan(plan)) return { error: "Escolha o plano desse cliente." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").insert({ name, plan }).select("id").single();

  if (error) return { error: "Não foi possível criar o workspace (você precisa ser admin da agência)." };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, data.id, { httpOnly: true, sameSite: "lax", path: "/" });

  redirect("/");
}

export async function setActiveWorkspace(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

// Muda o plano de um workspace já existente (ex.: cliente fez upgrade de SDR pra SDR + Closer) —
// ajusta o funil e as taxas mostradas na Visão geral pra esse workspace a partir de agora.
export async function updateWorkspacePlan(workspaceId: string, plan: string): Promise<CreateWorkspaceState> {
  if (!(await isCurrentUserColaborador())) return { error: "Só a agência pode mudar o plano." };
  if (!isWorkspacePlan(plan)) return { error: "Plano inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ plan }).eq("id", workspaceId);
  if (error) return { error: "Não foi possível salvar o plano." };

  revalidatePath("/configuracoes");
  revalidatePath("/");
  return { error: null };
}

// Remetente das campanhas de e-mail desse workspace ("Nome <email@dominio.com.br>") — cada cliente
// pode ter seu próprio domínio verificado no Resend, não é 1 remetente global pra todo mundo.
export async function updateEmailFrom(workspaceId: string, emailFrom: string): Promise<CreateWorkspaceState> {
  if (!(await isCurrentUserColaborador())) return { error: "Só a agência pode mudar o remetente." };

  const trimmed = emailFrom.trim();
  const emailMatch = trimmed.match(/<([^>]+)>/) ?? [null, trimmed];
  const emailPart = (emailMatch[1] || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPart)) return { error: "E-mail inválido — use o formato \"Nome <email@dominio.com>\" ou só o e-mail." };

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ email_from: trimmed }).eq("id", workspaceId);
  if (error) return { error: "Não foi possível salvar o remetente." };

  revalidatePath("/configuracoes");
  return { error: null };
}

export type UploadLogoResult = { error: string | null; logoUrl?: string; brandColor?: string | null };

// Logo do cliente pro cabeçalho do e-mail de campanha. A cor de marca (brand_color) é recalculada
// automaticamente a partir da cor dominante da própria imagem — não existe seletor de cor manual:
// trocar a logo é a forma de trocar a cor.
export async function uploadWorkspaceLogo(workspaceId: string, formData: FormData): Promise<UploadLogoResult> {
  if (!(await isCurrentUserColaborador())) return { error: "Só a agência pode trocar a logo." };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo de imagem." };
  if (file.size > 2 * 1024 * 1024) return { error: "Imagem muito grande (máx. 2MB)." };
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
    return { error: "Formato inválido — use PNG, JPG, WEBP ou SVG." };
  }

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from("workspace-logos").upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) return { error: "Não foi possível subir a logo." };

  const { data: pub } = admin.storage.from("workspace-logos").getPublicUrl(path);

  // SVG não tem bitmap decodificável pelo extrator — mantém a cor de marca já salva (se houver).
  const brandColor = file.type === "image/svg+xml" ? undefined : await extractDominantColor(buffer);

  const update: { logo_url: string; brand_color?: string | null } = { logo_url: pub.publicUrl };
  if (brandColor !== undefined) update.brand_color = brandColor;

  const { error } = await admin.from("workspaces").update(update).eq("id", workspaceId);
  if (error) return { error: "Logo subiu, mas não deu pra salvar no workspace." };

  revalidatePath("/configuracoes");
  return { error: null, logoUrl: pub.publicUrl, brandColor: update.brand_color };
}

// Remove um workspace inteiro — apaga em cascata TODOS os dados dele (contatos, agentes, conversas,
// campanhas). Só colaborador (equipe da agência). Usa o admin client porque não há policy de DELETE
// em workspaces (RLS bloquearia o client do usuário); a autorização é feita aqui, no servidor.
export async function deleteWorkspace(workspaceId: string): Promise<{ error: string | null }> {
  if (!(await isCurrentUserColaborador())) return { error: "Só a agência pode remover um workspace." };

  const admin = createAdminClient();
  const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
  if (error) return { error: "Não foi possível remover o workspace." };

  // Se o removido era o ativo, limpa o cookie pra getCurrentWorkspace cair no próximo disponível.
  const cookieStore = await cookies();
  if (cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value === workspaceId) {
    cookieStore.delete(ACTIVE_WORKSPACE_COOKIE);
  }

  revalidatePath("/", "layout");
  return { error: null };
}

export type SaveEstimateResult = { error: string | null };

// Estimativa salva de um workspace substitui o volume real dele na conta do total entre todos
// os clientes (ver getDispatchStats) — pensada pra cliente que ainda não tem campanha rodando.
export async function saveVolumeEstimate(
  workspaceId: string,
  emailVolume: number,
  whatsappVolume: number
): Promise<SaveEstimateResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ estimated_email_volume: emailVolume, estimated_whatsapp_volume: whatsappVolume })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível salvar a estimativa." };

  revalidatePath("/calculadora");
  return { error: null };
}

// Orçamento mensal de custo de IA + limite de alerta (%) — colaborador define por workspace.
// Alimenta o alerta na Visão geral/Métricas. budget null/0 = desliga o alerta desse cliente.
export async function saveCostBudget(
  workspaceId: string,
  budgetBrl: number | null,
  thresholdPct: number
): Promise<SaveEstimateResult> {
  const budget = budgetBrl && budgetBrl > 0 ? budgetBrl : null;
  const pct = Math.min(100, Math.max(1, Math.round(thresholdPct || 80)));

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ monthly_cost_budget_brl: budget, cost_alert_pct: pct })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível salvar o orçamento." };

  revalidatePath("/metricas");
  revalidatePath("/");
  return { error: null };
}

// Volta a usar o volume real (fila de campanhas) desse workspace na conta, descartando a estimativa manual.
export async function clearVolumeEstimate(workspaceId: string): Promise<SaveEstimateResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ estimated_email_volume: null, estimated_whatsapp_volume: null })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível limpar a estimativa." };

  revalidatePath("/calculadora");
  return { error: null };
}
