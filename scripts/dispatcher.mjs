// Worker de disparo — roda local por enquanto (`npm run dispatch`), migra pra VPS junto com a Evolution API depois.
// Mesma lógica de rampa/janela validada no piloto da Hanoi, agora cobrindo todas as campanhas ativas
// de todos os workspaces (WhatsApp via Evolution API, e-mail via Resend).
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVOLUTION_URL = (process.env.EVOLUTION_URL || "").replace(/\/$/, "");
const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWhatsapp(instanceName, phone, text) {
  const res = await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_APIKEY },
    body: JSON.stringify({ number: phone, text, delay: 1200 }),
  });
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendEmail(to, subject, text) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "onboarding@resend.dev",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function firstName(name) {
  const first = (name || "").trim().split(/\s+/)[0];
  if (!first || first.length < 2) return "";
  return " " + first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function insideWindow(hourStart, hourEnd, days) {
  const now = new Date();
  return (days || [0, 1, 2, 3, 4, 5, 6]).includes(now.getDay()) && now.getHours() >= hourStart && now.getHours() < hourEnd;
}

// Pega o próximo destinatário pendente de qualquer campanha ativa, com os dados já resolvidos.
async function pickNextPending() {
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, workspace_id, channel, mode, agent_id, message_templates, ramp_config")
    .eq("status", "ativa");
  if (!campaigns || campaigns.length === 0) return null;

  for (const campaign of campaigns) {
    const { hourStart = 9, hourEnd = 20, days } = campaign.ramp_config || {};
    if (!insideWindow(hourStart, hourEnd, days)) continue;

    const { data: recipient } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "pendente")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!recipient) continue;

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, name, phone, email")
      .eq("id", recipient.contact_id)
      .single();

    let instanceName = null;
    if (campaign.channel === "whatsapp") {
      if (campaign.mode === "agent" && campaign.agent_id) {
        const { data: agent } = await supabase
          .from("agents")
          .select("evolution_instance_name")
          .eq("id", campaign.agent_id)
          .maybeSingle();
        instanceName = agent?.evolution_instance_name ?? null;
      } else {
        const { data: instance } = await supabase
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("workspace_id", campaign.workspace_id)
          .maybeSingle();
        instanceName = instance?.instance_name ?? null;
      }
    }

    return { campaign, recipient, contact, instanceName };
  }
  return null;
}

async function dispatchOne({ campaign, recipient, contact, instanceName }) {
  const templates = campaign.message_templates || [];
  const template = templates[Math.floor(Math.random() * templates.length)] || "";
  const text = template.replaceAll("{nome}", firstName(contact.name));

  try {
    if (campaign.channel === "whatsapp") {
      if (!instanceName) throw new Error("Workspace sem WhatsApp conectado.");
      if (!contact.phone) throw new Error("Contato sem telefone.");
      await sendWhatsapp(instanceName, contact.phone, text);
    } else {
      if (!contact.email) throw new Error("Contato sem e-mail.");
      await sendEmail(contact.email, campaign.name, text);
    }

    await supabase
      .from("campaign_recipients")
      .update({ status: "enviado", sent_at: new Date().toISOString() })
      .eq("id", recipient.id);
    await supabase.from("messages").insert({
      workspace_id: campaign.workspace_id,
      contact_id: contact.id,
      agent_id: campaign.mode === "agent" ? campaign.agent_id : null,
      role: "assistant",
      content: text,
    });
    console.log(`→ [${campaign.channel}] ${contact.name || contact.phone || contact.email}: ${text.slice(0, 60)}`);
  } catch (err) {
    await supabase
      .from("campaign_recipients")
      .update({ status: "falhou", error_message: err.message })
      .eq("id", recipient.id);
    console.error(`✗ [${campaign.channel}] ${contact.name || contact.id}: ${err.message}`);
  }
}

console.log("Worker de disparo iniciado. Ctrl+C pra parar.");

while (true) {
  const next = await pickNextPending();
  if (!next) {
    await sleep(60_000); // nada pendente/fora da janela agora — checa de novo em 1min
    continue;
  }

  await dispatchOne(next);

  const [min, max] = next.campaign.ramp_config?.delaySeconds || [60, 180];
  const wait = (min + Math.random() * (max - min)) * 1000;
  await sleep(wait);
}
