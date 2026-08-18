"use client";

import { useState, useTransition } from "react";
import { updateAgentConfig, type LlmProvider } from "@/app/actions/agents";
import { ToggleSwitch, ToggleGooeyFilter } from "@/components/toggle-switch";
import {
  buildSystemPrompt,
  getAgentMode,
  AGENT_MODES,
  DAY_KEYS,
  DAY_LABELS,
  BUBBLE_CHAR_LIMIT_MIN,
  BUBBLE_CHAR_LIMIT_MAX,
  type AgentConfig,
  type AgentMode,
  type CollectField,
  type CollectFieldMode,
  type WeekHours,
} from "@/lib/agent-prompt";

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}

function ToneField({ value, onChange }: { value: AgentConfig["tone"]; onChange: (v: AgentConfig["tone"]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-text-muted">Tom de voz</span>
      <div className="flex gap-2">
        {(["formal", "humanizado"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex-1 text-xs font-bold px-3 py-2 rounded-md border cursor-pointer capitalize ${
              value === opt ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; note: string }[] = [
  { value: "claude", label: "Claude (Sonnet 5)", note: "Padrão — validado em produção." },
  { value: "gemini", label: "Gemini 3 Flash", note: "Mais barato, em teste — valide qualidade antes de usar com cliente pagante." },
];

function ProviderField({ value, onChange }: { value: LlmProvider; onChange: (v: LlmProvider) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-text-muted">Modelo de IA</span>
      <div className="flex gap-2">
        {PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 text-left text-xs font-bold px-3 py-2 rounded-md border cursor-pointer ${
              value === opt.value ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
            }`}
          >
            <div>{opt.label}</div>
            <div className={`font-normal mt-0.5 ${value === opt.value ? "text-white/80" : "text-text-muted"}`}>{opt.note}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HoursEditor({ hours, onChange }: { hours: WeekHours; onChange: (h: WeekHours) => void }) {
  function setDay(day: (typeof DAY_KEYS)[number], patch: Partial<WeekHours[typeof day]>) {
    onChange({ ...hours, [day]: { ...hours[day], ...patch } });
  }
  function applyMondayToAll() {
    const monday = hours.seg;
    const next = DAY_KEYS.reduce((acc, d) => {
      acc[d] = { ...monday };
      return acc;
    }, {} as WeekHours);
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-muted">Horário de atendimento</span>
        <button type="button" onClick={applyMondayToAll} className="text-xs font-semibold text-primary-strong hover:underline cursor-pointer">
          copiar segunda pra todos os dias
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {DAY_KEYS.map((day) => {
          const d = hours[day];
          return (
            <div key={day} className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 w-28 shrink-0 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={d.enabled} onChange={(e) => setDay(day, { enabled: e.target.checked })} />
                {DAY_LABELS[day]}
              </label>
              <input
                type="time"
                value={d.open}
                disabled={!d.enabled}
                onChange={(e) => setDay(day, { open: e.target.value })}
                className="border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-40"
              />
              <span className="text-text-muted text-xs">às</span>
              <input
                type="time"
                value={d.close}
                disabled={!d.enabled}
                onChange={(e) => setDay(day, { close: e.target.value })}
                className="border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-40"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PRESET_FIELDS: { key: string; display: string; label: string; mode: CollectFieldMode }[] = [
  { key: "nome", display: "Nome", label: "nome do cliente", mode: "discreto" },
  { key: "telefone", display: "Telefone", label: "telefone de contato", mode: "discreto" },
  { key: "email", display: "E-mail", label: "e-mail para cadastro", mode: "perguntar" },
];

export function AgentConfigForm({
  agentId,
  initialConfig,
  initialSystemPrompt,
  initialLlmProvider,
  mediaCategories,
}: {
  agentId: string;
  initialConfig: AgentConfig;
  initialSystemPrompt: string;
  initialLlmProvider: LlmProvider;
  mediaCategories: string[];
}) {
  const [config, setConfig] = useState<AgentConfig>(initialConfig);
  const [finalPrompt, setFinalPrompt] = useState(initialSystemPrompt || buildSystemPrompt(initialConfig));
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(initialLlmProvider);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  }

  // Escolher um modo injeta o objetivo no prompt e sugere defaults — mas só preenche campos que ainda
  // estão vazios, pra nunca apagar o que você já configurou num agente existente.
  function handleModeSelect(key: AgentMode) {
    setConfig((c) => {
      const def = getAgentMode(key);
      const next: AgentConfig = { ...c, mode: key };
      if (def) {
        if (c.collectFields.length === 0) next.collectFields = def.defaultCollectFields.map((f) => ({ ...f }));
        if (!c.handoffBehavior.trim()) next.handoffBehavior = def.defaultHandoff;
      }
      return next;
    });
    setSaved(false);
  }

  function addField(preset?: (typeof PRESET_FIELDS)[number]) {
    set("collectFields", [...config.collectFields, preset ? { key: preset.key, label: preset.label, mode: preset.mode } : { key: "", label: "", mode: "discreto" }]);
  }

  function updateField(index: number, patch: Partial<CollectField>) {
    const next = config.collectFields.slice();
    next[index] = { ...next[index], ...patch };
    set("collectFields", next);
  }

  function removeField(index: number) {
    set(
      "collectFields",
      config.collectFields.filter((_, i) => i !== index)
    );
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAgentConfig(agentId, config, finalPrompt, llmProvider);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ToggleGooeyFilter />
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-text-muted">Modo do agente (objetivo)</span>
        <div className="grid sm:grid-cols-3 gap-2">
          {AGENT_MODES.map((m) => {
            const active = config.mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => handleModeSelect(active ? "" : m.key)}
                className={`text-left p-3 rounded-lg border cursor-pointer transition-colors ${
                  active ? "border-primary-strong bg-primary-faint" : "border-border hover:border-primary-soft"
                }`}
              >
                <div className={`text-sm font-bold ${active ? "text-primary-strong" : ""}`}>{m.label}</div>
                <div className="text-[11px] text-text-muted mt-0.5 leading-snug">{m.short}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted">
          Define o objetivo do agente e sugere campos e encaminhamento (tudo editável). Se o cliente inicia o contato, o
          agente espera; pra ele abordar ativamente, use uma campanha no modo agente com esse mesmo objetivo.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <ProviderField value={llmProvider} onChange={(v) => { setLlmProvider(v); setSaved(false); }} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 border-t border-border pt-4">
        <TextField label="Nome da empresa" value={config.companyName} onChange={(v) => set("companyName", v)} placeholder="Ex: Hotel Fazenda Ecoville" />
        <TextField label="Tipo de negócio" value={config.businessType} onChange={(v) => set("businessType", v)} placeholder="Ex: hotel fazenda" />
        <ToneField value={config.tone} onChange={(v) => set("tone", v)} />
        <TextField label="Endereço" value={config.address} onChange={(v) => set("address", v)} placeholder="Ex: Rod. BR-101, km 12" />
      </div>

      <div className="border-t border-border pt-4">
        <HoursEditor hours={config.hours} onChange={(h) => set("hours", h)} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4">
        <span className="text-xs font-bold text-text-muted">Comportamento de encaminhamento humano</span>
        <textarea
          value={config.handoffBehavior}
          onChange={(e) => set("handoffBehavior", e.target.value)}
          rows={2}
          placeholder="Ex: quando o cliente pedir desconto fora da tabela ou reclamar, passe pra um humano."
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y"
        />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4">
        <span className="text-xs font-bold text-text-muted">Máximo de mensagens por resposta</span>
        <div className="flex gap-2">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set("maxBubbles", n)}
              className={`flex-1 text-xs font-bold px-3 py-2 rounded-md border cursor-pointer ${
                config.maxBubbles === n ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
              }`}
            >
              {n === 1 ? "1 (mensagem única)" : `até ${n}`}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Quebrar a resposta em várias bolhas parece mais humano, mas a partir de 01/10/2026 a Meta cobra por mensagem
          enviada — cada bolha extra vira uma cobrança. Use 1 pra cliente de alto volume onde o custo pesa mais que o estilo.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4">
        <span className="text-xs font-bold text-text-muted">Quebrar bolha a cada quantos caracteres</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={BUBBLE_CHAR_LIMIT_MIN}
            max={BUBBLE_CHAR_LIMIT_MAX}
            value={config.bubbleCharLimit}
            onChange={(e) => set("bubbleCharLimit", Math.min(BUBBLE_CHAR_LIMIT_MAX, Math.max(BUBBLE_CHAR_LIMIT_MIN, Number(e.target.value) || 0)))}
            className="w-28 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <span className="text-xs text-text-muted">caracteres (entre {BUBBLE_CHAR_LIMIT_MIN} e {BUBBLE_CHAR_LIMIT_MAX})</span>
        </div>
        <p className="text-xs text-text-muted">
          Se uma bolha passar desse tamanho, o sistema quebra ela sozinho pro próximo bloco (corte de verdade no código, não
          só instrução no prompt) — evita respostas viradas um parágrafo gigante. Continua respeitando o teto de "máximo de
          mensagens por resposta" acima.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">Follow-up automático</span>
          <ToggleSwitch
            checked={config.followUp.enabled}
            onCheckedChange={(v) => set("followUp", { ...config.followUp, enabled: v })}
            ariaLabel={config.followUp.enabled ? "Desativar follow-up automático" : "Ativar follow-up automático"}
          />
        </div>
        <p className="text-xs text-text-muted">
          Se o contato parar de responder depois de uma mensagem do agente, retoma a conversa sozinho de tempos em
          tempos, até um limite de tentativas — depois disso, move o contato pra &quot;descartado&quot; no CRM sozinho.
          Não vale pra todo lead: <strong className="text-text">não atua em quem já está concluído, descartado, com
          atendimento pausado (atenção humana) ou que pediu pra não receber mais mensagens.</strong>
        </p>
        {config.followUp.enabled && (
          <div className="grid grid-cols-2 gap-3 mt-1">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">A cada quantos dias de silêncio</span>
              <input
                type="number"
                min={1}
                max={30}
                value={config.followUp.intervalDays}
                onChange={(e) => set("followUp", { ...config.followUp, intervalDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Quantas tentativas antes de parar</span>
              <input
                type="number"
                min={1}
                max={10}
                value={config.followUp.maxCount}
                onChange={(e) => set("followUp", { ...config.followUp, maxCount: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-bold">Informações que preciso</span>
        <p className="text-xs text-text-muted">
          Dados que o agente deve descobrir na conversa e salvar no contato (aparecem depois em Contatos/CRM). Se não
          adicionar nenhum campo, o agente não coleta nada. &quot;Discretamente&quot; = só anota se o cliente mencionar
          sozinho, sem perguntar; &quot;Pode perguntar&quot; = o agente pergunta ativamente quando precisar.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_FIELDS.map((p) => {
            const added = config.collectFields.some((f) => f.key === p.key);
            return (
              <button
                key={p.key}
                type="button"
                disabled={added}
                onClick={() => addField(p)}
                className="text-xs font-semibold px-2.5 py-1 rounded-full border border-border text-primary-strong disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                + {p.display}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => addField()}
            className="text-xs font-semibold px-2.5 py-1 rounded-full border border-dashed border-border text-text-muted cursor-pointer"
          >
            + campo personalizado
          </button>
        </div>

        {config.collectFields.map((field, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={field.key}
              onChange={(e) => updateField(i, { key: e.target.value })}
              placeholder="chave"
              className="w-28 border border-border rounded-md px-2.5 py-1.5 text-xs font-mono outline-none focus:border-primary"
            />
            <input
              value={field.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="descrição (ex: data prevista de check-in)"
              className="flex-1 border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary"
            />
            <select
              value={field.mode}
              onChange={(e) => updateField(i, { mode: e.target.value as CollectFieldMode })}
              className="border border-border rounded-md px-1.5 py-1.5 text-xs outline-none focus:border-primary cursor-pointer"
            >
              <option value="discreto">Discretamente</option>
              <option value="perguntar">Pode perguntar</option>
            </select>
            <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-danger text-xs font-bold px-1.5 cursor-pointer">
              ×
            </button>
          </div>
        ))}
      </div>

      {mediaCategories.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-sm font-bold">Quando usar cada pasta de arquivo</span>
          <p className="text-xs text-text-muted">Ajuda o agente a escolher a pasta certa na hora de mandar arquivo pro cliente.</p>
          {mediaCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold w-28 truncate shrink-0" title={cat}>
                {cat}
              </span>
              <input
                value={config.mediaFolderNotes[cat] || ""}
                onChange={(e) => set("mediaFolderNotes", { ...config.mediaFolderNotes, [cat]: e.target.value })}
                placeholder="Ex: usar quando perguntarem sobre preços de pratos"
                className="flex-1 border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-border pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-text-muted">Prompt final (você pode editar direto)</span>
          <button
            type="button"
            onClick={() => {
              setFinalPrompt(buildSystemPrompt(config));
              setSaved(false);
            }}
            className="text-xs font-semibold text-primary-strong hover:underline cursor-pointer"
          >
            Regenerar a partir da configuração acima
          </button>
        </div>
        <div className="relative">
          <textarea
            value={finalPrompt}
            onChange={(e) => {
              setFinalPrompt(e.target.value);
              setSaved(false);
            }}
            rows={10}
            className="w-full border border-border rounded-md px-3 py-2.5 pb-6 text-xs font-mono outline-none focus:border-primary resize-y"
          />
          <span className="absolute bottom-1.5 right-2.5 text-[10px] font-mono text-text-muted bg-surface/90 px-1 rounded pointer-events-none">
            {finalPrompt.length.toLocaleString("pt-BR")} caracteres · ~{Math.round(finalPrompt.length / 4).toLocaleString("pt-BR")} tokens
          </span>
        </div>
        <p className="text-xs text-text-muted">
          É esse texto que vai direto pro modelo. Os campos acima só geram (ou regeneram) esse texto — editar aqui não
          muda os campos, e mudar os campos não edita isso automaticamente até você clicar em &quot;Regenerar&quot;.
        </p>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Salvando…" : "Salvar configuração"}
        </button>
        {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
        {error && <span className="text-xs text-danger font-medium">{error}</span>}
      </div>
    </div>
  );
}
