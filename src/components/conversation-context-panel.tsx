"use client";

import type { ContactDetail, ContactNote } from "@/app/actions/contacts";
import { formatFieldValue, readMultiValue, type CustomFieldDef } from "@/lib/custom-fields";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" });
}

// Painel de contexto do lead ao lado do chat (estilo Kommo/HubSpot inbox): quem é, em que etapa está,
// dados coletados e as notas internas — sem precisar abrir o drawer pra responder com contexto.
export function ConversationContextPanel({
  detail,
  notes,
  loading,
  stageName,
  agentName,
  originCampaign,
  fieldDefs,
  teamMemberName,
  onOpenDrawer,
  onClose,
}: {
  detail: ContactDetail | null;
  notes: ContactNote[];
  loading: boolean;
  stageName: string;
  agentName: string | null;
  originCampaign: string | null;
  fieldDefs: CustomFieldDef[];
  teamMemberName: string | null;
  onOpenDrawer: () => void;
  onClose: () => void;
}) {
  const fields = detail
    ? Object.entries(detail.custom_fields || {})
        .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => {
          const def = fieldDefs.find((d) => d.key === k);
          return { key: k, label: def?.label ?? k.replace(/_/g, " "), value: def ? formatFieldValue(def, v) : Array.isArray(v) ? readMultiValue(v).join(", ") : String(v) };
        })
    : [];

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 text-xs py-1">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="font-semibold text-right break-words min-w-0">{value}</span>
    </div>
  );

  return (
    <aside className="hidden xl:flex flex-col min-h-0 border-l border-border bg-surface" aria-label="Contexto do lead">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Sobre o lead</span>
        <button type="button" onClick={onClose} title="Esconder painel" aria-label="Esconder painel" className="text-text-muted hover:text-text cursor-pointer p-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {loading && !detail ? (
          <p className="text-xs text-text-muted">Carregando…</p>
        ) : !detail ? (
          <p className="text-xs text-text-muted">Sem dados do lead.</p>
        ) : (
          <>
            {(detail.needs_attention || detail.flagged_reason) && (
              <div className={`rounded-md px-3 py-2 text-xs font-semibold ${detail.needs_attention ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning-text"}`}>
                {detail.needs_attention ? detail.attention_reason || "Precisa de atenção" : detail.flagged_reason}
              </div>
            )}

            <section>
              {row("Etapa", stageName)}
              {row("Atendimento", agentName ? (detail.needs_attention ? "Humano (assumido)" : `IA · ${agentName}`) : "Humano")}
              {teamMemberName && row("Responsável", teamMemberName)}
              {detail.company_name && row("Empresa", detail.company_name)}
              {originCampaign && row("Origem", originCampaign)}
              {detail.email && row("E-mail", detail.email)}
              {row("Entrou em", fmtDate(detail.created_at))}
              {row("Mensagens", detail.message_count)}
              {detail.lost_reason && row("Motivo da perda", detail.lost_reason)}
            </section>

            {detail.tags && detail.tags.length > 0 && (
              <section>
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {detail.tags.map((t) => (
                    <span key={t} className="text-[10px] font-bold rounded-full bg-primary-soft text-primary-strong px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {fields.length > 0 && (
              <section>
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Dados coletados</h4>
                {fields.map((f) => (
                  <div key={f.key}>{row(f.label, f.value)}</div>
                ))}
              </section>
            )}

            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Notas internas ({notes.length})</h4>
              {notes.length === 0 ? (
                <p className="text-xs text-text-muted">Nenhuma nota. Use “Nota interna” no campo de mensagem — o lead não vê.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {notes.slice(0, 5).map((n) => (
                    <li key={n.id} className="rounded-md bg-warning-soft/60 border border-warning-text/15 px-2.5 py-2">
                      <p className="text-xs whitespace-pre-wrap">{n.content}</p>
                      <p className="text-[10px] text-text-muted mt-1">
                        {n.author_name || "equipe"} · {fmtDate(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <div className="p-3 border-t border-border flex flex-col gap-1.5">
        <button type="button" onClick={onOpenDrawer} className="text-xs font-bold px-3 py-2 rounded-md bg-primary-strong text-white cursor-pointer">
          Abrir ficha do lead
        </button>
      </div>
    </aside>
  );
}
