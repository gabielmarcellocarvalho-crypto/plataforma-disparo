"use client";

import { useMemo, useState, useTransition } from "react";
import { estimateSharedEmailCost, estimateWhatsappCost, assessWhatsappRisk, CONNECTOR_GUIDES, type RiskLevel } from "@/lib/pricing-calculator";
import { saveVolumeEstimate, clearVolumeEstimate } from "@/app/actions/workspace";

const USD_TO_BRL = 5.4; // referência aproximada — ajuste conforme o câmbio do dia

const RISK_STYLES: Record<RiskLevel, { bg: string; text: string; dot: string }> = {
  baixo: { bg: "bg-success-soft", text: "text-success", dot: "bg-success" },
  medio: { bg: "bg-warning-soft", text: "text-warning-text", dot: "bg-warning-text" },
  alto: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger" },
};

// Input numérico que aceita ficar vazio enquanto o usuário apaga/redigita, sem forçar um "0" no meio do caminho
// (o bug clássico de <input type="number" value={estadoNumerico}> quando o campo passa por "").
function NumberField({
  label,
  value,
  onChange,
  min,
  className,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          setText(raw);
          onChange(raw === "" ? 0 : Number(raw));
        }}
        onBlur={() => {
          // Ao sair do campo vazio, volta a mostrar o mínimo (ou 0) em vez de deixar em branco.
          if (text === "") setText(String(min ?? 0));
        }}
        className={className || "border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"}
      />
    </div>
  );
}

