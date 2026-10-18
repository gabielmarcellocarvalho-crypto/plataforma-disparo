import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getContactDetail } from "@/app/actions/contacts";
import { getTasksForRecord } from "@/app/actions/tasks";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { listPipelines } from "@/app/actions/pipelines";
import { listTeamMembers } from "@/app/actions/team";
import { resolveStageLabels, STAGE_ORDER, daysSince, type ContactStage } from "@/lib/crm-stages";
import { sortStages, stageForSignal } from "@/lib/pipelines";
import { formatFieldValue, readMultiValue } from "@/lib/custom-fields";
import { isTaskOverdue } from "@/lib/tasks";
import { TEMPERATURE_UI, type Temperature } from "@/lib/lead-analysis";

const TZ = "America/Sao_Paulo";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

// Campos que vêm de anúncio/origem — vão pro bloco "Origem" em vez de se misturar com os dados do lead.
const ORIGIN_KEYS = ["origem", "anuncio_titulo", "anuncio_texto", "anuncio_link", "anuncio_id", "campanha"];

// Ficha completa do lead (estilo HubSpot): barra de etapas, propriedades, linha do tempo da conversa
// com as notas internas, tarefas e origem — tudo numa página só, com link próprio.
export default async function LeadRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) notFound();

  const supabase = await createClient();
  const [detail, tasks, fieldDefs, pipelines, team, { data: ws }, { data: msgs }] = await Promise.all([
    getContactDetail(id),
    getTasksForRecord("contact", id),
    listCustomFieldDefs(),
    listPipelines(),
    listTeamMembers(),
    supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle(),
    supabase
      .from("messages")
      .select("id, role, content, created_at, agent_id")
      .eq("contact_id", id)
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);
  if (!detail) notFound();
  const { contact, notes } = detail;

  const labels = resolveStageLabels(ws?.crm_stage_labels);
  const pipeline = pipelines.find((p) => p.id === contact.pipeline_id) ?? pipelines.find((p) => p.is_default) ?? null;
  const stages = pipeline && pipeline.stages.length > 0 ? sortStages(pipeline.stages) : null;
  const currentStageId = stages ? (stages.find((s) => s.id === contact.pipeline_stage_id) ?? stageForSignal(contact.stage as ContactStage, stages))?.id : null;
  const stageBar = stages
    ? stages.map((s) => ({ key: s.id, label: s.name, current: s.id === currentStageId }))
    : STAGE_ORDER.map((s) => ({ key: s, label: labels[s], current: s === contact.stage }));
  const currentIndex = stageBar.findIndex((s) => s.current);

  const cf = contact.custom_fields || {};
  const fieldRows = Object.entries(cf)
    .filter(([k, v]) => !ORIGIN_KEYS.includes(k) && v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      const def = fieldDefs.find((d) => d.key === k);
      return { key: k, label: def?.label ?? k.replace(/_/g, " "), value: def ? formatFieldValue(def, v) : Array.isArray(v) ? readMultiValue(v).join(", ") : String(v) };
    });
  const originRows = ORIGIN_KEYS.filter((k) => cf[k]).map((k) => ({ key: k, label: k.replace(/_/g, " "), value: String(cf[k]) }));
  const teamName = contact.team_member_id ? team.find((m) => m.id === contact.team_member_id)?.name : null;
  const digits = (contact.phone || "").replace(/\D/g, "");

  const timeline = [
    ...(msgs || []).map((m) => ({ kind: "msg" as const, at: m.created_at as string, id: m.id as string, role: m.role as string, text: m.content as string })),
    ...notes.map((n) => ({ kind: "note" as const, at: n.created_at, id: n.id, role: "note", text: n.content, author: n.author_name })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const card = "bg-surface border border-border rounded-lg shadow-sm p-4";
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-border last:border-0">
      <span className="text-text-muted capitalize shrink-0">{label}</span>
      <span className="font-semibold text-right break-words min-w-0">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link href="/crm" className="hover:text-text font-semibold">Pipeline</Link>
        <span>/</span>
        <span className="truncate">{contact.name || contact.phone || "lead"}</span>
      </div>

      <div className={`${card} flex flex-col gap-4`}>
        <div className="flex items-center gap-4 flex-wrap">
          {contact.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <span className="grid place-items-center w-14 h-14 rounded-full bg-primary-soft text-primary-strong font-bold" aria-hidden>
              {(contact.name || contact.phone || "?").trim().slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight truncate">{contact.name || contact.phone || "sem nome"}</h1>
            <p className="text-sm text-text-muted">
              {[contact.phone, contact.email, contact.company_name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/conversas?contact=${contact.id}`} className="text-xs font-bold px-3 py-2 rounded-md bg-primary-strong text-white">
              Abrir conversa
            </Link>
            {digits && (
              <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className="text-xs font-bold px-3 py-2 rounded-md border border-border text-text-muted hover:text-text">
                WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* Barra de etapas: onde o lead está no funil e quanto já andou. */}
        <div className="flex gap-1 overflow-x-auto">
          {stageBar.map((s, i) => (
            <div
              key={s.key}
              className={`flex-1 min-w-[110px] text-center text-[11px] font-bold px-2 py-2 rounded ${
                s.current ? "bg-primary-strong text-white" : i < currentIndex ? "bg-primary-soft text-primary-strong" : "bg-surface-2 text-text-muted"
              }`}
              title={s.label}
            >
              <span className="block truncate">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted -mt-2">
          Há {daysSince(contact.stage_changed_at)} dia(s) nesta etapa{pipeline ? ` · funil ${pipeline.name}` : ""}. Para mover, use o Pipeline ou a conversa.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr_300px] items-start">
        <div className="flex flex-col gap-4">
          <section className={card}>
            <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">Propriedades</h2>
            {row("Entrou em", fmtDate(contact.created_at))}
            {row("Responsável", teamName || "—")}
            {contact.deal_value != null && row("Valor estimado", Number(contact.deal_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))}
            {row("Mensagens", contact.message_count)}
            {contact.lost_reason && row("Motivo da perda", contact.lost_reason)}
            {fieldRows.map((f) => (
              <div key={f.key}>{row(f.label, f.value)}</div>
            ))}
          </section>
          {contact.tags && contact.tags.length > 0 && (
            <section className={card}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">Tags</h2>
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <span key={t} className="text-[11px] font-bold rounded-full bg-primary-soft text-primary-strong px-2 py-0.5">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className={card}>
          <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-3">Linha do tempo</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-text-muted">Sem mensagens nem notas ainda.</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {timeline.map((t) => (
                <li
                  key={`${t.kind}-${t.id}`}
                  className={`rounded-lg px-3 py-2 text-sm border ${
                    t.kind === "note" ? "bg-warning-soft/60 border-warning-text/20" : t.role === "user" ? "bg-surface border-border" : "bg-primary-faint border-transparent"
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-0.5">
                    {t.kind === "note" ? `Nota interna · ${t.author || "equipe"}` : t.role === "user" ? "Lead" : "Nós"} · {fmtDateTime(t.at)}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                </li>
              ))}
            </ol>
          )}
          {(msgs?.length ?? 0) >= 150 && <p className="text-xs text-text-muted mt-3">Mostrando as 150 mensagens mais recentes.</p>}
        </section>

        <div className="flex flex-col gap-4">
          {(contact.needs_attention || contact.flagged_reason) && (
            <section className={`${card} ${contact.needs_attention ? "border-danger/40" : "border-warning-text/30"}`}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-1">Atenção</h2>
              <p className="text-sm">{contact.needs_attention ? contact.attention_reason || "Precisa de atenção" : contact.flagged_reason}</p>
            </section>
          )}
          {contact.ai_summary && (
            <section className={`${card} border-primary-soft`}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-primary-strong mb-1.5">
                Resumo da IA
                {contact.ai_temperature && TEMPERATURE_UI[contact.ai_temperature as Temperature]
                  ? ` · ${TEMPERATURE_UI[contact.ai_temperature as Temperature].icon} ${TEMPERATURE_UI[contact.ai_temperature as Temperature].label}${contact.ai_score != null ? ` ${contact.ai_score}` : ""}`
                  : ""}
              </h2>
              <p className="text-sm">{contact.ai_summary}</p>
              {contact.ai_next_action && (
                <p className="text-xs mt-2">
                  <b>Próxima ação:</b> {contact.ai_next_action}
                </p>
              )}
            </section>
          )}
          <section className={card}>
            <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">Tarefas ({tasks.filter((t) => !t.completed_at).length} abertas)</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma tarefa.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="text-sm flex items-start gap-2">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${t.completed_at ? "bg-success" : isTaskOverdue(t.due_at, t.completed_at) ? "bg-danger" : "bg-primary"}`} aria-hidden />
                    <span className={t.completed_at ? "line-through text-text-muted" : ""}>
                      {t.title}
                      {t.due_at && <span className="block text-[11px] text-text-muted">{fmtDateTime(t.due_at)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/agenda" className="block text-xs font-bold text-primary-strong mt-3 hover:underline">Ver todas as tarefas</Link>
          </section>
          {originRows.length > 0 && (
            <section className={card}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">Origem</h2>
              {originRows.map((f) => (
                <div key={f.key}>{row(f.label, f.value)}</div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
