import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/calendar/crypto";
import { appId, appSecret, graphAll, graphGet } from "@/lib/facebook/graph";
import { verifyFacebookState } from "@/lib/facebook/state";

// Retorno do login do Facebook. Troca o código por um token de usuário de longa duração, lista as
// páginas que a pessoa autorizou e grava cada uma (token de página cifrado). Assina a página no
// webhook de leadgen pra os leads começarem a chegar.
type TokenResponse = { access_token?: string };
type Page = { id: string; name?: string; access_token?: string };

async function exchangeCode(origin: string, code: string): Promise<string> {
  const short = await graphGet<TokenResponse>("oauth/access_token", "", {
    client_id: appId(),
    client_secret: appSecret(),
    redirect_uri: `${origin}/api/integrations/facebook/callback`,
    code,
  });
  if (!short.access_token) throw new Error("O Facebook não devolveu o token.");
  const long = await graphGet<TokenResponse>("oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: appId(),
    client_secret: appSecret(),
    fb_exchange_token: short.access_token,
  });
  if (!long.access_token) throw new Error("Não foi possível obter o token de longa duração.");
  return long.access_token;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string) => NextResponse.redirect(new URL(`/integracoes/facebook-leads?facebook=${status}`, url.origin));

  const state = verifyFacebookState(url.searchParams.get("state") || "", appSecret());
  if (!state) return back("expirado");
  if (url.searchParams.get("error")) return back("cancelado");
  const code = url.searchParams.get("code");
  if (!code) return back("erro");

  const admin = createAdminClient();
  try {
    const userToken = await exchangeCode(url.origin, code);
    const me = await graphGet<{ id: string; name?: string }>("me", userToken, { fields: "id,name" });
    const pages = await graphAll<Page>("me/accounts", userToken, { fields: "id,name,access_token" });

    const { data: connection, error: connError } = await admin
      .from("facebook_connections")
      .upsert(
        {
          workspace_id: state.workspaceId,
          fb_user_id: me.id,
          fb_user_name: me.name ?? null,
          status: "conectado",
          last_error: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,fb_user_id" }
      )
      .select("id")
      .single();
    if (connError || !connection) throw new Error(connError?.message || "Não foi possível salvar a conexão.");

    // Página nova entra desligada: a pessoa escolhe quais ligar na tela. Página que já existia mantém o
    // status que ela tinha. A assinatura do aviso de lead só acontece quando a página é ligada.
    const { data: known } = await admin.from("facebook_pages").select("page_id").eq("workspace_id", state.workspaceId);
    const knownIds = new Set((known || []).map((k) => k.page_id as string));
    for (const page of pages) {
      if (!page.access_token) continue;
      const fields = {
        connection_id: connection.id,
        page_name: page.name ?? null,
        page_token_enc: encryptToken(page.access_token),
      };
      if (knownIds.has(page.id)) {
        await admin.from("facebook_pages").update(fields).eq("workspace_id", state.workspaceId).eq("page_id", page.id);
      } else {
        await admin.from("facebook_pages").insert({ workspace_id: state.workspaceId, page_id: page.id, status: "inativa", ...fields });
      }
    }

    return back("ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Falha ao conectar Facebook:", message);
    return back("erro");
  }
}
