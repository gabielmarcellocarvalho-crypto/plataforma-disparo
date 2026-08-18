import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, instanceNameFor } from "@/lib/evolution";
import { sendDialog360Text, sendDialog360Template } from "@/lib/dialog360";

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
      "id, workspace_id, mode, agent_id, whatsapp_instance_id, dialog360_template_name, dialog360_template_lang, dialog360_template_var_count, message_templates, ramp_config, dispatch_days, next_dispatch_at, agents(evolution_instance_name)"
    )
    .eq("status", "ativa")
    .eq("channel", "whatsapp");

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
      .select("id, contact_id, contacts(id, name, phone, opt_out_whatsapp, stage)")
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
      | { id: string; name: string | null; phone: string | null; opt_out_whatsapp: boolean; stage: string }
      | null;

    if (!contact || !contact.phone || contact.opt_out_whatsapp) {
      await supabase
        .from("campaign_recipients")
        .update({ status: "invalido", error_message: "Sem telefone válido ou optou por sair." })
        .eq("id", recipient.id);
      continue;
    }

    const text = pickMessage(campaign.message_templates, contact.name);
    if (!text) {
      await supabase.from("campaign_recipients").update({ status: "invalido", error_message: "Campanha sem mensagem." }).eq("id", recipient.id);
      continue;
    }

    // Modo agente sempre usa o número próprio do agente (Evolution). Modo blast resolve o número
    // pela instância escolhida na campanha (whatsapp_instance_id) — se a campanha não escolheu
    // nenhuma (criada antes dessa opção existir, ou workspace com só 1 número), cai no único número
    // conectado do workspace; se o workspace tem mais de 1 e a campanha não escolheu, não dá pra
    // adivinhar qual disparar, então pula.
    let blastInstance: {
      id: string;
      channel: string;
      instance_name: string | null;
      phone_number_id: string | null;
      dialog360_api_key: string | null;
    } | null = null;
    if (campaign.mode !== "agent") {
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

    const instanceName =
      campaign.mode === "agent"
        ? (campaign.agents as unknown as { evolution_instance_name: string } | null)?.evolution_instance_name
        : blastInstance?.channel === "evolution"
          ? (blastInstance.instance_name ?? instanceNameFor(campaign.workspace_id))
          : null;

    if (campaign.mode !== "agent" && blastInstance?.channel === "360dialog") {
      if (!blastInstance.dialog360_api_key || !blastInstance.phone_number_id) {
        skipped.push(`${campaign.id}:360dialog-sem-credenciais`);
        continue;
      }
    } else if (!instanceName) {
      skipped.push(`${campaign.id}:sem-instancia`);
      continue;
    }

    const nextDelaySeconds = delayMin + Math.random() * (delayMax - delayMin);

    try {
      if (campaign.mode !== "agent" && blastInstance?.channel === "360dialog") {
        // Cloud API oficial: texto livre só é aceito dentro de 24h da última mensagem do CONTATO
        // (regra da Meta) — fora disso, é obrigatório usar um Message Template pré-aprovado.
        const { data: recentReply } = await supabase
          .from("messages")
          .select("id")
          .eq("workspace_id", campaign.workspace_id)
          .eq("contact_id", contact.id)
          .eq("role", "user")
          .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString())
          .limit(1)
          .maybeSingle();

        if (recentReply) {
          await sendDialog360Text(blastInstance.dialog360_api_key!, contact.phone, text);
        } else if (campaign.dialog360_template_name) {
          const bodyParams = campaign.dialog360_template_var_count >= 1 ? [firstName(contact.name)] : [];
          await sendDialog360Template(
            blastInstance.dialog360_api_key!,
            contact.phone,
            campaign.dialog360_template_name,
            campaign.dialog360_template_lang || "pt_BR",
            bodyParams
          );
        } else {
          throw new Error("Fora da janela de 24h e campanha sem template 360dialog configurado.");
        }
      } else {
        await sendText(instanceName!, contact.phone, text);
      }
      await supabase.from("campaign_recipients").update({ status: "enviado", sent_at: new Date().toISOString() }).eq("id", recipient.id);
      await supabase.from("messages").insert({
        workspace_id: campaign.workspace_id,
        contact_id: contact.id,
        agent_id: campaign.mode === "agent" ? campaign.agent_id : null,
        role: "assistant",
        content: text,
      });
      if (contact.stage === "nao_abordado") {
        await supabase.from("contacts").update({ stage: "abordado", stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
      }
      sent++;
    } catch (err) {
      await supabase
        .from("campaign_recipients")
        .update({ status: "falhou", error_message: (err as Error).message.slice(0, 300) })
        .eq("id", recipient.id);
      failed++;
    }

    await supabase
      .from("campaigns")
      .update({ next_dispatch_at: new Date(now.getTime() + nextDelaySeconds * 1000).toISOString() })
      .eq("id", campaign.id);
  }

  return NextResponse.json({ ok: true, sent, failed, completed, skipped });
}
