import { NextResponse } from "next/server";
import { secureEqual } from "@/lib/secure-compare";

// Webhook de leads do Facebook (Página → leadgen). A Meta chama GET uma vez pra validar a URL:
// devolve o `hub.challenge` só se o `hub.verify_token` for o nosso. Sem isso, o painel recusa salvar.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";

  const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && secureEqual(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}
