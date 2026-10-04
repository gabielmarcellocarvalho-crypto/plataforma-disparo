"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createWorkspaceTemplate, type TemplateMappings } from "@/app/actions/templates";
import type { MetaTemplateRow } from "@/lib/metacloud-templates";
import { mappingLegend, previewText, variableCount, type TemplateField } from "@/lib/template-variables";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = { UTILITY: "Utilidade", MARKETING: "Marketing", AUTHENTICATION: "Autenticação" };
const STATUS_LABEL: Record<string, { text: string; tone: "ok" | "wait" | "bad" | "muted" }> = {
  APPROVED: { text: "Aprovado", tone: "ok" },
  PENDING: { text: "Em análise", tone: "wait" },
  REJECTED: { text: "Rejeitado", tone: "bad" },
  PAUSED: { text: "Pausado", tone: "muted" },
  DISABLED: { text: "Desativado", tone: "muted" },
};
const TONE: Record<"ok" | "wait" | "bad" | "muted", string> = {
  ok: "bg-success-soft text-success",
  wait: "bg-warning-soft text-warning-text",
  bad: "bg-danger-soft text-danger",
  muted: "bg-bg text-text-muted",
};

export type CategoryAlert = { id: string; name: string; previous: string | null; next: string | null; correct: string | null; at: string };

export function TemplatesManager({
  templates,
  mappings,
  fields,
  error,
  alerts,
}: {
  templates: MetaTemplateRow[];
  mappings: TemplateMappings;
  fields: TemplateField[];
  error: string | null;
  alerts: CategoryAlert[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [variableFields, setVariableFields] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const varCount = useMemo(() => variableCount(bodyText), [bodyText]);
  const chosen = variableFields.slice(0, varCount);
  const allChosen = varCount > 0 ? chosen.length === varCount && chosen.every(Boolean) : true;

  function setField(i: number, value: string) {
    setVariableFields((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  function submit() {
    setFormError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await createWorkspaceTemplate({ name, category, language: "pt_BR", bodyText, variableFields: chosen });
      if (r.error !== null) {
        setFormError(r.error);
        return;
      }
      setNotice(`Template enviado para análise da Meta (${STATUS_LABEL[r.status]?.text ?? r.status}). Acompanhe o status abaixo.`);
      setName("");
      setBodyText("");
      setVariableFields([]);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {alerts.length > 0 && (
        <section className="bg-warning-soft border border-warning rounded-xl p-5 flex flex-col gap-2">
          <h2 className="text-base font-bold text-warning-text">A Meta reclassificou templates</h2>
          {alerts.map((a) => (
            <p key={a.id} className="text-sm text-warning-text">
              <b>{a.name}</b>: {CATEGORY_LABEL[a.previous ?? ""] ?? a.previous ?? "?"} → {CATEGORY_LABEL[a.next ?? ""] ?? a.next ?? "?"}
              {a.correct && a.correct !== a.next ? ` (a Meta indica ${CATEGORY_LABEL[a.correct] ?? a.correct})` : ""}
              <span className="text-xs opacity-75"> · {new Date(a.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
            </p>
          ))}
        </section>
      )}

      <section className="bg-surface border border-border rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold">Templates da conta</h2>
            <p className="text-sm text-text-muted mt-0.5">Mensagens aprovadas pela Meta. Fora das 24 horas do lead, só template pode ser enviado.</p>
          </div>
          <button type="button" onClick={() => router.refresh()} disabled={pending} className="inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text cursor-pointer disabled:opacity-60">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            Atualizar status
          </button>
        </div>

        {error && <p className="text-sm text-danger font-medium mb-3">{error}</p>}

        {templates.length === 0 && !error ? (
          <p className="text-sm text-text-muted">Nenhum template ainda. Crie um abaixo.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {templates.map((t) => {
              const st = STATUS_LABEL[t.status] ?? { text: t.status, tone: "muted" as const };
              const willChange = t.correctCategory && t.correctCategory !== t.category;
              const legend = mappingLegend(mappings[`${t.name}|${t.language}`] || [], fields);
              return (
                <div key={t.id} className="py-3 flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{t.name}</span>
                    <span className="text-xs text-text-muted">{t.language}</span>
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", TONE[st.tone])}>{st.text}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-border text-text-muted">
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                    {willChange && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-text">
                        A Meta vai reclassificar para {CATEGORY_LABEL[t.correctCategory as string] ?? t.correctCategory}
                      </span>
                    )}
                  </div>
                  {t.bodyText && <p className="text-xs text-text-muted line-clamp-2">{t.bodyText}</p>}
                  {legend.length > 0 && <p className="text-xs text-text-muted">{legend.join(" · ")}</p>}
                  {t.status === "REJECTED" && t.rejectedReason && <p className="text-xs text-danger">Motivo: {t.rejectedReason}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-surface border border-border rounded-xl shadow-sm p-5 flex flex-col gap-4">
        <h2 className="text-base font-bold">Criar template</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Nome do template
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              placeholder="ex.: retorno_orcamento"
              className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface"
            />
            <span className="text-xs text-text-muted font-normal">Só letras minúsculas, números e _.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Categoria
            <select value={category} onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")} className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface cursor-pointer">
              <option value="UTILITY">Utilidade (follow-up, retorno de uma ação do lead)</option>
              <option value="MARKETING">Marketing (oferta, campanha)</option>
            </select>
            <span className="text-xs text-text-muted font-normal">A Meta pode reclassificar. Se isso acontecer, aparece aqui.</span>
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Texto
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={4}
            maxLength={1024}
            placeholder="Oi {{1}}, tudo bem? Passando pra saber se ainda posso te ajudar da {{2}}."
            className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface"
          />
          <span className="text-xs text-text-muted font-normal">Use {"{{1}}"}, {"{{2}}"}… para variáveis, em sequência. Não pode começar nem terminar com variável.</span>
        </label>

        {varCount > 0 && (
          <div className="flex flex-col gap-3 rounded-lg bg-bg p-4">
            <p className="text-sm font-semibold">O que cada variável vai preencher</p>
            <p className="text-xs text-text-muted">
              Escolha um campo da lista de contatos deste workspace. Na hora do envio, a mensagem leva o valor desse campo de cada contato.
            </p>
            {Array.from({ length: varCount }, (_, i) => {
              const current = fields.find((f) => f.value === chosen[i]);
              return (
                <label key={i} className="flex flex-col gap-1.5 text-sm font-semibold">
                  {`{{${i + 1}}}`} vai ser preenchido com
                  <select value={chosen[i] || ""} onChange={(e) => setField(i, e.target.value)} className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface cursor-pointer">
                    <option value="">Escolha um campo…</option>
                    {fields.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {current && <span className="text-xs text-text-muted font-normal">Exemplo: {current.example}</span>}
                </label>
              );
            })}

            {allChosen && bodyText && (
              <div className="rounded-md bg-surface border border-border p-3">
                <p className="text-xs font-semibold text-text-muted mb-1">Prévia com os exemplos</p>
                <p className="text-sm whitespace-pre-wrap">{previewText(bodyText, chosen, fields)}</p>
              </div>
            )}
          </div>
        )}

        {formError && <p className="text-sm text-danger font-medium">{formError}</p>}
        {notice && <p className="text-sm text-success font-medium">{notice}</p>}

        <div>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name || !bodyText || !allChosen}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-60"
          >
            {pending ? "Enviando para a Meta…" : "Enviar para análise da Meta"}
          </button>
        </div>
      </section>
    </div>
  );
}
