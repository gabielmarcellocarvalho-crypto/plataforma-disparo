"use client";

import { useState } from "react";
import type { Breakdown, LeadReports, Slice } from "@/lib/lead-reports";

const TOPO = 8; // quantas linhas aparecem antes do "ver todos" — cidade tem 76, ninguém lê 76 barras

function BarraList({ slices, total }: { slices: Slice[]; total: number }) {
  const maior = Math.max(...slices.map((s) => s.value), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {slices.map((s) => (
        <div key={s.label} className="flex items-center gap-2.5">
          <span className="text-xs text-text truncate w-[42%] shrink-0" title={s.label}>
            {s.label}
          </span>
          <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
            {/* Largura relativa ao MAIOR item, não ao total: com uma categoria dominando (350 de 578
                em "Sem campanha"), barras proporcionais ao total viram fios invisíveis. */}
            <div className="h-full bg-primary-strong rounded-full" style={{ width: `${(s.value / maior) * 100}%` }} />
          </div>
          <span className="text-xs font-bold tabular-nums w-14 text-right shrink-0">
            {s.value}
            <span className="text-text-muted font-normal"> · {total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({ breakdown, totalLeads }: { breakdown: Breakdown; totalLeads: number }) {
  const [aberto, setAberto] = useState(false);
  const visiveis = aberto ? breakdown.slices : breakdown.slices.slice(0, TOPO);
  const escondidos = breakdown.slices.length - visiveis.length;
  const semValor = totalLeads - breakdown.preenchidos;

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3">
      <div>
        <h3 className="font-bold text-[15px]">{breakdown.label}</h3>
        <p className="text-xs text-text-muted mt-0.5">
          {breakdown.slices.length} categoria(s)
          {semValor > 0 && ` · ${semValor} lead(s) sem esse dado`}
        </p>
      </div>

      <BarraList slices={visiveis} total={breakdown.preenchidos} />

      {escondidos > 0 && (
        <button type="button" onClick={() => setAberto(true)} className="self-start text-xs font-bold text-primary-strong hover:underline cursor-pointer">
          ver todas ({escondidos} a mais)
        </button>
      )}
      {aberto && breakdown.slices.length > TOPO && (
        <button type="button" onClick={() => setAberto(false)} className="self-start text-xs font-bold text-text-muted hover:text-text cursor-pointer">
          mostrar menos
        </button>
      )}
    </div>
  );
}

function BarrasPorMes({ slices }: { slices: Slice[] }) {
  const maior = Math.max(...slices.map((s) => s.value), 1);
  return (
    <div className="flex items-end gap-2 h-40 overflow-x-auto pb-1">
      {slices.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-1.5 flex-1 min-w-[52px] h-full justify-end">
          <span className="text-xs font-bold tabular-nums">{s.value}</span>
          <div className="w-full bg-primary-strong rounded-t-md min-h-[3px]" style={{ height: `${(s.value / maior) * 100}%` }} />
          <span className="text-[11px] text-text-muted whitespace-nowrap">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function LeadReportsSection({ reports, periodLabel }: { reports: LeadReports; periodLabel: string }) {
  if (reports.total === 0) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-10 text-center text-text-muted shadow-sm">
        <p className="font-semibold text-text">Nenhum lead nesse período</p>
        <p className="text-sm mt-1">Troque o período acima ou importe os contatos.</p>
      </div>
    );
  }

  const cards: Breakdown[] = [
    ...(reports.porResponsavel ? [reports.porResponsavel] : []),
    ...(reports.porFilial ? [reports.porFilial] : []),
    ...reports.porCampo,
    ...(reports.porMotivoPerda ? [reports.porMotivoPerda] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-text-muted">Leads que entraram ({periodLabel})</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">{reports.total}</b>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-text-muted">Ganhos</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none text-success">{reports.ganhos}</b>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-text-muted">Perdidos</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none text-danger">{reports.perdidos}</b>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <span className="text-xs font-semibold text-text-muted">Conversão</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">
            {reports.taxaConversaoPct === null ? "—" : `${reports.taxaConversaoPct.toFixed(1)}%`}
          </b>
          {/* A base é ganho+perdido, não o total: com muito lead ainda sem resposta, dividir pelo
              total mediria o quanto a base é nova, não o quanto o time fecha. */}
          <span className="text-[11px] text-text-muted mt-1 block">
            sobre {reports.ganhos + reports.perdidos} lead(s) já decidido(s); {reports.emAndamento} em aberto
          </span>
        </div>
      </div>

      {reports.porMes.length > 1 && (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-[15px] mb-3">Leads por mês</h3>
          <BarrasPorMes slices={reports.porMes} />
        </div>
      )}

      {reports.porEstagio.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-3">
          <h3 className="font-bold text-[15px]">Onde os leads estão agora</h3>
          <BarraList slices={reports.porEstagio.map((e) => ({ label: e.label, value: e.value }))} total={reports.total} />
        </div>
      )}

      {cards.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          {cards.map((b) => (
            <BreakdownCard key={b.key} breakdown={b} totalLeads={reports.total} />
          ))}
        </div>
      )}
    </div>
  );
}
