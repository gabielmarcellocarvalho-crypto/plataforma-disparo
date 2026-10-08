"use client";

import { useState, useTransition } from "react";
import { Lock, Store } from "lucide-react";
import { ToggleSwitch } from "@/components/toggle-switch";
import { cn } from "@/lib/utils";
import { connectNuvemshop, disconnectNuvemshop, testNuvemshop, updateNuvemshopCapabilities } from "@/app/actions/nuvemshop";

export type CapabilityView = {
  id: string;
  label: string;
  kind: "leitura" | "escrita";
  available: boolean;
  description: string;
};

export type NuvemshopState = {
  connected: boolean;
  storeId: string | null;
  storeName: string | null;
  status: "conectado" | "reconectar" | null;
  enabled: string[];
};

const btn = "text-xs font-bold px-3 py-2 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";

export function NuvemshopPanel({ state, capabilities }: { state: NuvemshopState; capabilities: CapabilityView[] }) {
  const [pending, start] = useTransition();
  const [storeId, setStoreId] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState<string[]>(state.enabled);
  const [message, setMessage] = useState<{ tone: "ok" | "erro"; text: string } | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  function connect() {
    setMessage(null);
    start(async () => {
      const res = await connectNuvemshop({ storeId, token });
      if (res.error !== null) return setMessage({ tone: "erro", text: res.error });
      setToken("");
      setMessage({ tone: "ok", text: `Conectado${res.storeName ? ` à loja ${res.storeName}` : ""}. Agora libere as permissões abaixo.` });
    });
  }

  function test() {
    setMessage(null);
    start(async () => {
      const res = await testNuvemshop();
      setMessage(res.error ? { tone: "erro", text: res.error } : { tone: "ok", text: "Conexão funcionando." });
    });
  }

  function toggle(id: string, on: boolean) {
    const previous = enabled;
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((c) => c !== id);
    setEnabled(next);
    setMessage(null);
    start(async () => {
      const res = await updateNuvemshopCapabilities(next);
      if (res.error) {
        setEnabled(previous);
        setMessage({ tone: "erro", text: res.error });
      }
    });
  }

  function disconnect() {
    setMessage(null);
    start(async () => {
      const res = await disconnectNuvemshop();
      if (res.error) setMessage({ tone: "erro", text: res.error });
      setConfirmingDisconnect(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p
          role="status"
          className={cn(
            "text-sm font-medium rounded-lg px-3.5 py-2.5",
            message.tone === "ok" ? "bg-success-soft text-success" : "bg-warning-soft text-warning-text"
          )}
        >
          {message.text}
        </p>
      )}

      <section className="bg-surface border border-border rounded-xl shadow-sm">
        <div className="flex items-start gap-3 px-4 py-4 border-b border-border">
          <span className="grid place-items-center w-10 h-10 rounded-lg bg-surface-2 border border-border shrink-0" aria-hidden>
            <Store className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold">Loja Nuvemshop</h2>
            <p className="text-sm text-text-muted mt-0.5 leading-relaxed max-w-3xl">
              O agente consulta a loja durante a conversa. Por enquanto só consulta: nada é alterado na loja.
            </p>
          </div>
        </div>

        {state.connected ? (
          <div className="px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-bold">{state.storeName || "Loja"}</span>
              <span className="text-text-muted">ID {state.storeId}</span>
              <span
                className={cn(
                  "text-[11px] font-bold px-2 py-0.5 rounded-full",
                  state.status === "conectado" ? "bg-success-soft text-success" : "bg-warning-soft text-warning-text"
                )}
              >
                {state.status === "conectado" ? "Conectada" : "Reconectar"}
              </span>
            </div>
            {state.status === "reconectar" && (
              <p className="text-xs text-warning-text">
                A Nuvemshop recusou o token. Cole um token novo abaixo (reconectar) ou gere outro no painel da loja.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={test} className={cn(btn, "border border-border bg-surface hover:bg-surface-2")}>
                Testar conexão
              </button>
              {confirmingDisconnect ? (
                <>
                  <button type="button" disabled={pending} onClick={disconnect} className={cn(btn, "bg-danger text-white")}>
                    Confirmar desconexão
                  </button>
                  <button type="button" disabled={pending} onClick={() => setConfirmingDisconnect(false)} className={cn(btn, "border border-border")}>
                    Cancelar
                  </button>
                </>
              ) : (
                <button type="button" disabled={pending} onClick={() => setConfirmingDisconnect(true)} className={cn(btn, "border border-border text-danger hover:bg-surface-2")}>
                  Desconectar
                </button>
              )}
            </div>
          </div>
        ) : null}

        {(!state.connected || state.status === "reconectar") && (
          <div className="px-4 py-4 flex flex-col gap-3 border-t border-border first:border-t-0">
            <ol className="text-xs text-text-muted leading-relaxed list-decimal pl-4 flex flex-col gap-0.5">
              <li>No painel da Nuvemshop, abra <strong className="text-text">Aplicativos sob medida</strong> e crie um aplicativo.</li>
              <li>Marque só permissões de <strong className="text-text">leitura</strong> (pedidos, produtos e clientes).</li>
              <li>Copie o ID da loja e o token e cole aqui.</li>
            </ol>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-text-muted">ID da loja</span>
                <input
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-text-muted">Token de acesso</span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  autoComplete="off"
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
            <div>
              <button type="button" disabled={pending || !storeId || !token} onClick={connect} className={cn(btn, "bg-primary-strong text-white")}>
                {pending ? "Verificando..." : state.connected ? "Reconectar" : "Conectar"}
              </button>
            </div>
          </div>
        )}
      </section>

      {state.connected && (
        <section className="bg-surface border border-border rounded-xl shadow-sm">
          <div className="px-4 py-4 border-b border-border">
            <h2 className="text-base font-bold">Permissões</h2>
            <p className="text-sm text-text-muted mt-0.5 max-w-3xl">
              Libere só o que for necessário. Cada agente escolhe, na aba Integrações dele, quais dessas permissões usa.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {capabilities.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold flex items-center gap-2">
                    {c.label}
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
                      {c.kind === "leitura" ? "Só leitura" : "Altera a loja"}
                    </span>
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">{c.description}</p>
                </div>
                {c.available ? (
                  <ToggleSwitch
                    checked={enabled.includes(c.id)}
                    onCheckedChange={(v) => toggle(c.id, v)}
                    ariaLabel={`${enabled.includes(c.id) ? "Desativar" : "Ativar"} ${c.label}`}
                  />
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-text-muted shrink-0">
                    <Lock className="w-3.5 h-3.5" aria-hidden /> Em breve
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
