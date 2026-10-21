"use client";

import { useState, useTransition } from "react";
import { createApiKey, revokeApiKey, type ApiKeySummary } from "@/app/actions/api-keys";

const ENDPOINT = "/api/v1/leads";

function formatDate(iso: string | null) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Dois blocos separados em Configurações > API, cada um com as suas chaves:
//   - "entrada": receber leads de fora (site, formulário, Zapier) — a chave só cria lead;
//   - "leitura": enviar os dados pra um dashboard/BI — a chave só consulta.
// Chave antiga ("completa", de antes da separação) aparece em "entrada", que era o uso dela.
export type ApiKeyKind = "entrada" | "leitura";

export function ApiKeysManager({ keys, siteUrl, kind }: { keys: ApiKeySummary[]; siteUrl: string; kind: ApiKeyKind }) {
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mine = keys.filter((k) => (kind === "leitura" ? k.scope === "leitura" : k.scope !== "leitura"));

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createApiKey(name, kind);
      if (result.error) {
        setError(result.error);
      } else {
        setNewKey(result.plainKey || null);
        setName("");
      }
    });
  }

  function handleRevoke(id: string) {
    const uso = kind === "leitura" ? "ler os dados" : "enviar leads";
    if (!window.confirm(`Revogar essa chave? Quem estiver usando ela pra ${uso} para de funcionar imediatamente.`)) return;
    startTransition(async () => {
      await revokeApiKey(id);
    });
  }

  const activeExample = newKey || "SUA_CHAVE_AQUI";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        {kind === "leitura"
          ? "Chave pra um dashboard, BI ou planilha puxar os leads, MQLs e SQLs deste workspace. Ela só consulta: não cria nem altera nada."
          : "Chave pra mandar leads pra este workspace direto de um site, formulário ou outra plataforma (Zapier, Make, outro CRM), sem passar pelo WhatsApp. Ela só cria leads."}
      </p>

      {mine.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-border">
          {mine.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate flex items-center gap-2">
                  {k.name}
                  {k.scope === "completa" && (
                    <span
                      title="Criada antes da separação: além de enviar leads, também consegue ler os dados."
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-surface-2 text-text-muted"
                    >
                      antiga · também lê
                    </span>
                  )}
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
          placeholder={kind === "leitura" ? "Nome da chave (ex.: dashboard Looker)" : "Nome da chave (ex.: site institucional)"}
          className="flex-1 min-w-0 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
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

      {kind === "entrada" ? (
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
            <code>custom_fields</code> (objeto chave/valor). Para marcar o lead, mande <code>tags</code> (lista, ex.:{" "}<code>[&quot;Feira&quot;,&quot;Sócio&quot;]</code>): tag que já existe no workspace é reaproveitada e as tags que o lead já tinha são mantidas. O lead cai direto na lista de Contatos e no CRM, na fase
            &quot;não abordado&quot;. Para gravar UTMs, mande em <code>custom_fields</code> com o nome <code>utm_source</code>,{" "}
            <code>utm_medium</code>, <code>utm_campaign</code> etc.
          </p>
        </details>
      ) : (
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer font-semibold text-text">Como usar</summary>
          <pre className="mt-2 bg-bg border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`# Totais do período (leads, MQL, SQL, oportunidades, clientes, perdidos)
curl "${siteUrl}/api/v1/funil?desde=2026-10-01&ate=2026-10-31" \\
  -H "Authorization: Bearer ${activeExample}"

# Lista de leads, com a classificação de cada um
curl "${siteUrl}${ENDPOINT}?desde=2026-10-01&pagina=1&por_pagina=100" \\
  -H "Authorization: Bearer ${activeExample}"

# Só os leads que vieram de campanha da Meta (funciona igual no /funil)
curl "${siteUrl}${ENDPOINT}?origem=meta&desde=2026-10-01" \\
  -H "Authorization: Bearer ${activeExample}"`}
          </pre>
          <p className="mt-2">
            Filtros opcionais: <code>desde</code> e <code>ate</code> (AAAA-MM-DD, pela data de entrada do lead, horário de Brasília).
            Paginação: <code>pagina</code> (a partir de 1) e <code>por_pagina</code> (até 500, padrão 100); a resposta traz{" "}
            <code>paginacao.total</code> e <code>total_paginas</code>.
          </p>
          <p className="mt-2">
            Para pegar só uma parte dos leads (vale para <code>/leads</code> e <code>/funil</code>, e dá para combinar):{" "}
            <code>origem</code> (<code>meta</code> = anúncio ou formulário da Meta, <code>nao_meta</code>, <code>whatsapp_direto</code>{" "}
            ou o nome da origem, ex.: <code>api</code>, <code>site</code>), <code>tag</code> (uma ou várias separadas por vírgula; o lead
            precisa ter pelo menos uma), <code>etapa</code> (ex.: <code>interessado,encaminhamento</code>), <code>resultado</code>{" "}
            (<code>ganho</code>, <code>perdido</code> ou <code>aberto</code>), <code>qualificacao</code> (<code>mql</code>,{" "}
            <code>sql</code>, <code>oportunidade</code>, <code>cliente</code> ou <code>perdido</code>), <code>campanha</code> (nome da
            campanha do Facebook Leads) e <code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code>,{" "}
            <code>utm_content</code>, <code>utm_term</code>. A resposta repete em <code>filtros</code> o que foi aplicado.
          </p>
          <p className="mt-2">
            Cada lead vem com <code>id</code>, <code>nome</code>, <code>telefone</code>, <code>email</code>, <code>data_entrada</code>,{" "}
            <code>fase</code> (nome da fase atual e <code>desde</code>, a data da última mudança), <code>resultado</code> (
            <code>ganho</code>, <code>perdido</code> ou vazio), <code>valor_venda</code>, <code>motivo_perda</code>, <code>origem</code>{" "}
            (source, UTMs, tags, se veio de campanha da Meta e a campanha/anúncio/formulário do Facebook Leads), <code>campos</code>{" "}
            (todos os campos personalizados) e <code>qualificacao</code>: o nível do lead (<code>lead</code>, <code>mql</code>,{" "}
            <code>sql</code>, <code>oportunidade</code>, <code>cliente</code> ou <code>perdido</code>), pelas regras abaixo.
          </p>
        </details>
      )}
    </div>
  );
}
