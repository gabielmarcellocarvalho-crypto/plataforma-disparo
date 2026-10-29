"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createWorkspaceTemplate, type TemplateMappings } from "@/app/actions/templates";
import { prepareCampaignHeaderUpload } from "@/app/actions/campaigns";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { headerMediaRule, validateHeaderFile, type HeaderMediaFormat } from "@/lib/template-header";
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

// Erros que a Meta recusaria, mostrados enquanto a pessoa digita (antes de gastar uma análise).
function templateProblems(name: string, body: string): string[] {
  const out: string[] = [];
  if (name && !/^[a-z0-9_]+$/.test(name)) out.push("O nome só pode ter letras minúsculas, números e _.");
  const text = body.trim();
  if (!text) return out;
  if (/^\{\{\d+\}\}/.test(text)) out.push("O texto não pode começar com variável.");
  if (/\{\{\d+\}\}$/.test(text)) out.push("O texto não pode terminar com variável.");
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const distinct = [...new Set(nums)].sort((a, b) => a - b);
  if (distinct.some((n, i) => n !== i + 1)) out.push("As variáveis precisam ser em sequência: {{1}}, {{2}}, {{3}}…");
  return out;
}

// Prévia de como o lead vê a mensagem no WhatsApp (balão verde do lado de quem envia).
function WhatsappBubblePreview({ text }: { text: string }) {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="lg:sticky lg:top-0">
      <p className="text-xs font-bold text-text-muted mb-2">Como o lead vai ver</p>
      <div className="rounded-xl p-4 min-h-[220px] flex flex-col justify-end" style={{ background: "#efeae2" }}>
        {text ? (
          <div className="self-end max-w-[90%] rounded-lg rounded-tr-none px-3 py-2 shadow-sm text-[13.5px] leading-snug text-[#111b21]" style={{ background: "#d9fdd3" }}>
            <p className="whitespace-pre-wrap break-words">{text}</p>
            <span className="block text-right text-[10px] text-[#667781] mt-1">{hora} ✓✓</span>
          </div>
        ) : (
          <p className="text-xs text-[#667781] text-center">Digite o texto ao lado para ver a prévia.</p>
        )}
      </div>
      <p className="text-[11px] text-text-muted mt-2">Variáveis aparecem com o exemplo do campo escolhido.</p>
    </div>
  );
}

export type CategoryAlert = { id: string; name: string; previous: string | null; next: string | null; correct: string | null; at: string };

export function TemplatesManager({
  templates,
  mappings,
  fields,
  error,
  alerts,
  usage = {},
  readOnly = false,
}: {
  templates: MetaTemplateRow[];
  mappings: TemplateMappings;
  fields: TemplateField[];
  error: string | null;
  alerts: CategoryAlert[];
  usage?: Record<string, number>;
  readOnly?: boolean; // 360dialog: lista só os aprovados; criar template é no painel do 360dialog
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [variableFields, setVariableFields] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [headerFormat, setHeaderFormat] = useState<HeaderMediaFormat | "">("");
  const [headerUpload, setHeaderUpload] = useState<{ path: string; name: string } | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  function pickHeaderFormat(value: string) {
    setHeaderFormat(value === "IMAGE" || value === "DOCUMENT" ? value : "");
    setHeaderUpload(null);
    setHeaderError(null);
  }

  async function onHeaderFile(file: File | null) {
    setHeaderError(null);
    setHeaderUpload(null);
    if (!file || !headerFormat) return;
    const invalid = validateHeaderFile(headerFormat, file.type, file.size);
    if (invalid) return setHeaderError(invalid);
    setUploadingHeader(true);
    try {
      const prep = await prepareCampaignHeaderUpload(headerFormat, file.name, file.type, file.size);
      if (prep.error || !prep.path || !prep.token) return setHeaderError(prep.error || "Não foi possível preparar o envio.");
      const { error } = await createBrowserSupabase()
        .storage.from("conversation-media")
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type.split(";")[0] });
      if (error) return setHeaderError(`Falha ao subir o arquivo: ${error.message}`);
      setHeaderUpload({ path: prep.path, name: file.name });
    } catch {
      setHeaderError("Falha de conexão ao subir o arquivo. Tente de novo.");
    } finally {
      setUploadingHeader(false);
    }
  }

  const varCount = useMemo(() => variableCount(bodyText), [bodyText]);
  const problems = useMemo(() => templateProblems(name, bodyText), [name, bodyText]);
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
      const r = await createWorkspaceTemplate({
        name,
        category,
        language: "pt_BR",
        bodyText,
        variableFields: chosen,
        headerFormat: headerFormat || null,
        headerMediaPath: headerUpload?.path ?? null,
        headerMediaName: headerUpload?.name ?? null,
      });
      if (r.error !== null) {
        setFormError(r.error);
        return;
      }
      setNotice(`Template enviado para análise da Meta (${STATUS_LABEL[r.status]?.text ?? r.status}). Acompanhe o status abaixo.`);
      setName("");
      setBodyText("");
      setVariableFields([]);
      pickHeaderFormat("");
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
                    {usage[t.name] ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary-faint text-primary-strong">
                        usado em {usage[t.name]} automação(ões)
                      </span>
                    ) : null}
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

      {readOnly ? (
        <p className="text-sm text-text-muted">Número conectado pelo 360dialog: aqui você vê os templates aprovados. Para criar um novo, use o painel do 360dialog.</p>
      ) : (
      <section className="bg-surface border border-border rounded-xl shadow-sm p-5 grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        <div className="flex flex-col gap-4 min-w-0">
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

        <div className="flex flex-col gap-1.5 text-sm font-semibold">
          <label htmlFor="template-header-format">
            Cabeçalho <span className="font-normal text-text-muted">(opcional)</span>
          </label>
          <select
            id="template-header-format"
            value={headerFormat}
            onChange={(e) => pickHeaderFormat(e.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm font-normal outline-none focus:border-primary bg-surface cursor-pointer"
          >
            <option value="">Sem cabeçalho</option>
            <option value="IMAGE">Imagem</option>
            <option value="DOCUMENT">Documento (PDF)</option>
          </select>
          {headerFormat && (
            <>
              <input
                type="file"
                accept={headerMediaRule(headerFormat).accept}
                onChange={(e) => onHeaderFile(e.target.files?.[0] ?? null)}
                disabled={uploadingHeader}
                className="text-sm font-normal"
              />
              <span className="text-xs text-text-muted font-normal">
                {headerMediaRule(headerFormat).label}. A Meta analisa esse arquivo como exemplo, e ele é enviado junto em automações, follow-ups e conversas.
              </span>
              {uploadingHeader && <span className="text-xs text-text-muted font-normal">Enviando arquivo…</span>}
              {headerUpload && !uploadingHeader && <span className="text-xs text-success font-semibold">Arquivo pronto: {headerUpload.name}</span>}
              {headerError && <span className="text-xs text-danger font-semibold">{headerError}</span>}
            </>
          )}
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

        {problems.length > 0 && (name || bodyText) && (
          <ul className="flex flex-col gap-1">
            {problems.map((p) => (
              <li key={p} className="text-xs text-warning-text font-semibold">⚠ {p}</li>
            ))}
          </ul>
        )}

        <div>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name || !bodyText || !allChosen || problems.length > 0 || uploadingHeader || (!!headerFormat && !headerUpload)}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-60"
          >
            {pending ? "Enviando para a Meta…" : "Enviar para análise da Meta"}
          </button>
        </div>
        </div>

        <WhatsappBubblePreview text={bodyText ? previewText(bodyText, chosen, fields) : ""} />
      </section>
      )}
    </div>
  );
}
