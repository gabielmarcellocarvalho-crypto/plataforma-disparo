import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, instanceNameFor } from "@/lib/evolution";
import { sendDialog360Template } from "@/lib/dialog360";
import { sendMetaCloudTemplate } from "@/lib/metacloud";
import { isOfficialWhatsappChannel } from "@/lib/whatsapp-channel";
import { sendCampaignEmail, ResendError } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { runOffHoursCatchup } from "@/lib/agent-catchup";
import { runEmailSequences } from "@/lib/email-sequence";

// Motor de disparo em massa (WhatsApp, Evolution API). O cron nativo da Vercel no plano Hobby só
// roda 1x/dia, insuficiente pra um delay de 60-180s entre mensagens — por isso esse endpoint é
// chamado por um cron externo (VPS) a cada minuto. Cada campanha ativa manda no máximo 1 mensagem
// por invocação: `next_dispatch_at` garante o delay aleatório entre disparos da mesma campanha
// mesmo com o trigger externo batendo todo minuto; `dispatch_days` + `ramp` dão a cota diária
// crescente (anti-ban), igual à rampa já validada no piloto.
export const maxDuration = 60;

const DEFAULT_RAMP = [50, 80, 120, 170, 230, 300];
const DEFAULT_DELAY: [number, number] = [60, 180];
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];

type RampConfig = {
  delaySeconds?: [number, number];
  hourStart?: number;
  hourEnd?: number;
  days?: number[];
  ramp?: number[];
};

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Janela/dia sempre em horário de Brasília, independente de onde o cron externo roda.
function brtNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = WEEKDAY_NUM[parts.find((p) => p.type === "weekday")?.value || ""] ?? new Date().getDay();
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  return { weekday, hour };
}

function brtDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function firstName(name: string | null): string {
  const first = (name || "").trim().split(/\s+/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function pickMessage(templates: unknown, name: string | null): string | null {
  const list = Array.isArray(templates) ? (templates as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
  if (list.length === 0) return null;
  const template = list[Math.floor(Math.random() * list.length)];
  return template.replaceAll("{nome}", firstName(name));
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { weekday, hour } = brtNow();
  const today = brtDateKey();
  const now = new Date();

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      "id, workspace_id, channel, subject, name, mode, agent_id, whatsapp_instance_id, dialog360_template_name, dialog360_template_lang, dialog360_template_var_count, message_templates, ramp_config, dispatch_days, next_dispatch_at, agents(evolution_instance_name)"
    )
    .eq("status", "ativa")
    .neq("mode", "sequence"); // sequência de e-mail tem motor próprio (runEmailSequences), roda à parte

  let sent = 0;
  let failed = 0;
  let completed = 0;
  const skipped: string[] = [];

  for (const campaign of campaigns || []) {
    const cfg = (campaign.ramp_config || {}) as RampConfig;
    const [delayMin, delayMax] = cfg.delaySeconds?.length === 2 ? cfg.delaySeconds : DEFAULT_DELAY;
    const hourStart = cfg.hourStart ?? 9;
    const hourEnd = cfg.hourEnd ?? 20;
    const days = cfg.days?.length ? cfg.days : DEFAULT_DAYS;
    const ramp = cfg.ramp?.length ? cfg.ramp : DEFAULT_RAMP;

    if (!days.includes(weekday) || hour < hourStart || hour >= hourEnd) {
      skipped.push(`${campaign.id}:janela`);
      continue;
    }
    if (campaign.next_dispatch_at && new Date(campaign.next_dispatch_at) > now) {
      skipped.push(`${campaign.id}:delay`);
      continue;
    }

    // "Dia da campanha" = quantos dias distintos ela já teve disparo — dita em qual degrau da rampa estamos.
    let dispatchDays: string[] = Array.isArray(campaign.dispatch_days) ? (campaign.dispatch_days as string[]) : [];
    let dayIndex = dispatchDays.indexOf(today);
    if (dayIndex === -1) {
      dispatchDays = [...dispatchDays, today];
      dayIndex = dispatchDays.length - 1;
      await supabase.from("campaigns").update({ dispatch_days: dispatchDays }).eq("id", campaign.id);
    }
    const quota = ramp[Math.min(dayIndex, ramp.length - 1)];

    const { count: sentTodayCount } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "enviado")
      .gte("sent_at", `${today}T00:00:00.000-03:00`)
      .lt("sent_at", `${today}T23:59:59.999-03:00`);

    if ((sentTodayCount ?? 0) >= quota) {
      skipped.push(`${campaign.id}:cota`);
      continue;
    }

    const { data: recipient } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id, contacts(id, name, phone, email, opt_out_whatsapp, opt_out_email, stage)")
      .eq("campaign_id", campaign.id)
      .eq("status", "pendente")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!recipient) {
      await supabase.from("campaigns").update({ status: "concluida" }).eq("id", campaign.id);
      completed++;
      continue;
    }

    const contact = recipient.contacts as unknown as
      | { id: string; name: string | null; phone: string | null; email: string | null; opt_out_whatsapp: boolean; opt_out_email: boolean; stage: string }
      | null;

    const isEmail = campaign.channel === "email";

    if (!contact || (isEmail ? !contact.email || contact.opt_out_email : !contact.phone || contact.opt_out_whatsapp)) {
      await supabase
        .from("campaign_recipients")
        .update({ status: "invalido", error_message: isEmail ? "Sem e-mail válido ou optou por sair." : "Sem telefone válido ou optou por sair." })
        .eq("id", recipient.id);
      continue;
    }

    // Modo agente sempre usa o número próprio do agente (Evolution). Modo blast resolve o número
    // pela instância escolhida na campanha (whatsapp_instance_id) — se a campanha não escolheu
    // nenhuma (criada antes dessa opção existir, ou workspace com só 1 número), cai no único número
    // conectado do workspace; se o workspace tem mais de 1 e a campanha não escolheu, não dá pra
    // adivinhar qual disparar, então pula. Não se aplica a campanha de e-mail.
    let blastInstance: {
      id: string;
      channel: string;
      instance_name: string | null;
      phone_number_id: string | null;
      dialog360_api_key: string | null;
    } | null = null;
    if (!isEmail && campaign.mode !== "agent") {
      if (campaign.whatsapp_instance_id) {
        const { data } = await supabase
          .from("whatsapp_instances")
          .select("id, channel, instance_name, phone_number_id, dialog360_api_key")
          .eq("id", campaign.whatsapp_instance_id)
          .maybeSingle();
        blastInstance = data;
      } else {
        const { data } = await supabase
          .from("whatsapp_instances")
          .select("id, channel, instance_name, phone_number_id, dialog360_api_key")
          .eq("workspace_id", campaign.workspace_id);
        if (data && data.length === 1) blastInstance = data[0];
        else if (data && data.length > 1) {
          skipped.push(`${campaign.id}:multiplos-numeros-sem-escolha`);
          continue;
        }
      }
    }

    const isDialog360Blast = !isEmail && campaign.mode !== "agent" && blastInstance?.channel === "360dialog";
    const isMetacloudBlast = !isEmail && campaign.mode !== "agent" && blastInstance?.channel === "metacloud";
    const isOfficialBlast = !isEmail && campaign.mode !== "agent" && isOfficialWhatsappChannel(blastInstance?.channel || "");

    // API oficial é sempre template (não tem conceito de "responder dentro de 24h" numa campanha de
    // disparo — isso é conversa viva, não campanha); Evolution/agente/e-mail usam o texto livre configurado.
    const text = isOfficialBlast ? null : pickMessage(campaign.message_templates, contact.name);
    if (!isOfficialBlast && !text) {
      await supabase.from("campaign_recipients").update({ status: "invalido", error_message: "Campanha sem mensagem." }).eq("id", recipient.id);
      continue;
    }
    if (isOfficialBlast && !campaign.dialog360_template_name) {
      await supabase.from("campaign_recipients").update({ status: "invalido", error_message: "Campanha sem template configurado." }).eq("id", recipient.id);
      continue;
    }

    const instanceName =
      isEmail
        ? null
        : campaign.mode === "agent"
          ? (campaign.agents as unknown as { evolution_instance_name: string } | null)?.evolution_instance_name
          : blastInstance?.channel === "evolution"
            ? (blastInstance.instance_name ?? instanceNameFor(campaign.workspace_id))
            : null;

    // E-mail precisa do remetente verificado do workspace (cada cliente pode ter domínio próprio no
    // Resend) — sem isso configurado, falha com mensagem clara em vez de tentar mandar de qualquer jeito.
    let emailFrom: string | null = null;
    let emailBrandColor: string | null = null;
    let emailLogoUrl: string | null = null;
    if (isEmail) {
      const { data: ws } = await supabase.from("workspaces").select("email_from, brand_color, logo_url").eq("id", campaign.workspace_id).maybeSingle();
      emailFrom = ws?.email_from || null;
      emailBrandColor = ws?.brand_color || null;
      emailLogoUrl = ws?.logo_url || null;
      if (!emailFrom) {
        skipped.push(`${campaign.id}:sem-remetente-email`);
        continue;
      }
    } else if (isDialog360Blast) {
      if (!blastInstance!.dialog360_api_key || !blastInstance!.phone_number_id) {
        skipped.push(`${campaign.id}:360dialog-sem-credenciais`);
        continue;
      }
    } else if (isMetacloudBlast) {
      if (!blastInstance!.phone_number_id) {
        skipped.push(`${campaign.id}:metacloud-sem-credenciais`);
        continue;
      }
    } else if (!instanceName) {
      skipped.push(`${campaign.id}:sem-instancia`);
      continue;
    }

    const nextDelaySeconds = delayMin + Math.random() * (delayMax - delayMin);

    // Conteúdo gravado no histórico da conversa (Conversas/CRM) — pro template, guarda uma referência
    // legível já que o corpo real fica só na Meta, não temos o texto renderizado aqui.
    const loggedContent = isOfficialBlast ? `[Template ${blastInstance!.channel}: ${campaign.dialog360_template_name}]` : (text as string);

    try {
      if (isEmail) {
        await sendCampaignEmail(
          emailFrom!,
          contact.email!,
          campaign.subject || campaign.name,
          text as string,
          unsubscribeUrl(new URL(req.url).origin, contact.id),
          undefined,
          emailBrandColor,
          emailLogoUrl
        );
      } else if (isDialog360Blast) {
        const bodyParams = campaign.dialog360_template_var_count >= 1 ? [firstName(contact.name)] : [];
        await sendDialog360Template(
          blastInstance!.dialog360_api_key!,
          contact.phone!,
          campaign.dialog360_template_name!,
          campaign.dialog360_template_lang || "pt_BR",
          bodyParams
        );
      } else if (isMetacloudBlast) {
        const bodyParams = campaign.dialog360_template_var_count >= 1 ? [firstName(contact.name)] : [];
        await sendMetaCloudTemplate(
          blastInstance!.phone_number_id!,
          contact.phone!,
          campaign.dialog360_template_name!,
          campaign.dialog360_template_lang || "pt_BR",
          bodyParams
        );
      } else {
        await sendText(instanceName!, contact.phone!, text as string);
      }
      await supabase.from("campaign_recipients").update({ status: "enviado", sent_at: new Date().toISOString() }).eq("id", recipient.id);
      await supabase.from("messages").insert({
        workspace_id: campaign.workspace_id,
        contact_id: contact.id,
        agent_id: campaign.mode === "agent" ? campaign.agent_id : null,
        role: "assistant",
        content: loggedContent,
      });
      if (contact.stage === "nao_abordado") {
        await supabase.from("contacts").update({ stage: "abordado", stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
      }
      sent++;
    } catch (err) {
      // 429 do Resend = cota da CONTA inteira estourada (1 chave só, compartilhada por todo mundo),
      // não um problema desse destinatário — não marca "falhou" (permanente, nunca mais tentaria de
      // novo), deixa como "pendente" pra ser pego de novo no próximo tick quando a cota renovar.
      if (err instanceof ResendError && err.status === 429) {
        skipped.push(`${campaign.id}:cota-resend`);
      } else {
        await supabase
          .from("campaign_recipients")
          .update({ status: "falhou", error_message: (err as Error).message.slice(0, 300) })
          .eq("id", recipient.id);
        failed++;
      }
    }

    await supabase
      .from("campaigns")
      .update({ next_dispatch_at: new Date(now.getTime() + nextDelaySeconds * 1000).toISOString() })
      .eq("id", campaign.id);
  }

  // Retomada automática de contatos que ficaram sem resposta por terem escrito fora do horário —
  // roda aqui porque esse endpoint já é chamado a cada minuto pelo cron externo (não precisa de mais
  // nenhum agendamento). Best-effort: falha aqui não deve derrubar a resposta do disparo de campanhas.
  const catchup = await runOffHoursCatchup(supabase).catch((err) => {
    console.error("Erro no catch-up pós-horário:", err);
    return { sent: 0, skipped: 0 };
  });

  // Sequência de e-mails por dia (Dia 1/5/10/15/21...) — mesmo motivo de rodar aqui: esse endpoint
  // já é invocado a cada minuto, não precisa de agendamento novo.
  const emailSequences = await runEmailSequences(supabase, new URL(req.url).origin).catch((err) => {
    console.error("Erro na sequência de e-mail:", err);
    return { sent: 0, skipped: 0 };
  });

  return NextResponse.json({ ok: true, sent, failed, completed, skipped, catchup, emailSequences });
}
