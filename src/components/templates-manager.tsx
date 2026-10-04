"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createWorkspaceTemplate } from "@/app/actions/templates";
import type { MetaTemplateRow } from "@/lib/metacloud-templates";
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

// Variáveis {{1}}, {{2}}... no texto: a tela pede um exemplo pra cada uma (a Meta exige).
function variablesIn(text: string): number {
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export function TemplatesManager({ templates, error }: { templates: MetaTemplateRow[]; error: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const varCount = useMemo(() => variablesIn(bodyText), [bodyText]);

  function submit() {
    setFormError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await createWorkspaceTemplate({ name, category, language: "pt_BR", bodyText, sampleValues: samples.slice(0, varCount) });
      if (r.error !== null) {
        setFormError(r.error);
        return;
      }
      setNotice(`Template enviado para análise da Meta (${STATUS_LABEL[r.status]?.text ?? r.status}). Acompanhe o status abaixo.`);
      setName("");
      setBodyText("");
      setSamples([]);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
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
            placeholder="Oi {{1}}, tudo bem? Passando pra saber se ainda posso te ajudar."
            className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface"
          />
          <span className="text-xs text-text-muted font-normal">Use {"{{1}}"}, {"{{2}}"}… para variáveis. Não pode começar nem terminar com variável.</span>
        </label>

        {varCount > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: varCount }, (_, i) => (
              <label key={i} className="flex flex-col gap-1.5 text-xs font-semibold">
                Exemplo para {`{{${i + 1}}}`}
                <input
                  value={samples[i] ?? ""}
                  onChange={(e) =>
                    setSamples((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder={i === 0 ? "ex.: Maria" : "ex.: R$ 1.200"}
                  className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface"
                />
              </label>
            ))}
          </div>
        )}

        {formError && <p className="text-sm text-danger font-medium">{formError}</p>}
        {notice && <p className="text-sm text-success font-medium">{notice}</p>}

        <div>
          <button type="button" onClick={submit} disabled={pending || !name || !bodyText} className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-60">
            {pending ? "Enviando para a Meta…" : "Enviar para análise da Meta"}
          </button>
        </div>
      </section>
    </div>
  );
}
