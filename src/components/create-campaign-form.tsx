"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createCampaign, type ActionResult } from "@/app/actions/campaigns";
import { listWhatsappTemplates } from "@/app/actions/whatsapp";

const INITIAL_STATE: ActionResult = { error: null };

const DEPARTMENT_LABEL: Record<string, string> = { vendas: "Vendas", financeiro: "Financeiro" };
const WEEK_DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

type AgentOption = { id: string; name: string; connection_status: string };
type WhatsappInstanceOption = { id: string; channel: "evolution" | "360dialog"; department: string };
type Dialog360Template = { name: string; language: string; category: string; bodyText: string | null; bodyVarCount: number };
type SequenceStep = { dayOffset: number; subject: string; body: string; ctaLabel: string };

let stepKeySeq = 0;
function newStep(dayOffset: number): SequenceStep & { key: number } {
  stepKeySeq += 1;
  return { key: stepKeySeq, dayOffset, subject: "", body: "", ctaLabel: "Saiba mais" };
}

export function CreateCampaignForm({ agents = [], whatsappInstances = [] }: { agents?: AgentOption[]; whatsappInstances?: WhatsappInstanceOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [mode, setMode] = useState<"blast" | "agent" | "sequence">("blast");
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [steps, setSteps] = useState<(SequenceStep & { key: number })[]>([newStep(1)]);
  const [ctaPhone, setCtaPhone] = useState("");
  const [ctaMessage, setCtaMessage] = useState("");
  const [sequenceDays, setSequenceDays] = useState<number[]>([2, 3, 4]);
  const [blastDays, setBlastDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
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
  const isDialog360Blast = channel === "whatsapp" && mode === "blast" && selectedInstance?.channel === "360dialog";
  // Bloqueia o envio quando o número é 360dialog e não tem um template válido escolhido (sem
  // template não sai nada em disparo frio) ou o template tem mais de 1 variável (ainda não suportado).
  const blockDialog360Submit = isDialog360Blast && (!selectedTemplate || selectedTemplate.bodyVarCount > 1);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  useEffect(() => {
    if (channel === "whatsapp" && mode === "sequence") setMode("blast");
    if (channel === "email" && mode === "agent") setMode("blast");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  function updateStep(key: number, patch: Partial<SequenceStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function addStep() {
    const lastDay = steps[steps.length - 1]?.dayOffset ?? 0;
    setSteps((prev) => [...prev, newStep(lastDay + 5)]);
  }
  function removeStep(key: number) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev));
  }
  function toggleSequenceDay(day: number) {
    setSequenceDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }
  function toggleBlastDay(day: number) {
    setBlastDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

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

          {channel === "email" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Tipo de disparo</span>
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
                  <div className="text-sm font-bold">Disparo único</div>
                  <div className="text-xs text-text-muted mt-0.5">Manda 1 e-mail agora pros contatos filtrados.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("sequence")}
                  aria-pressed={mode === "sequence"}
                  className={`text-left border rounded-md p-3 cursor-pointer transition-colors ${
                    mode === "sequence" ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                  }`}
                >
                  <div className="text-sm font-bold">Sequência por dia</div>
                  <div className="text-xs text-text-muted mt-0.5">Vários e-mails espaçados por dia (ex.: Dia 1, 5, 10…), com CTA pro WhatsApp.</div>
                </button>
              </div>
            </div>
          )}

          {channel === "email" && mode === "blast" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="subject" className="text-sm font-semibold">
                Assunto
              </label>
              <input
                id="subject"
                name="subject"
                required
                placeholder="Assunto do e-mail"
                className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          {channel === "email" && mode === "sequence" && (
            <div className="flex flex-col gap-3 bg-bg border border-border rounded-md p-3">
              <input type="hidden" name="cta_phone" value={ctaPhone} />
              <input type="hidden" name="cta_message" value={ctaMessage} />
              <input type="hidden" name="sequence_days" value={JSON.stringify(sequenceDays)} />
              <input type="hidden" name="sequence_steps" value={JSON.stringify(steps.map(({ key: _key, ...s }) => s))} />

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cta_phone_input" className="text-xs font-semibold text-text-muted">
                    WhatsApp do CTA (só números, com DDI)
                  </label>
                  <input
                    id="cta_phone_input"
                    value={ctaPhone}
                    onChange={(e) => setCtaPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="5521999999999"
                    className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cta_message_input" className="text-xs font-semibold text-text-muted">
                    Mensagem pronta no WhatsApp
                  </label>
                  <input
                    id="cta_message_input"
                    value={ctaMessage}
                    onChange={(e) => setCtaMessage(e.target.value)}
                    placeholder="Olá! Vim pelo e-mail…"
                    className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-text-muted">Dias de envio</span>
                <div className="flex gap-1.5">
                  {WEEK_DAY_LABELS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleSequenceDay(d.value)}
                      className={`text-[11px] font-bold px-2 py-1.5 rounded-md border cursor-pointer ${
                        sequenceDays.includes(d.value) ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-text-muted">E-mails da sequência (dia relativo à entrada do contato)</span>
                {steps.map((step, i) => (
                  <div key={step.key} className="flex flex-col gap-1.5 border border-border rounded-md p-2.5 bg-surface">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold text-text-muted shrink-0">Dia</label>
                      <input
                        type="number"
                        min={1}
                        value={step.dayOffset}
                        onChange={(e) => updateStep(step.key, { dayOffset: Number(e.target.value) || 1 })}
                        className="w-16 border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                      <input
                        value={step.subject}
                        onChange={(e) => updateStep(step.key, { subject: e.target.value })}
                        placeholder="Assunto desse e-mail"
                        required
                        className="flex-1 border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(step.key)}
                          aria-label="Remover e-mail"
                          className="text-danger text-xs font-bold px-1 cursor-pointer shrink-0"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <textarea
                      value={step.body}
                      onChange={(e) => updateStep(step.key, { body: e.target.value })}
                      rows={3}
                      required
                      placeholder="Corpo do e-mail. Use {nome} pro primeiro nome."
                      className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary font-mono"
                    />
                    <input
                      value={step.ctaLabel}
                      onChange={(e) => updateStep(step.key, { ctaLabel: e.target.value })}
                      placeholder="Texto do botão (ex.: SOLICITAR UMA AVALIAÇÃO)"
                      required
                      className="border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                    <span className="text-[10px] text-text-muted">E-mail {i + 1} de {steps.length}</span>
                  </div>
                ))}
                <button type="button" onClick={addStep} className="text-xs font-bold text-primary-strong hover:underline w-fit cursor-pointer">
                  + Adicionar e-mail
                </button>
              </div>
            </div>
          )}

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
              {isDialog360Blast && (
                <div className="flex flex-col gap-2.5 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Template aprovado (Meta)</span>
                    <span className="text-[10px] font-bold uppercase text-primary-strong bg-primary-soft px-2 py-0.5 rounded-full">API oficial</span>
                  </div>
                  <input type="hidden" name="dialog360_template_name" value={selectedTemplate?.name ?? ""} />
                  <input type="hidden" name="dialog360_template_lang" value={selectedTemplate?.language ?? ""} />

                  {loadingTemplates ? (
                    <p className="text-sm text-text-muted px-1 py-2">Buscando templates aprovados…</p>
                  ) : templatesError ? (
                    <div className="bg-danger-soft border border-danger/30 rounded-lg p-3">
                      <p className="text-xs text-danger font-medium">{templatesError}</p>
                      <p className="text-xs text-danger/80 mt-1">
                        Sincronize no Hub do 360dialog ("Synchronise templates with Meta") e reabra esse formulário.
                      </p>
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="bg-warning-soft border border-warning-text/20 rounded-lg p-3">
                      <p className="text-xs text-warning-text font-medium">Nenhum template aprovado encontrado pra esse número.</p>
                      <p className="text-xs text-warning-text/80 mt-1">
                        Se você já aprovou um no Meta Business Manager, sincronize no Hub do 360dialog ("Synchronise templates with Meta") e
                        reabra esse formulário.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                      {templates.map((t) => {
                        const key = `${t.name}|${t.language}`;
                        const active = key === templateKey;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setTemplateKey(key)}
                            aria-pressed={active}
                            className={`text-left border rounded-lg p-2.5 cursor-pointer transition-colors ${
                              active ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold truncate">{t.name}</span>
                              <span className="text-[10px] font-bold uppercase text-text-muted bg-bg px-1.5 py-0.5 rounded shrink-0">{t.language}</span>
                            </div>
                            {t.bodyText && <p className="text-xs text-text-muted mt-1 line-clamp-2">{t.bodyText}</p>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedTemplate && selectedTemplate.bodyVarCount > 1 && (
                    <p className="text-xs text-danger font-medium">
                      Esse template tem mais de 1 variável no corpo — ainda não suportado (só {"{{1}}"} = primeiro nome). Escolha outro.
                    </p>
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

          {!isDialog360Blast && mode !== "sequence" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="templates" className="text-sm font-semibold">
                {mode === "agent" ? "Mensagem de abertura" : "Mensagem(ns)"}
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
          )}

          {mode === "sequence" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hour_start" className="text-xs font-semibold text-text-muted">
                  Janela início (h)
                </label>
                <input id="hour_start" name="hour_start" type="number" defaultValue={8} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hour_end" className="text-xs font-semibold text-text-muted">
                  Janela fim (h)
                </label>
                <input id="hour_end" name="hour_end" type="number" defaultValue={12} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input type="hidden" name="blast_days" value={JSON.stringify(blastDays)} />
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
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-text-muted">Dias de envio</span>
                <div className="flex gap-1.5">
                  {WEEK_DAY_LABELS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleBlastDay(d.value)}
                      className={`text-[11px] font-bold px-2 py-1.5 rounded-md border cursor-pointer ${
                        blastDays.includes(d.value) ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

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
