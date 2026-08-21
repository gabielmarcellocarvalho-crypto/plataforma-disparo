import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Link de CTA dos e-mails de sequência — registra o clique (1ª vez só), marca o contato como lead
// quente e para a sequência dele (não manda mais os próximos passos, já converteu), e redireciona
// pro WhatsApp configurado na campanha com uma mensagem inicial pronta.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: click } = await supabase
    .from("email_clicks")
    .select("id, campaign_id, contact_id, clicked_at")
    .eq("token", token)
    .maybeSingle();

  if (!click) {
    return new NextResponse("Link inválido ou expirado.", { status: 404 });
  }

  const { data: campaign } = await supabase.from("campaigns").select("cta_phone, cta_message").eq("id", click.campaign_id).maybeSingle();
  if (!campaign?.cta_phone) {
    return new NextResponse("Esse link não está configurado corretamente.", { status: 500 });
  }

  if (!click.clicked_at) {
    await supabase.from("email_clicks").update({ clicked_at: new Date().toISOString() }).eq("id", click.id);
    await supabase
      .from("campaign_recipients")
      .update({ stopped_reason: "clicou" })
      .eq("campaign_id", click.campaign_id)
      .eq("contact_id", click.contact_id)
      .is("stopped_reason", null);
    await supabase
      .from("contacts")
      .update({ flagged_reason: "Clicou no CTA de uma campanha de e-mail — lead de maior interesse pra contato comercial." })
      .eq("id", click.contact_id);
  }

  const message = campaign.cta_message || "Olá! Vim pelo e-mail e gostaria de saber mais.";
  const waUrl = `https://wa.me/${campaign.cta_phone}?text=${encodeURIComponent(message)}`;
  return NextResponse.redirect(waUrl);
}
