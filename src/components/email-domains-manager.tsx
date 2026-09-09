"use client";

import { useState, useTransition } from "react";
import {
  addEmailDomain,
  refreshEmailDomain,
  verifyEmailDomain,
  removeEmailDomain,
  type EmailDomainSummary,
} from "@/app/actions/email-domains";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  verified: { label: "verificado", className: "bg-success-soft text-success" },
  pending: { label: "aguardando DNS", className: "bg-warning-soft text-warning-text" },
  not_started: { label: "aguardando DNS", className: "bg-warning-soft text-warning-text" },
  failed: { label: "falhou", className: "bg-danger-soft text-danger" },
};

function statusOf(status: string) {
  return STATUS_LABEL[status] ?? { label: status, className: "bg-bg text-text-muted" };
}

function formatChecked(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// O valor de DKIM é uma chave pública longa: digitar à mão no painel de DNS é onde o cliente erra.
function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Clique pra copiar"
      className="text-left font-mono text-[11px] break-all hover:text-primary cursor-pointer w-full"
    >
      {copied ? <span className="font-sans font-bold text-success">copiado!</span> : value}
    </button>
  );
}

export function EmailDomainsManager({ domains }: { domains: EmailDomainSummary[] }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
    });
  }

  function handleAdd() {
    if (!name.trim()) return;
    run(async () => {
      const result = await addEmailDomain(name);
      if (!result.error) setName("");
      return result;
    });
  }

  function handleRemove(id: string, domain: string) {
    if (!window.confirm(`Remover ${domain}? As campanhas de e-mail que enviam por esse domínio param de funcionar.`)) return;
    run(() => removeEmailDomain(id));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        Pra enviar campanha de um e-mail do cliente, o domínio dele precisa ser verificado. Adicione
        aqui, mande os registros abaixo pra quem cuida do DNS e clique em verificar quando publicarem.
        A propagação costuma levar de minutos a algumas horas.
      </p>

      {domains.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-border">
          {domains.map((d) => {
            const status = statusOf(d.status);
            const checked = formatChecked(d.last_checked_at);
            const isOpen = openId === d.id;
            return (
              <div key={d.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {d.domain_name}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    {checked && <div className="text-[11px] text-text-muted mt-0.5">conferido em {checked}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.dns_records.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : d.id)}
                        className="text-xs font-bold text-primary cursor-pointer"
                      >
                        {isOpen ? "ocultar DNS" : "ver DNS"}
                      </button>
                    )}
                    {d.status !== "verified" && (
                      <button
                        type="button"
                        onClick={() => run(() => verifyEmailDomain(d.id))}
                        disabled={pending}
                        className="text-xs font-bold border border-border rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                      >
                        Verificar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => run(() => refreshEmailDomain(d.id))}
                      disabled={pending}
                      title="Reler o status no Resend"
                      className="text-xs font-bold border border-border rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                    >
                      Atualizar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(d.id, d.domain_name)}
                      disabled={pending}
                      className="text-xs font-bold text-danger cursor-pointer disabled:opacity-60"
                    >
                      Remover
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs border border-border rounded-md">
                      <thead>
                        <tr className="bg-bg text-text-muted">
                          <th className="text-left font-bold px-2 py-1.5">Tipo</th>
                          <th className="text-left font-bold px-2 py-1.5">Nome</th>
                          <th className="text-left font-bold px-2 py-1.5">Valor</th>
                          <th className="text-left font-bold px-2 py-1.5">TTL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {d.dns_records.map((r, i) => (
                          <tr key={`${r.type}-${r.name}-${i}`} className="align-top">
                            <td className="px-2 py-1.5 font-mono">{r.type}</td>
                            <td className="px-2 py-1.5 font-mono break-all">{r.name}</td>
                            <td className="px-2 py-1.5 max-w-md">
                              <CopyableValue value={r.value} />
                              {r.priority != null && <div className="text-text-muted mt-0.5">prioridade {r.priority}</div>}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{r.ttl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[11px] text-text-muted mt-2">Clique no valor pra copiar.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1.5 flex-1">
          <span className="text-xs font-bold text-text-muted">Adicionar domínio</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="dominio.com.br"
            className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary font-mono"
          />
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending || !name.trim()}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60"
        >
          {pending ? "…" : "Adicionar"}
        </button>
      </div>

      {error && <p className="text-sm text-danger font-medium">{error}</p>}
    </div>
  );
}