export function CalculadoraForm({
  workspaceId = null,
  initialEmailsCliente = 0,
  initialEmailsTotalTodosClientes = 0,
  initialWhatsappCliente = 0,
  hasSavedEstimate = false,
}: {
  workspaceId?: string | null;
  initialEmailsCliente?: number;
  initialEmailsTotalTodosClientes?: number;
  initialWhatsappCliente?: number;
  hasSavedEstimate?: boolean;
}) {
  const [emailsCliente, setEmailsCliente] = useState(initialEmailsCliente);
  const [emailsTotalTodosClientes, setEmailsTotalTodosClientes] = useState(initialEmailsTotalTodosClientes);
  const [whatsappPorMes, setWhatsappPorMes] = useState(initialWhatsappCliente);
  const [custoVps, setCustoVps] = useState(40);
  const [clientesNaVps, setClientesNaVps] = useState(1);
  const [salvando, startSalvar] = useTransition();
  const [estimateStatus, setEstimateStatus] = useState<string | null>(null);

  function handleSalvarEstimativa() {
    if (!workspaceId) return;
    setEstimateStatus(null);
    startSalvar(async () => {
      const result = await saveVolumeEstimate(workspaceId, emailsCliente, whatsappPorMes);
      setEstimateStatus(result.error ?? "Estimativa salva — já entra na conta dos outros clientes.");
    });
  }

  function handleLimparEstimativa() {
    if (!workspaceId) return;
    setEstimateStatus(null);
    startSalvar(async () => {
      const result = await clearVolumeEstimate(workspaceId);
      setEstimateStatus(result.error ?? "Estimativa removida — voltou a usar os dados reais desse cliente.");
    });
  }

  const email = useMemo(
    () => estimateSharedEmailCost(emailsCliente, emailsTotalTodosClientes),
    [emailsCliente, emailsTotalTodosClientes]
  );
  const whatsapp = useMemo(
    () => estimateWhatsappCost(whatsappPorMes, custoVps, clientesNaVps),
    [whatsappPorMes, custoVps, clientesNaVps]
  );
  const risco = useMemo(() => assessWhatsappRisk(whatsappPorMes), [whatsappPorMes]);
  const riscoStyle = RISK_STYLES[risco.nivel];

  const emailCustoTotalBrl = email.custoTotalMensalUsd * USD_TO_BRL;
  const emailCustoClienteBrl = email.custoClienteMensalUsd * USD_TO_BRL;

  return (
    <div className="flex flex-col gap-6">
      {workspaceId && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-semibold">Estimativa salva desse cliente</p>
            <p className="text-xs text-text-muted mt-0.5">
              {hasSavedEstimate
                ? "Esse cliente tem volume estimado salvo — ele entra fixo na conta do total de todos os clientes, no lugar do disparo real."
                : "Sem estimativa salva — a conta usa o volume real de disparo desse cliente."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSalvarEstimativa}
              disabled={salvando}
              className="bg-primary text-white text-sm font-semibold rounded-md px-4 py-2 disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar estimativa"}
            </button>
            {hasSavedEstimate && (
              <button
                type="button"
                onClick={handleLimparEstimativa}
                disabled={salvando}
                className="border border-border text-sm font-semibold rounded-md px-4 py-2 disabled:opacity-60"
              >
                Usar dados reais
              </button>
            )}
          </div>
          {estimateStatus && <p className="text-xs text-text-muted basis-full">{estimateStatus}</p>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4">
          <h3 className="font-bold text-[15px]">E-mail (Resend)</h3>
          <p className="text-xs text-text-muted -mt-2">
            Conta compartilhada entre todos os clientes — cada um paga a fatia proporcional ao volume. Valores abaixo já vêm do
            histórico real de campanhas no banco; edite se quiser projetar um cenário diferente.
          </p>

          <NumberField label="E-mails desse cliente por mês (fila de campanhas)" value={emailsCliente} onChange={setEmailsCliente} />
          <NumberField
            label="Volume total de e-mail de TODOS os clientes/mês"
            value={emailsTotalTodosClientes}
            onChange={setEmailsTotalTodosClientes}
          />

          <div className="border-t border-border pt-3 flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Plano necessário (conta toda)</span>
              <span className="font-bold">{email.plano}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Custo total da conta</span>
              <span className="font-bold">
                US$ {email.custoTotalMensalUsd.toFixed(2)} (~R$ {emailCustoTotalBrl.toFixed(2)})
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Fatia desse cliente ({email.percentualDoVolume}% do volume)</span>
              <span className="font-bold text-primary-strong">
                US$ {email.custoClienteMensalUsd.toFixed(2)} (~R$ {emailCustoClienteBrl.toFixed(2)})
              </span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Se o volume desse cliente sozinho já passar do total informado, o plano necessário sobe automaticamente pro próximo tier.
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4">
          <h3 className="font-bold text-[15px]">WhatsApp (Evolution API)</h3>

          <NumberField label="Disparos desse cliente por mês (fila de campanhas)" value={whatsappPorMes} onChange={setWhatsappPorMes} />

          <div className={`flex items-center gap-2 rounded-md px-3 py-2 ${riscoStyle.bg}`}>
            <span className={`w-2 h-2 rounded-full ${riscoStyle.dot}`} />
            <span className={`text-sm font-bold ${riscoStyle.text}`}>
              {risco.label} · ~{risco.disparosPorDia}/dia
            </span>
          </div>
          <p className="text-xs text-text-muted -mt-2">{risco.explicacao}</p>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Custo da VPS (R$/mês)"
              value={custoVps}
              onChange={setCustoVps}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <NumberField
              label="Clientes dividindo essa VPS"
              value={clientesNaVps}
              onChange={setClientesNaVps}
              min={1}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="border-t border-border pt-3 flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Custo de infra rateado (esse cliente)</span>
              <span className="font-bold">R$ {whatsapp.custoTotalMensalBrl.toFixed(2)}/mês</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">≈ por disparo</span>
              <span className="font-bold">R$ {whatsapp.custoPorDisparoBrl.toFixed(4)}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">{whatsapp.observacao}</p>
          </div>
        </div>
      </div>

      <div className="bg-primary-faint border border-border rounded-lg p-5 flex items-center justify-between">
        <span className="text-sm font-bold">Estimativa total mensal pra esse cliente</span>
        <span className="text-xl font-extrabold text-primary-strong">
          R$ {(emailCustoClienteBrl + whatsapp.custoTotalMensalBrl).toFixed(2)}
        </span>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
        <h3 className="font-bold text-[15px] mb-1">Qual conector usar pra cada cliente</h3>
        <p className="text-xs text-text-muted mb-4">Comparativo de referência — só a Evolution API está de fato implementada na plataforma hoje.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {CONNECTOR_GUIDES.map((c) => (
            <div key={c.nome} className="border border-border rounded-md p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">{c.nome}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    c.implementado ? "bg-success-soft text-success" : "bg-border text-text-muted"
                  }`}
                >
                  {c.implementado ? "implementado" : "não implementado"}
                </span>
              </div>
              <div className="text-xs">
                <span className="font-semibold text-text-muted">Indicado pra:</span> {c.indicadoPara}
              </div>
              <div className="text-xs">
                <span className="font-semibold text-text-muted">Risco:</span> {c.risco}
              </div>
              <div className="text-xs">
                <span className="font-semibold text-text-muted">Custo:</span> {c.custo}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
