"use client";

import { useState, useTransition } from "react";
import { createApiKey, revokeApiKey, type ApiKeySummary } from "@/app/actions/api-keys";

const ENDPOINT = "/api/v1/leads";

function formatDate(iso: string | null) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ApiKeysManager({ keys, siteUrl }: { keys: ApiKeySummary[]; siteUrl: string }) {
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createApiKey(name);
      if (result.error) {
        setError(result.error);
      } else {
        setNewKey(result.plainKey || null);
        setName("");
      }
    });
  }

  function handleRevoke(id: string) {
    if (!window.confirm("Revogar essa chave? Quem estiver usando ela pra enviar leads para de funcionar imediatamente.")) return;
    startTransition(async () => {
      await revokeApiKey(id);
    });
  }

  const activeExample = newKey || "SUA_CHAVE_AQUI";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        Gere uma chave e envie leads pra este workspace direto de um site, formulário ou outra plataforma (Zapier,
        Make, outro CRM), sem passar pelo WhatsApp.
      </p>

      {keys.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-border">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate flex items-center gap-2">
                  {k.name}
                  {k.revoked_at && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-danger-soft text-danger shrink-0">
                      revogada
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted font-mono">
                  {k.key_prefix}••••••&nbsp;&nbsp;criada em {formatDate(k.created_at)} · último uso: {formatDate(k.last_used_at)}
                </div>
              </div>
              {!k.revoked_at && (
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id)}
                  disabled={pending}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-md shrink-0 cursor-pointer border border-border text-danger disabled:opacity-60"
                >
                  Revogar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {newKey && (
        <div className="bg-warning-soft text-warning-text text-xs rounded-md p-3 flex flex-col gap-1.5">
          <p className="font-bold">Copie sua chave agora — ela não será mostrada de novo.</p>
          <code className="bg-surface border border-border rounded px-2 py-1.5 font-mono text-[11px] break-all">{newKey}</code>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da chave (ex.: site institucional)"
          className="flex-1 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending || !name.trim()}
          className="bg-primary-strong text-white text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer disabled:opacity-60"
        >
          Gerar chave
        </button>
      </div>
      {error && <p className="text-xs text-danger font-medium">{error}</p>}

      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer font-semibold text-text">Como usar</summary>
        <pre className="mt-2 bg-bg border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST ${siteUrl}${ENDPOINT} \\
  -H "Authorization: Bearer ${activeExample}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Maria","phone":"5511999998888","email":"maria@exemplo.com","source":"site"}'`}
        </pre>
        <p className="mt-2">
          <code>phone</code> ou <code>email</code> é obrigatório (pode mandar os dois). Campos extras vão em{" "}
          <code>custom_fields</code> (objeto chave/valor). O lead cai direto na lista de Contatos e no CRM, na fase
          &quot;não abordado&quot;.
        </p>
      </details>
    </div>
  );
}
