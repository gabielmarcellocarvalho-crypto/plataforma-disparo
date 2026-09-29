"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Bot, ChevronDown, ListOrdered, MessageSquare, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { ToggleSwitch } from "@/components/toggle-switch";
import { saveChatbotConfig } from "@/app/actions/chatbot";
import { CHATBOT_TEMPLATES, interpolate, MAX_OPTIONS, MAX_STEPS, renderStepText, type ChatbotConfig, type ChatbotOption, type ChatbotStep } from "@/lib/chatbot";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { cn } from "@/lib/utils";

export type ChatbotInstanceItem = { id: string; label: string; config: ChatbotConfig };
export type ChatbotFieldDef = { key: string; label: string; type: string; options: string[] };

const input = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface w-full min-w-0";
const smallBtn = "inline-flex items-center gap-1.5 text-xs font-bold border border-border rounded-md px-2.5 py-1.5 bg-surface hover:bg-surface-2 cursor-pointer";

let seq = 0;
const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

const STEP_META: Record<ChatbotStep["type"], { label: string; icon: typeof Bot; tone: string }> = {
  message: { label: "Mensagem", icon: MessageSquare, tone: "bg-surface-2 text-text-muted" },
  question: { label: "Pergunta aberta", icon: MessageSquareText, tone: "bg-info-soft text-info-text" },
  menu: { label: "Menu de opções", icon: ListOrdered, tone: "bg-primary-soft text-primary-strong" },
};

