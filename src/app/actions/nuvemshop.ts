"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { deleteIntegration, getIntegration, readCredentials, saveIntegration, setCapabilities, setStatus } from "@/lib/integrations/connections";
import { isValidStoreId, NuvemshopError } from "@/lib/integrations/nuvemshop/client";
import { NUVEMSHOP_PROVIDER, sanitizeCapabilityIds } from "@/lib/integrations/nuvemshop/capabilities";
import { fetchStoreName } from "@/lib/integrations/nuvemshop/lookup";

// O token entra só aqui, no servidor: é validado com UMA leitura (GET /store), cifrado e gravado. Nada
// devolve o token à tela. Nenhuma destas ações escreve na loja do cliente.

type Result<T = object> = ({ error: null } & T) | { error: string };

function explain(err: unknown): string {
  if (err instanceof NuvemshopError) {
    if (err.kind === "auth") return "A Nuvemshop recusou o token ou o ID da loja. Confira os dois e as permissões do aplicativo.";
    if (err.kind === "rate") return "A Nuvemshop pediu para aguardar. Tente de novo em instantes.";
    return err.message;
  }
  return "Não foi possível falar com a Nuvemshop agora.";
}

export async function connectNuvemshop(input: { storeId: string; token: string }): Promise<Result<{ storeName: string | null }>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Workspace não encontrado." };

  const storeId = (input.storeId || "").trim();
  const token = (input.token || "").trim();
  if (!isValidStoreId(storeId)) return { error: "O ID da loja tem só números (de 3 a 15 dígitos)." };
  if (token.length < 20 || token.length > 200 || /\s/.test(token)) return { error: "Token inválido: confira se copiou inteiro, sem espaços." };

  let storeName: string | null;
  try {
    storeName = await fetchStoreName({ storeId, token });
  } catch (err) {
    return { error: explain(err) };
  }
  // 404 em /store = esse ID não existe pra esse token.
  if (storeName === null) return { error: "Não encontrei essa loja com esse token. Confira o ID da loja." };

  try {
    await saveIntegration(createAdminClient(), { workspaceId: workspace.id, provider: NUVEMSHOP_PROVIDER, externalId: storeId, displayName: storeName, token });
  } catch {
    return { error: "Não foi possível salvar a conexão." };
  }
  revalidatePath("/integracoes");
  revalidatePath("/integracoes/nuvemshop");
  return { error: null, storeName };
}

export async function testNuvemshop(): Promise<Result<{ storeName: string | null }>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Workspace não encontrado." };
  const admin = createAdminClient();
  const conn = await readCredentials(admin, workspace.id, NUVEMSHOP_PROVIDER).catch(() => null);
  if (!conn) return { error: "Nuvemshop não está conectada." };
  try {
    const storeName = await fetchStoreName({ storeId: conn.externalId, token: conn.token });
    await setStatus(admin, workspace.id, NUVEMSHOP_PROVIDER, "conectado", null);
    revalidatePath("/integracoes/nuvemshop");
    return { error: null, storeName };
  } catch (err) {
    if (err instanceof NuvemshopError && err.kind === "auth") {
      await setStatus(admin, workspace.id, NUVEMSHOP_PROVIDER, "reconectar", "Token recusado pela Nuvemshop.");
      revalidatePath("/integracoes/nuvemshop");
    }
    return { error: explain(err) };
  }
}

export async function updateNuvemshopCapabilities(ids: string[]): Promise<Result<{ enabled: string[] }>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Workspace não encontrado." };
  const admin = createAdminClient();
  const conn = await getIntegration(admin, workspace.id, NUVEMSHOP_PROVIDER).catch(() => null);
  if (!conn) return { error: "Nuvemshop não está conectada." };
  // Só entra permissão que existe e está disponível (as de escrita ficam travadas).
  const enabled = sanitizeCapabilityIds(ids);
  try {
    await setCapabilities(admin, workspace.id, NUVEMSHOP_PROVIDER, enabled);
  } catch {
    return { error: "Não foi possível salvar as permissões." };
  }
  revalidatePath("/integracoes/nuvemshop");
  return { error: null, enabled };
}

export async function disconnectNuvemshop(): Promise<Result> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Workspace não encontrado." };
  try {
    await deleteIntegration(createAdminClient(), workspace.id, NUVEMSHOP_PROVIDER);
  } catch {
    return { error: "Não foi possível desconectar." };
  }
  revalidatePath("/integracoes");
  revalidatePath("/integracoes/nuvemshop");
  return { error: null };
}
