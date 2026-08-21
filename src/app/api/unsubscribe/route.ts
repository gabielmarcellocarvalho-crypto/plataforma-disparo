import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

// Link público no rodapé do e-mail de campanha — sem sessão de usuário, autenticado só pelo token
// assinado (ver src/lib/unsubscribe.ts). Marca opt_out_email=true; próximas campanhas já pulam esse
// contato (activateCampaign filtra por opt_out_email na hora de montar a fila).
function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:40px 16px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 28px;text-align:center;">
      <h1 style="font-size:18px;margin:0 0 8px;color:#1a1a1a;">${title}</h1>
      <p style="font-size:14px;color:#555;margin:0;line-height:1.5;">${message}</p>
    </div>
  </body>
</html>`;
}

function respond(html: string, status = 200) {
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contactId = url.searchParams.get("c");
  const token = url.searchParams.get("t");

  if (!contactId || !token || !verifyUnsubscribeToken(contactId, token)) {
    return respond(page("Link inválido", "Esse link de descadastro não é válido ou expirou."), 400);
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("contacts").update({ opt_out_email: true }).eq("id", contactId);
  if (error) {
    return respond(page("Erro", "Não foi possível processar seu pedido agora. Tente de novo mais tarde."), 500);
  }

  return respond(page("Você saiu da lista", "Você não vai mais receber e-mails dessa lista. Se foi engano, entre em contato com quem te enviou o e-mail."));
}

// One-click unsubscribe (RFC 8058) — Gmail/Outlook/Yahoo chamam isso direto quando a pessoa clica no
// botão "Cancelar inscrição" nativo do cliente de e-mail (não abre navegador nenhum), desde que o
// header List-Unsubscribe-Post esteja presente (ver src/lib/email.ts). Mesma verificação de token,
// sem página de confirmação — só responde 200.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const contactId = url.searchParams.get("c");
  const token = url.searchParams.get("t");
  if (!contactId || !token || !verifyUnsubscribeToken(contactId, token)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const supabase = createAdminClient();
  await supabase.from("contacts").update({ opt_out_email: true }).eq("id", contactId);
  return NextResponse.json({ ok: true });
}
