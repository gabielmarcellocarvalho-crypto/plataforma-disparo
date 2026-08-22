// Motor da sequência de e-mails por dia (Dia 1, 5, 10, 15, 21...) — modo "sequence" de campanha.
// Chamado a cada minuto de dentro do dispatch-campaigns (mesmo padrão de runOffHoursCatchup), sem
// cron novo pra configurar. Cada passo é enviado quando `next_step_at` vence, dentro da janela de
// dia/hora configurada (ramp_config.days/hourStart/hourEnd, mesmo formato já usado no blast).
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignEmail } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import crypto from "crypto";

type AdminClient = ReturnType<typeof createAdminClient>;

type SequenceStep = { dayOffset: number; subject: string; body: string; ctaLabel: string };

const MAX_SENDS_PER_RUN = 15;
const DEFAULT_DAYS = [2, 3, 4]; // terça a quinta, por padrão (regra do PDF da TB Rio)
const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function brtNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
  }).formatToParts(new Date());
  const weekday = WEEKDAY_NUM[parts.find((p) => p.type === "weekday")?.value || ""] ?? new Date().getDay();
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  return { weekday, hour };
}

function firstName(name: string | null): string {
  const first = (name || "").trim().split(/\s+/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export type EmailSequenceResult = { sent: number; skipped: number };

export async function runEmailSequences(supabase: AdminClient, siteOrigin: string): Promise<EmailSequenceResult> {
  let sent = 0;
  let skipped = 0;

  const { weekday, hour } = brtNow();
  const now = new Date();

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, workspace_id, name, subject, sequence_steps, cta_phone, cta_message, ramp_config")
    .eq("status", "ativa")
    .eq("channel", "email")
    .eq("mode", "sequence");

  for (const campaign of campaigns || []) {
    if (sent >= MAX_SENDS_PER_RUN) break;

    const steps = (campaign.sequence_steps || []) as SequenceStep[];
    if (steps.length === 0 || !campaign.cta_phone) continue;

    const cfg = (campaign.ramp_config || {}) as { days?: number[]; hourStart?: number; hourEnd?: number; maxSendsPerRun?: number };
    const days = cfg.days?.length ? cfg.days : DEFAULT_DAYS;
    const hourStart = cfg.hourStart ?? 8;
    const hourEnd = cfg.hourEnd ?? 12;
    if (!days.includes(weekday) || hour < hourStart || hour >= hourEnd) continue; // fora da janela — tenta de novo no próximo tick dentro dela

    const { data: wsRow } = await supabase.from("workspaces").select("email_from, brand_color, logo_url").eq("id", campaign.workspace_id).maybeSingle();
    const emailFrom = wsRow?.email_from;
    const brandColor = wsRow?.brand_color || null;
    const logoUrl = wsRow?.logo_url || null;
    if (!emailFrom) continue; // sem remetente configurado — não dá pra mandar nada dessa campanha

    // Teto por campanha (ramp_config.maxSendsPerRun) — opcional, pra espalhar uma base grande em
    // mais de uma janela (ex.: terça+quarta em vez de estourar tudo terça de manhã) sem afetar o
    // ritmo de outras campanhas de sequência rodando no mesmo tick.
    const remaining = MAX_SENDS_PER_RUN - sent;
    const campaignCap = cfg.maxSendsPerRun && cfg.maxSendsPerRun > 0 ? Math.min(cfg.maxSendsPerRun, remaining) : remaining;
    let sentThisCampaign = 0;

    const { data: recipients } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id, sequence_step, contacts(id, name, email, opt_out_email)")
      .eq("campaign_id", campaign.id)
      .is("stopped_reason", null)
      .lte("next_step_at", now.toISOString()) // NULL não passa aqui — ver query separada abaixo pro 1º envio
      .limit(campaignCap);

    const { data: freshRecipients } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id, sequence_step, contacts(id, name, email, opt_out_email)")
      .eq("campaign_id", campaign.id)
      .is("stopped_reason", null)
      .is("next_step_at", null) // ainda não recebeu nenhum passo — 1º envio (Dia 1)
      .limit(campaignCap);

    const pending = [...(freshRecipients || []), ...(recipients || [])].slice(0, campaignCap);

    for (const r of pending) {
      if (sent >= MAX_SENDS_PER_RUN || sentThisCampaign >= campaignCap) {
        skipped++;
        continue;
      }
      const contact = r.contacts as unknown as { id: string; name: string | null; email: string | null; opt_out_email: boolean } | null;
      const stepIndex = r.sequence_step;
      if (!contact || stepIndex >= steps.length) continue;

      if (!contact.email || contact.opt_out_email) {
        await supabase.from("campaign_recipients").update({ stopped_reason: "sem_email_ou_optout" }).eq("id", r.id);
        continue;
      }

      const step = steps[stepIndex];
      const token = crypto.randomUUID();
      await supabase.from("email_clicks").insert({
        workspace_id: campaign.workspace_id,
        campaign_id: campaign.id,
        contact_id: contact.id,
        step: stepIndex + 1,
        token,
      });
      const ctaUrl = `${siteOrigin}/api/e/${token}`;
      const body = step.body.replaceAll("{nome}", firstName(contact.name));
      const unsubUrl = unsubscribeUrl(siteOrigin, contact.id);

      try {
        await sendCampaignEmail(emailFrom, contact.email, step.subject, body, unsubUrl, { label: step.ctaLabel, url: ctaUrl }, brandColor, logoUrl);

        const nextIndex = stepIndex + 1;
        const nextStepAt =
          nextIndex < steps.length ? new Date(now.getTime() + (steps[nextIndex].dayOffset - step.dayOffset) * 86_400_000).toISOString() : null;

        await supabase
          .from("campaign_recipients")
          .update({
            sequence_step: nextIndex,
            next_step_at: nextStepAt,
            status: "enviado",
            sent_at: now.toISOString(),
            stopped_reason: nextStepAt === null ? "concluido" : null,
          })
          .eq("id", r.id);
        sent++;
        sentThisCampaign++;
      } catch (err) {
        await supabase
          .from("campaign_recipients")
          .update({ status: "falhou", error_message: (err as Error).message.slice(0, 300), stopped_reason: "erro" })
          .eq("id", r.id);
        skipped++;
      }
    }
  }

  return { sent, skipped };
}
