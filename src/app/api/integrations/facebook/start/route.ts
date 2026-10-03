import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { appId, FACEBOOK_SCOPES } from "@/lib/facebook/graph";
import { signFacebookState } from "@/lib/facebook/state";

// "Conectar Facebook": manda pro login da Meta pedindo as permissões de página e de leads. O estado
// assinado guarda o workspace de quem clicou, pra o retorno gravar na conta certa.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return NextResponse.redirect(new URL("/login", url.origin));

  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.redirect(new URL("/integracoes?facebook=config", url.origin));

  const state = signFacebookState(workspace.id, secret);
  const login = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  login.searchParams.set("client_id", appId());
  login.searchParams.set("redirect_uri", `${url.origin}/api/integrations/facebook/callback`);
  login.searchParams.set("state", state);
  login.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
  login.searchParams.set("response_type", "code");
  return NextResponse.redirect(login);
}
