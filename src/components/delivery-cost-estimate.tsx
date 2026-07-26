"use client";

import { useState } from "react";
import { DEFAULT_DELIVERY_RATE_BRL } from "@/lib/cost-constants";

// Estimativa de custo de entrega via API oficial (Meta, repassado pelo BSP a custo) — não é custo
// medido de verdade (a plataforma ainda não distingue mensagem cobrável de mensagem em janela grátis),
// é só uma projeção editável em cima do volume real de mensagens do mês. Ver calculadora pra detalhe.
export function DeliveryCostEstimate({ totalMessages, iaCostBrl }: { totalMessages: number; iaCostBrl: number }) {
  const [rate, setRate] = useState(String(DEFAULT_DELIVERY_RATE_BRL));
  const rateNum = Number(rate.replace(",", ".")) || 0;
  const deliveryCostBrl = totalMessages * rateNum;
  const totalEstimatedBrl = iaCostBrl + deliveryCostBrl;

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-[15px]">Custo total estimado (IA + entrega API oficial)</h3>
          <p className="text-xs text-text-muted mt-0.5 max-w-prose">
            Entrega é uma estimativa (tarifa Meta/360dialog repassada a custo, ~R$0,037/msg no Brasil) — a plataforma
            ainda não distingue mensagem cobrável de mensagem em janela grátis. Ajuste a tarifa se seu cenário for diferente.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs font-semibold text-text-muted">Tarifa de entrega (R$/msg)</label>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className="w-20 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="border border-border rounded-md p-3.5">
          <div className="text-xs text-text-muted font-semibold mb-1">Custo de IA (mês)</div>
          <div className="text-lg font-extrabold">R$ {iaCostBrl.toFixed(2)}</div>
        </div>
        <div className="border border-border rounded-md p-3.5">
          <div className="text-xs text-text-muted font-semibold mb-1">Entrega estimada ({totalMessages} msg)</div>
          <div className="text-lg font-extrabold">R$ {deliveryCostBrl.toFixed(2)}</div>
        </div>
        <div className="border border-primary-soft bg-primary-faint rounded-md p-3.5">
          <div className="text-xs text-primary-strong font-semibold mb-1">Total estimado</div>
          <div className="text-lg font-extrabold text-primary-strong">R$ {totalEstimatedBrl.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
