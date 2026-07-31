// Central de atenção — checklist de saúde operacional do workspace, mostrado só pra colaborador na
// Visão geral (cliente não vê Agentes/Configurações/custo, então alertas sobre essas coisas não
// fariam sentido pra ele). Só aparecem os itens que estão realmente acontecendo agora — nada de
// checklist estático com "0" em tudo.
import { createClient } from "@/lib/supabase/server";
import { STALE_AFTER_DAYS, daysSince } from "@/lib/crm-stages";

export type AttentionAlert = { key: string; label: string; href: string };

export async function getAttentionAlerts(workspaceId: string): Promise<AttentionAlert[]> {
  const supabase = await createClient();

  const [
    { count: aguardandoIntervencao },
    { count: sinalizados },
    { count: naoAbordados },
    { data: interessadosRows },
    { count: agentesPausados },
    { count: campanhasTotal },
    { count: campanhasAtivas },
    { count: disparosComFalha },
    { data: nameRows },
  ] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("needs_attention", true),
    // Sinalizado pelo agente (ex.: risco de spam/abuso, pedido fora do escopo) — ele continua
    // respondendo normal, só marca a conversa pra alguém dar uma olhada quando sobrar tempo.
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("needs_attention", false).not("flagged_reason", "is", null),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("stage", "nao_abordado"),
    supabase.from("contacts").select("stage_changed_at").eq("workspace_id", workspaceId).eq("stage", "interessado"),
    supabase.from("agents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pausado"),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "ativa"),
    // Falha no envio (número banido/inválido, rate limit da Evolution etc.) — o sinal prático de
    // risco de spam/bloqueio que a gente tem hoje: disparo que a própria API recusou.
    supabase.from("campaign_recipients").select("id, campaigns!inner(workspace_id)", { count: "exact", head: true }).eq("campaigns.workspace_id", workspaceId).eq("status", "falhou"),
    supabase.from("contacts").select("id, name").eq("workspace_id", workspaceId).limit(20000),
  ]);

  const interessadosParados = (interessadosRows || []).filter((c) => daysSince(c.stage_changed_at) >= STALE_AFTER_DAYS).length;

  // "Sem dados obrigatórios" = sem nome — telefone/e-mail já são obrigatórios na criação (não dá
  // pra existir contato sem os dois), nome é o campo que mais fica de fora em importação/lead cru.
  const semNome = (nameRows || []).filter((c) => !c.name || !c.name.trim()).length;

  // "Duplicados" = mesmo nome (normalizado) aparecendo em 2+ contatos — telefone/e-mail já têm
  // índice único por workspace, então duplicata exata desses campos não existe; nome repetido é o
  // sinal prático de lead cadastrado 2x (import duplicado, formulário reenviado etc.).
  const byName = new Map<string, number>();
  for (const c of nameRows || []) {
    const key = (c.name || "").trim().toLowerCase();
    if (!key) continue;
    byName.set(key, (byName.get(key) || 0) + 1);
  }
  let duplicados = 0;
  for (const count of byName.values()) if (count > 1) duplicados += count;

  const alerts: AttentionAlert[] = [];
  if (aguardandoIntervencao) alerts.push({ key: "intervencao", label: `${aguardandoIntervencao} conversa(s) aguardando intervenção`, href: "/conversas" });
  if (sinalizados) alerts.push({ key: "sinalizado", label: `${sinalizados} conversa(s) sinalizada(s) pelo agente (risco/atenção)`, href: "/conversas" });
  if (naoAbordados) alerts.push({ key: "nao_abordados", label: `${naoAbordados} lead(s) ainda não abordado(s)`, href: "/crm" });
  if (interessadosParados) alerts.push({ key: "interessado_parado", label: `${interessadosParados} lead(s) interessado(s) sem contato há ${STALE_AFTER_DAYS}+ dias`, href: "/crm" });
  if (agentesPausados) alerts.push({ key: "agente_pausado", label: `${agentesPausados} agente(s) pausado(s)`, href: "/agentes" });
  if (!process.env.RESEND_API_KEY) alerts.push({ key: "email", label: "E-mail não configurado", href: "/configuracoes" });
  // Alertas de campanha só fazem sentido pra workspace que efetivamente usa disparo em massa —
  // quem só roda agente de IA (SDR/Closer puro) nunca teve campanha, então "nenhuma ativa" seria
  // ruído, não alerta real.
  if (campanhasTotal) {
    if (!campanhasAtivas) alerts.push({ key: "sem_campanha", label: "Nenhuma campanha ativa", href: "/campanhas" });
    if (disparosComFalha) alerts.push({ key: "disparo_falhou", label: `${disparosComFalha} disparo(s) com falha (risco de spam/bloqueio)`, href: "/campanhas" });
  }
  if (semNome) alerts.push({ key: "dados_faltando", label: `${semNome} contato(s) sem dados obrigatórios`, href: "/contatos" });
  if (duplicados) alerts.push({ key: "duplicados", label: `${duplicados} contato(s) duplicados`, href: "/contatos" });

  return alerts;
}
