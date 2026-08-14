"use client";

// "Boxing" com 2 visões (Volume / Conversão) — cards + gráfico embutido, alternando por abas dentro
// do mesmo card, no espírito do dashboard do Kommo (mas só com métricas que a gente realmente tem).
import { useState, type ReactNode } from "react";
import { MessagesAreaChart } from "@/components/charts/messages-area-chart";
import { DonutChart, type DonutSlice } from "@/components/charts/donut-chart";

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-bg border border-border rounded-xl p-4">
      <b className="block text-xl font-extrabold tracking-tight leading-none tabular-nums">{value}</b>
      <span className="text-xs font-semibold text-text-muted block mt-1.5">{label}</span>
      {sub && <span className="text-[11px] text-text-muted/80 block mt-0.5">{sub}</span>}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm font-bold px-4 py-2 rounded-lg cursor-pointer transition-colors ${
        active ? "bg-primary-strong text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg"
      }`}
    >
      {children}
    </button>
  );
}

export type VolumeTabData = {
  leadsRecebidos: number;
  leadsAbordados: number;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
  conversasIniciadas: number;
  conversasEmAndamento: number;
  chartData: { date: string; mensagens: number }[];
};

export type ConversionTabData = {
  taxaResposta: number | null;
  taxaInteresse: number | null;
  taxaQualificacao: number | null;
  taxaFechamento: number | null;
  showFechamento: boolean;
  tempoMedioRespostaMin: number | null;
  conversasNaoRespondidas: number;
  maisTempoEsperandoMin: number | null;
  leadSources: DonutSlice[];
};

function fmtPct(v: number | null) {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function fmtMin(v: number | null) {
  if (v === null) return "—";
  if (v < 60) return `${v.toFixed(v < 10 ? 1 : 0)}min`;
  const h = Math.floor(v / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function OverviewInsightsBox({
  periodLabel,
  volume,
  conversion,
  hasConversion = true,
}: {
  periodLabel: string;
  volume: VolumeTabData;
  conversion: ConversionTabData;
  hasConversion?: boolean;
}) {
  const [tab, setTab] = useState<"volume" | "conversao">("volume");
  const activeTab = hasConversion ? tab : "volume";

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        {hasConversion ? (
          <div className="flex items-center gap-1.5 bg-bg rounded-xl p-1">
            <TabButton active={activeTab === "volume"} onClick={() => setTab("volume")}>Volume</TabButton>
            <TabButton active={activeTab === "conversao"} onClick={() => setTab("conversao")}>Conversão</TabButton>
          </div>
        ) : (
          <h4 className="text-sm font-bold">Volume</h4>
        )}
        <span className="text-xs text-text-muted capitalize">{periodLabel}</span>
      </div>

      {activeTab === "volume" ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile label="Leads recebidos" value={volume.leadsRecebidos} />
            <Tile label="Leads abordados" value={volume.leadsAbordados} />
            <Tile label="Mensagens enviadas" value={volume.mensagensEnviadas} />
            <Tile label="Mensagens recebidas" value={volume.mensagensRecebidas} />
            <Tile label="Conversas iniciadas" value={volume.conversasIniciadas} />
            <Tile label="Conversas em andamento" value={volume.conversasEmAndamento} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-text-muted mb-2">Mensagens enviadas por dia</h4>
            <MessagesAreaChart data={volume.chartData} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={`grid grid-cols-2 sm:grid-cols-3 ${conversion.showFechamento ? "lg:grid-cols-7" : "lg:grid-cols-6"} gap-3`}>
            <Tile label="Taxa de resposta" value={fmtPct(conversion.taxaResposta)} />
            <Tile label="Taxa de interesse" value={fmtPct(conversion.taxaInteresse)} />
            <Tile label="Taxa de qualificação" value={fmtPct(conversion.taxaQualificacao)} />
            {conversion.showFechamento && <Tile label="Taxa de fechamento" value={fmtPct(conversion.taxaFechamento)} />}
            <Tile label="Tempo de resposta" value={fmtMin(conversion.tempoMedioRespostaMin)} sub="média" />
            <Tile label="Sem resposta nossa" value={conversion.conversasNaoRespondidas} />
            <Tile label="Maior espera" value={fmtMin(conversion.maisTempoEsperandoMin)} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-text-muted mb-2">Fontes de lead</h4>
            {conversion.leadSources.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">Nenhum lead recebido nesse período ainda.</p>
            ) : (
              <DonutChart data={conversion.leadSources} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
