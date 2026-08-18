"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createCampaign, type ActionResult } from "@/app/actions/campaigns";
import { listWhatsappTemplates } from "@/app/actions/whatsapp";

const INITIAL_STATE: ActionResult = { error: null };

const DEPARTMENT_LABEL: Record<string, string> = { vendas: "Vendas", financeiro: "Financeiro" };

type AgentOption = { id: string; name: string; connection_status: string };
type WhatsappInstanceOption = { id: string; channel: "evolution" | "360dialog"; department: string };
type Dialog360Template = { name: string; language: string; category: string; bodyText: string | null; bodyVarCount: number };

export function CreateCampaignForm({ agents = [], whatsappInstances = [] }: { agents?: AgentOption[]; whatsappInstances?: WhatsappInstanceOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [mode, setMode] = useState<"blast" | "agent">("blast");
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [instanceId, setInstanceId] = useState(whatsappInstances[0]?.id || "");
  const [state, formAction, pending] = useActionState(createCampaign, INITIAL_STATE);
  const selectedInstance = whatsappInstances.find((i) => i.id === instanceId) || null;

  // Templates aprovados (360dialog) pro número escolhido — buscado direto na API, não digitado à
  // mão. Recarrega toda vez que o número selecionado muda (cada número tem sua própria conta/API key).
  const [templates, setTemplates] = useState<Dialog360Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, startLoadingTemplates] = useTransition();
  const [templateKey, setTemplateKey] = useState(""); // "nome|idioma"
  const selectedTemplate = templates.find((t) => `${t.name}|${t.language}` === templateKey) || null;
  // Bloqueia o envio quando o número é 360dialog e não tem um template válido escolhido (sem
  // template não sai nada em disparo frio) ou o template tem mais de 1 variável (ainda não suportado).
  const blockDialog360Submit =
    channel === "whatsapp" &&
    mode === "blast" &&
    selectedInstance?.channel === "360dialog" &&
    (!selectedTemplate || selectedTemplate.bodyVarCount > 1);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  useEffect(() => {
    if (channel !== "whatsapp") setMode("blast");
  }, [channel]);

  useEffect(() => {
    if (selectedInstance?.channel !== "360dialog") {
      setTemplates([]);
      setTemplatesError(null);
      setTemplateKey("");
      return;
    }
    startLoadingTemplates(async () => {
      const result = await listWhatsappTemplates(selectedInstance.id);
      setTemplatesError(result.error);
      setTemplates(result.templates);
      setTemplateKey(result.templates[0] ? `${result.templates[0].name}|${result.templates[0].language}` : "");
    });
  }, [selectedInstance?.id, selectedInstance?.channel]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        Nova campanha
      </button>

      <dialog ref={dialogRef} className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-lg">
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Nova campanha</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-semibold">
              Nome
            </label>
            <input id="name" name="name" required className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="channel" className="text-sm font-semibold">
              Canal
            </label>
            <select
              id="channel"
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </div>

          {channel === "whatsapp" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Quem conduz o disparo</span>
              <input type="hidden" name="mode" value={mode} />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("blast")}
                  aria-pressed={mode === "blast"}
                  className={`text-left border rounded-md p-3 cursor-pointer transition-colors ${
                    mode === "blast" ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                  }`}
                >
                  <div className="text-sm font-bold">Disparo simples</div>
                  <div className="text-xs text-text-muted mt-0.5">Manda a mensagem fixa (ou uma variação por linha) e não responde depois.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("agent")}
                  aria-pressed={mode === "agent"}
                  disabled={agents.length === 0}
                  className={`text-left border rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    mode === "agent" ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                  }`}
                >
                  <div className="text-sm font-bold">Agente de IA</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {agents.length === 0 ? "Crie um agente na aba Agentes primeiro." : "Um agente manda a abertura e conduz a conversa sozinho depois."}
                  </div>
                </button>
              </div>
            </div>
          )}

          {channel === "whatsapp" && mode === "blast" && whatsappInstances.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <input type="hidden" name="whatsapp_instance_id" value={instanceId} />
              {whatsappInstances.length > 1 ? (
                <>
                  <label htmlFor="instance_id" className="text-sm font-semibold">
                    Número
                  </label>
                  <select
                    id="instance_id"
                    value={instanceId}
                    onChange={(e) => setInstanceId(e.target.value)}
                    className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
                  >
                    {whatsappInstances.map((i) => (
                      <option key={i.id} value={i.id}>
                        {DEPARTMENT_LABEL[i.department] || i.department} {i.channel === "360dialog" ? "(API oficial)" : "(Evolution)"}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {selectedInstance?.channel === "360dialog" && (
                <div className="flex flex-col gap-3 bg-bg border border-border rounded-md p-3 mt-1">
                  <p className="text-xs text-text-muted">
                    Esse número usa a API oficial (360dialog) — disparo frio exige um Message Template aprovado pela Meta (não aceita
                    texto livre fora da janela de 24h). A mensagem lá embaixo só é usada se o contato já respondeu nas últimas 24h.
                  </p>
                  <input type="hidden" name="dialog360_template_name" value={selectedTemplate?.name ?? ""} />
                  <input type="hidden" name="dialog360_template_lang" value={selectedTemplate?.language ?? ""} />

                  {loadingTemplates ? (
                    <p className="text-xs text-text-muted">Buscando templates aprovados…</p>
                  ) : templatesError ? (
                    <p className="text-xs text-danger font-medium">
                      {templatesError} Sincronize os templates no Hub do 360dialog ("Synchronise templates with Meta") e reabra esse formulário.
                    </p>
                  ) : templates.length === 0 ? (
                    <p className="text-xs text-danger font-medium">
                      Nenhum template aprovado encontrado pra esse número. Se você já aprovou um no Meta Business Manager, sincronize no Hub do
                      360dialog ("Synchronise templates with Meta") e reabra esse formulário.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="template_key" className="text-xs font-semibold text-text-muted">
                        Template (Meta, aprovado)
                      </label>
                      <select
                        id="template_key"
                        value={templateKey}
                        onChange={(e) => setTemplateKey(e.target.value)}
                        className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
                      >
                        {templates.map((t) => (
                          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                            {t.name} ({t.language})
                          </option>
                        ))}
                      </select>
                      {selectedTemplate?.bodyText && <p className="text-xs text-text-muted bg-surface border border-border rounded-md p-2">{selectedTemplate.bodyText}</p>}
                      {selectedTemplate && selectedTemplate.bodyVarCount > 1 && (
                        <p className="text-xs text-danger font-medium">
                          Esse template tem mais de 1 variável no corpo — ainda não suportado (só {"{{1}}"} = primeiro nome). Escolha outro.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {channel === "whatsapp" && mode === "agent" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="agent_id" className="text-sm font-semibold">
                Agente
              </label>
              <select
                id="agent_id"
                name="agent_id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.connection_status !== "open" ? "(desconectado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="templates" className="text-sm font-semibold">
              {mode === "agent" ? "Mensagem de abertura" : selectedInstance?.channel === "360dialog" ? "Mensagem(ns) — resposta dentro de 24h" : "Mensagem(ns)"}
            </label>
            <textarea
              id="templates"
              name="templates"
              rows={5}
              required
              placeholder={
                mode === "agent"
                  ? "Primeira mensagem que o agente manda pra puxar assunto. Uma variação por linha. Use {nome} pro primeiro nome."
                  : "Uma variação por linha. Use {nome} pro primeiro nome."
              }
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary font-mono"
            />
            {mode === "agent" && (
              <p className="text-xs text-text-muted">Depois dessa mensagem, o agente responde sozinho seguindo o prompt configurado na aba Agentes.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delay_min" className="text-xs font-semibold text-text-muted">
                Delay mín. (s)
              </label>
              <input id="delay_min" name="delay_min" type="number" defaultValue={60} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delay_max" className="text-xs font-semibold text-text-muted">
                Delay máx. (s)
              </label>
              <input id="delay_max" name="delay_max" type="number" defaultValue={180} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hour_start" className="text-xs font-semibold text-text-muted">
                Janela início (h)
              </label>
              <input id="hour_start" name="hour_start" type="number" defaultValue={9} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hour_end" className="text-xs font-semibold text-text-muted">
                Janela fim (h)
              </label>
              <input id="hour_end" name="hour_end" type="number" defaultValue={20} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm font-semibold text-text-muted px-4 py-2.5 cursor-pointer">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || blockDialog360Submit}
              className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            >
              {pending ? "Criando…" : "Criar campanha"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