function FieldSelect({ value, onChange, fieldDefs, allowContact }: { value: string; onChange: (v: string) => void; fieldDefs: ChatbotFieldDef[]; allowContact?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">— não gravar em campo —</option>
      {allowContact && (
        <>
          <option value="nome">Nome do contato</option>
          <option value="email">E-mail do contato</option>
        </>
      )}
      {fieldDefs.map((d) => (
        <option key={d.key} value={d.key}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

function OptionRow({
  option,
  index,
  fieldDefs,
  stageLabels,
  onChange,
  onRemove,
}: {
  option: ChatbotOption;
  index: number;
  fieldDefs: ChatbotFieldDef[];
  stageLabels: Record<ContactStage, string>;
  onChange: (o: ChatbotOption) => void;
  onRemove: () => void;
}) {
  const def = fieldDefs.find((d) => d.key === option.fieldKey);
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-extrabold text-text-muted w-5 shrink-0">{index + 1}.</span>
        <input
          value={option.label}
          onChange={(e) => {
            const label = e.target.value;
            // Etiqueta acompanha o rótulo enquanto a pessoa não tiver mexido nela.
            onChange({ ...option, label, tag: option.tag === option.label ? label : option.tag });
          }}
          placeholder="Texto da opção (ex.: Opção A)"
          className={input}
          aria-label={`Texto da opção ${index + 1}`}
        />
        <button type="button" onClick={onRemove} aria-label="Remover opção" className="text-text-muted hover:text-danger cursor-pointer p-1 shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-7">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-text-muted">Etiqueta no lead</span>
          <input value={option.tag} onChange={(e) => onChange({ ...option, tag: e.target.value })} placeholder="(sem etiqueta)" className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-text-muted">Mover pra etapa</span>
          <select value={option.stage} onChange={(e) => onChange({ ...option, stage: e.target.value as ContactStage | "" })} className={input}>
            <option value="">— não mudar —</option>
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {stageLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-text-muted">Gravar em campo</span>
          <FieldSelect value={option.fieldKey} onChange={(v) => onChange({ ...option, fieldKey: v, fieldValue: v ? option.fieldValue : "" })} fieldDefs={fieldDefs} />
        </label>
        {option.fieldKey && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-text-muted">Valor</span>
            {def && def.options.length > 0 ? (
              <select value={option.fieldValue} onChange={(e) => onChange({ ...option, fieldValue: e.target.value })} className={input}>
                <option value="">Selecione…</option>
                {def.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input value={option.fieldValue} onChange={(e) => onChange({ ...option, fieldValue: e.target.value })} className={input} />
            )}
          </label>
        )}
      </div>
    </div>
  );
}

function StepEditor({
  step,
  index,
  total,
  fieldDefs,
  stageLabels,
  onChange,
  onMove,
  onRemove,
}: {
  step: ChatbotStep;
  index: number;
  total: number;
  fieldDefs: ChatbotFieldDef[];
  stageLabels: Record<ContactStage, string>;
  onChange: (s: ChatbotStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-extrabold text-text-muted">{index + 1}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full", meta.tone)}>
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {meta.label}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Subir etapa" className="p-1 text-text-muted hover:text-text disabled:opacity-30 cursor-pointer">
            <ArrowUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Descer etapa" className="p-1 text-text-muted hover:text-text disabled:opacity-30 cursor-pointer">
            <ArrowDown className="w-4 h-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label="Remover etapa" className="p-1 text-text-muted hover:text-danger cursor-pointer">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <textarea
        value={step.text}
        onChange={(e) => onChange({ ...step, text: e.target.value })}
        rows={step.type === "menu" ? 2 : 3}
        placeholder={step.type === "menu" ? "Pergunta antes das opções (ex.: Como podemos te ajudar?)" : "Texto da mensagem"}
        className={cn(input, "resize-y")}
      />

      {step.type === "question" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-text-muted">Gravar a resposta em</span>
            <FieldSelect value={step.fieldKey} onChange={(v) => onChange({ ...step, fieldKey: v })} fieldDefs={fieldDefs} allowContact />
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer self-end pb-2">
            <input type="checkbox" checked={step.saveAsTag} onChange={(e) => onChange({ ...step, saveAsTag: e.target.checked })} className="cursor-pointer accent-[var(--color-primary-strong)]" />
            Salvar a resposta também como etiqueta
          </label>
        </div>
      )}

      {step.type === "menu" && (
        <div className="flex flex-col gap-2">
          {step.options.map((o, oi) => (
            <OptionRow
              key={oi}
              option={o}
              index={oi}
              fieldDefs={fieldDefs}
              stageLabels={stageLabels}
              onChange={(next) => onChange({ ...step, options: step.options.map((x, xi) => (xi === oi ? next : x)) })}
              onRemove={() => onChange({ ...step, options: step.options.filter((_, xi) => xi !== oi) })}
            />
          ))}
          {step.options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => onChange({ ...step, options: [...step.options, { label: "", tag: "", fieldKey: "", fieldValue: "", stage: "" }] })}
              className={cn(smallBtn, "self-start")}
            >
              <Plus className="w-3.5 h-3.5" /> Opção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Prévia estilo WhatsApp do que o lead recebe (nome de exemplo no lugar das variáveis).
function Preview({ config }: { config: ChatbotConfig }) {
  const vars = { name: "Maria Souza", customFields: { cidade: "Lavras" } };
  const bubbles = [...config.steps.map(renderStepText), config.finalMessage].filter((t) => t.trim());
  return (
    <div className="rounded-xl border border-border bg-[#efeae2] p-3 flex flex-col gap-2 min-h-40">
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted self-center bg-surface/80 rounded-full px-2 py-0.5">Prévia</span>
      {bubbles.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-6">Adicione etapas pra ver a prévia.</p>
      ) : (
        bubbles.map((t, i) => (
          <div key={i} className="self-start max-w-[92%] bg-surface rounded-lg rounded-tl-none px-3 py-2 text-[13px] leading-relaxed shadow-sm whitespace-pre-wrap">
            {interpolate(t, vars)}
          </div>
        ))
      )}
    </div>
  );
}

function InstanceChatbot({ item, fieldDefs, stageLabels }: { item: ChatbotInstanceItem; fieldDefs: ChatbotFieldDef[]; stageLabels: Record<ContactStage, string> }) {
  const [open, setOpen] = useState(item.config.enabled);
  const [config, setConfig] = useState<ChatbotConfig>(item.config);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const set = (patch: Partial<ChatbotConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setStatus(null);
  };
  const setStep = (i: number, s: ChatbotStep) => set({ steps: config.steps.map((x, xi) => (xi === i ? s : x)) });
  const addStep = (type: ChatbotStep["type"]) => {
    const step: ChatbotStep =
      type === "message"
        ? { id: newId(), type, text: "" }
        : type === "question"
          ? { id: newId(), type, text: "", fieldKey: "", saveAsTag: false }
          : { id: newId(), type, text: "", options: [{ label: "", tag: "", fieldKey: "", fieldValue: "", stage: "" }] };
    set({ steps: [...config.steps, step] });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= config.steps.length) return;
    const next = [...config.steps];
    [next[i], next[j]] = [next[j], next[i]];
    set({ steps: next });
  };

  function save() {
    startTransition(async () => {
      const r = await saveChatbotConfig(item.id, config);
      setStatus(r.error ? { tone: "err", text: r.error } : { tone: "ok", text: "Salvo." });
    });
  }

  return (
    <div className="border border-border rounded-xl bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
            <Bot className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold truncate">{item.label}</span>
            <span className="block text-xs text-text-muted">
              {config.enabled ? `Ligado · ${config.steps.length} etapa(s)` : "Desligado"}
            </span>
          </span>
          <ChevronDown className={cn("w-4 h-4 text-text-muted ml-auto transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        <ToggleSwitch checked={config.enabled} onCheckedChange={(v) => set({ enabled: v })} ariaLabel={config.enabled ? "Desligar chatbot" : "Ligar chatbot"} />
      </div>

      {open && (
        <div className="border-t border-border p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-text-muted">Começar de um modelo:</span>
              {CHATBOT_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => set({ steps: t.config.steps.map((s) => ({ ...s, id: newId() })), finalMessage: t.config.finalMessage })}
                  className={smallBtn}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {config.steps.map((s, i) => (
              <StepEditor
                key={s.id}
                step={s}
                index={i}
                total={config.steps.length}
                fieldDefs={fieldDefs}
                stageLabels={stageLabels}
                onChange={(next) => setStep(i, next)}
                onMove={(dir) => move(i, dir)}
                onRemove={() => set({ steps: config.steps.filter((_, xi) => xi !== i) })}
              />
            ))}

            {config.steps.length < MAX_STEPS && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => addStep("question")} className={smallBtn}>
                  <Plus className="w-3.5 h-3.5" /> Pergunta aberta
                </button>
                <button type="button" onClick={() => addStep("menu")} className={smallBtn}>
                  <Plus className="w-3.5 h-3.5" /> Menu de opções
                </button>
                <button type="button" onClick={() => addStep("message")} className={smallBtn}>
                  <Plus className="w-3.5 h-3.5" /> Mensagem
                </button>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Mensagem final (depois da última etapa)</span>
              <textarea value={config.finalMessage} onChange={(e) => set({ finalMessage: e.target.value })} rows={2} className={cn(input, "resize-y")} />
            </label>

            <p className="text-[11px] text-text-muted">
              Variáveis: <code>{"{{primeiro_nome}}"}</code>, <code>{"{{nome}}"}</code>, <code>{"{{campo:chave}}"}</code>. Roda só no primeiro contato de um
              número novo; se alguém da equipe responder, o bot sai da conversa. Cidade gravada no campo de cidade do workspace
              aciona o roteamento por território.
            </p>

            <div className="flex items-center gap-3">
              <button type="button" onClick={save} disabled={pending} className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-60">
                {pending ? "Salvando…" : "Salvar chatbot"}
              </button>
              {status && <span className={cn("text-xs font-semibold", status.tone === "ok" ? "text-success" : "text-danger")}>{status.text}</span>}
            </div>
          </div>

          <Preview config={config} />
        </div>
      )}
    </div>
  );
}

export function ChatbotEditor({
  instances,
  fieldDefs,
  stageLabels,
}: {
  instances: ChatbotInstanceItem[];
  fieldDefs: ChatbotFieldDef[];
  stageLabels: Record<ContactStage, string>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {instances.length === 0 ? (
        <p className="text-sm text-text-muted">Nenhum número sem IA conectado. Conecte um número acima pra configurar as mensagens iniciais.</p>
      ) : (
        instances.map((item) => <InstanceChatbot key={item.id} item={item} fieldDefs={fieldDefs} stageLabels={stageLabels} />)
      )}
    </div>
  );
}
