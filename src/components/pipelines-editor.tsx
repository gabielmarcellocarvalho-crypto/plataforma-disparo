"use client";

import { useState, useTransition } from "react";
import { savePipeline, deletePipeline, type PipelineWithStages, type StageDraft } from "@/app/actions/pipelines";
import { SIGNAL_OPTIONS, defaultStageDraft, type PipelineStage } from "@/lib/pipelines";
import type { ContactStage } from "@/lib/crm-stages";

type Draft = { id: string | null; name: string; isDefault: boolean; stages: StageDraft[] };

function draftDe(p: PipelineWithStages): Draft {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.is_default,
    stages: [...p.stages]
      .sort((a: PipelineStage, b: PipelineStage) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, signal: s.signal })),
  };
}

function draftNovo(): Draft {
  return { id: null, name: "", isDefault: false, stages: defaultStageDraft().map((s) => ({ name: s.name, signal: s.signal })) };
}

export function PipelinesEditor({
  pipelines,
  onChanged,
  onClose,
}: {
  pipelines: PipelineWithStages[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (!draft) return;
    setErro(null);
    startTransition(async () => {
      const r = await savePipeline(draft.id, { name: draft.name, isDefault: draft.isDefault, stages: draft.stages });
      if (r.error) {
        setErro(r.error);
        return;
      }
      setDraft(null);
      onChanged();
    });
  }

  function remover(id: string) {
    setErro(null);
    startTransition(async () => {
      const r = await deletePipeline(id);
      if (r.error) setErro(r.error);
      else {
        setConfirmandoId(null);
        onChanged();
      }
    });
  }

  function mexerEtapa(i: number, patch: Partial<StageDraft>) {
    if (!draft) return;
    setDraft({ ...draft, stages: draft.stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  }

  function moverEtapa(i: number, dir: -1 | 1) {
    if (!draft) return;
    const alvo = i + dir;
    if (alvo < 0 || alvo >= draft.stages.length) return;
    const next = [...draft.stages];
    [next[i], next[alvo]] = [next[alvo], next[i]];
    setDraft({ ...draft, stages: next });
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3 shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Funis</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Cada funil tem as etapas e os nomes que a operação usa. Toda etapa declara o que ela
            significa — é isso que mantém o agente de IA, os relatórios e as automações entendendo o
            funil sem precisar aprender o vocabulário de cada cliente.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {!draft && (
        <div className="flex flex-col gap-1.5">
          {pipelines.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-surface-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold truncate">{p.name}</span>
                  {p.is_default && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-faint text-primary-strong">padrão</span>
                  )}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {p.stages.length} etapa(s): {[...p.stages].sort((a, b) => a.position - b.position).map((s) => s.name).join(" → ")}
                </div>
              </div>

              {confirmandoId === p.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-text-muted">Os leads voltam pro modo de fases padrão, nenhum é apagado.</span>
                  <button type="button" onClick={() => remover(p.id)} disabled={pending} className="text-[11px] font-bold text-white bg-danger px-2.5 py-1 rounded-md cursor-pointer disabled:opacity-60">
                    Remover
                  </button>
                  <button type="button" onClick={() => setConfirmandoId(null)} className="text-[11px] font-semibold text-text-muted cursor-pointer">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setDraft(draftDe(p))} className="text-[11px] font-bold text-primary-strong hover:underline cursor-pointer">
                    editar
                  </button>
                  <button type="button" onClick={() => setConfirmandoId(p.id)} className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer">
                    remover
                  </button>
                </div>
              )}
            </div>
          ))}

          <button type="button" onClick={() => setDraft(draftNovo())} className="self-start text-xs font-bold text-primary-strong hover:underline cursor-pointer mt-1">
            + novo funil
          </button>
        </div>
      )}

      {draft && (
        <div className="border border-primary-soft bg-primary-faint/40 rounded-lg p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-xs font-semibold text-text-muted">Nome do funil</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="ex.: Vendas, Pós-venda, Renovação"
                className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer py-2.5">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
                className="cursor-pointer accent-[var(--color-primary-strong)]"
              />
              Funil padrão
            </label>
          </div>
          <p className="text-[11px] text-text-muted -mt-1.5">
            O funil padrão é onde cai lead novo que ninguém direcionou — do agente, de campanha ou de importação.
          </p>

          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-xs font-bold text-text-muted">Etapas, na ordem do board</span>
            {draft.stages.map((etapa, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <div className="flex flex-col shrink-0">
                  <button type="button" onClick={() => moverEtapa(i, -1)} disabled={i === 0} aria-label="Subir" className="text-text-muted hover:text-primary-strong disabled:opacity-25 cursor-pointer leading-none text-[10px]">
                    ▲
                  </button>
                  <button type="button" onClick={() => moverEtapa(i, 1)} disabled={i === draft.stages.length - 1} aria-label="Descer" className="text-text-muted hover:text-primary-strong disabled:opacity-25 cursor-pointer leading-none text-[10px]">
                    ▼
                  </button>
                </div>
                <input
                  value={etapa.name}
                  onChange={(e) => mexerEtapa(i, { name: e.target.value })}
                  placeholder="nome da etapa"
                  className="flex-1 min-w-[140px] border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary bg-surface"
                />
                <select
                  value={etapa.signal}
                  onChange={(e) => mexerEtapa(i, { signal: e.target.value as ContactStage })}
                  className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary bg-surface cursor-pointer"
                  aria-label="O que essa etapa significa"
                >
                  {SIGNAL_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, idx) => idx !== i) })}
                  aria-label="Remover etapa"
                  className="text-danger text-xs font-bold px-1.5 cursor-pointer"
                >
                  ×
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setDraft({ ...draft, stages: [...draft.stages, { name: "", signal: "abordado" }] })}
              className="self-start text-xs font-bold text-primary-strong hover:underline cursor-pointer"
            >
              + etapa
            </button>
            <p className="text-[11px] text-text-muted">
              O significado à direita é o que a plataforma entende. Duas etapas podem ter o mesmo
              significado (&quot;Proposta enviada&quot; e &quot;Em negociação&quot; são as duas
              &quot;Em proposta&quot;) — o agente coloca o lead na primeira delas, e o time move o
              resto na mão.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={salvar} disabled={pending || !draft.name.trim()} className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2 rounded-md cursor-pointer disabled:opacity-60">
              {draft.id ? "Salvar funil" : "Criar funil"}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={pending} className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-2">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <span className="text-xs text-danger font-medium">{erro}</span>}
    </div>
  );
}
