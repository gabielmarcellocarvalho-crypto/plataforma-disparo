"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inspectImportFile, importContacts, type ImportResult } from "@/app/actions/contacts";
import { createCustomFieldDef } from "@/app/actions/custom-fields";
import type { ImportTarget, SheetPreview } from "@/lib/import-contacts";
import { normalizeFieldKey, type CustomFieldDef } from "@/lib/custom-fields";
import { TagPicker } from "@/components/tag-picker";

type Preview = SheetPreview & { suggestion: Record<string, ImportTarget> };

const ALVOS_PADRAO: { key: ImportTarget; label: string }[] = [
  { key: "ignorar", label: "— ignorar" },
  { key: "nome", label: "Nome" },
  { key: "telefone", label: "Telefone" },
  { key: "email", label: "E-mail" },
  { key: "responsavel", label: "Responsável" },
  { key: "filial", label: "Filial" },
  { key: "etapa", label: "Etapa do funil" },
  { key: "motivo_perda", label: "Motivo da perda" },
];

// Valor sentinela do select: nao e um destino, e "quero criar um campo novo agora".
const NOVO_CAMPO = "__novo_campo__";

export function ImportContactsForm({ fieldDefs: defsIniciais = [], availableTags = [] }: { fieldDefs?: CustomFieldDef[]; availableTags?: string[] }) {
  const router = useRouter();
  // Campo criado aqui entra na lista sem recarregar a pagina — recarregar perderia o arquivo
  // escolhido e o de/para ja preenchido.
  const [fieldDefs, setFieldDefs] = useState(defsIniciais);
  // Coluna da planilha cujo destino vai virar um campo novo (null = ninguem criando agora).
  const [criandoPara, setCriandoPara] = useState<string | null>(null);
  const [novoCampoLabel, setNovoCampoLabel] = useState("");
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportTarget>>({});
  const [modo, setModo] = useState<"ignorar" | "atualizar">("ignorar");
  // Tags aplicadas a toda a planilha — é o que transforma a lista importada num grupo pra disparar.
  const [tags, setTags] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function inspecionar(arquivo: File, aba?: string) {
    setErro(null);
    const fd = new FormData();
    fd.set("file", arquivo);
    if (aba) fd.set("sheet", aba);
    startTransition(async () => {
      const r = await inspectImportFile(fd);
      if (r.error) {
        setErro(r.error);
        setPreview(null);
        return;
      }
      setPreview(r);
      setMapping(r.suggestion);
    });
  }

  function escolherArquivo(arquivo: File) {
    setFile(arquivo);
    setResultado(null);
    inspecionar(arquivo);
  }

  function importar() {
    if (!file || !preview) return;
    setErro(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sheet", preview.sheet);
    fd.set("mode", modo);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("tags", tags.join(","));
    startTransition(async () => {
      const r = await importContacts({ error: null }, fd);
      if (r.error) {
        setErro(r.error);
        return;
      }
      setResultado(r);
      setPreview(null);
      setFile(null);
      router.refresh();
    });
  }

  function fechar() {
    setPreview(null);
    setFile(null);
    setErro(null);
  }

  const alvos: { key: string; label: string }[] = [
    ...ALVOS_PADRAO,
    ...fieldDefs.map((d) => ({ key: `campo:${d.key}`, label: d.label })),
    { key: NOVO_CAMPO, label: "+ criar campo novo…" },
  ];

  // Cria o campo personalizado sem sair do de/para e ja aponta a coluna pra ele. E o caso comum
  // de planilha de cliente: a coluna "Faturamento" existe no arquivo e nao existe no workspace, e
  // antes era preciso abandonar a importacao, criar o campo em Pipeline > campos do lead e comecar
  // tudo de novo.
  function criarCampo(coluna: string) {
    const label = novoCampoLabel.trim();
    setErroCampo(null);
    if (!label) {
      setErroCampo("De um nome ao campo.");
      return;
    }

    const key = normalizeFieldKey(label);
    const existente = fieldDefs.find((d) => d.key === key);
    if (existente) {
      // Ja existe campo com esse nome: usa o que existe em vez de falhar. Dois campos com o mesmo
      // rotulo seriam indistinguiveis na tela e na planilha exportada.
      setMapping((m) => ({ ...m, [coluna]: `campo:${existente.key}` as ImportTarget }));
      setCriandoPara(null);
      setNovoCampoLabel("");
      return;
    }

    startTransition(async () => {
      const r = await createCustomFieldDef({ label, type: "texto", options: [], required: false, showInTable: true, showInCard: false });
      if (r.error || !r.id) {
        setErroCampo(r.error || "Nao foi possivel criar o campo.");
        return;
      }
      setFieldDefs((f) => [
        ...f,
        { id: r.id as string, key, label, type: "texto", options: [], required: false, show_in_table: true, show_in_card: false, position: f.length },
      ]);
      setMapping((m) => ({ ...m, [coluna]: `campo:${key}` as ImportTarget }));
      setCriandoPara(null);
      setNovoCampoLabel("");
    });
  }
  const temDestino = Object.values(mapping).some((t) => t === "telefone" || t === "email");

  return (
    <>
      <label className="bg-surface border border-border text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer hover:bg-primary-faint">
        {pending && !preview ? "Lendo…" : "Importar planilha"}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) escolherArquivo(f);
            e.target.value = ""; // permite reescolher o mesmo arquivo depois de fechar
          }}
        />
      </label>

      {erro && !preview && <span className="text-sm text-danger font-medium ml-3">{erro}</span>}

      {resultado && !resultado.error && (
        <div className="ml-3 text-sm">
          <span className="text-success font-medium">
            {resultado.imported} novo(s)
            {resultado.updated ? `, ${resultado.updated} atualizado(s)` : ""} de {resultado.total} linha(s)
          </span>
          <span className="text-text-muted">
            {resultado.skippedDuplicate ? ` · ${resultado.skippedDuplicate} já existiam` : ""}
            {resultado.skippedInvalid ? ` · ${resultado.skippedInvalid} sem telefone/e-mail` : ""}
            {resultado.newOptions ? ` · ${resultado.newOptions} opção(ões) nova(s) nos campos` : ""}
          </span>
          {(resultado.unmatchedResponsaveis?.length || resultado.unmatchedFiliais?.length) ? (
            <p className="text-xs text-warning-text mt-1">
              Sem cadastro em Equipe (ficaram sem vínculo):{" "}
              {[...(resultado.unmatchedResponsaveis ?? []), ...(resultado.unmatchedFiliais ?? [])].join(", ")}
            </p>
          ) : null}
        </div>
      )}

      {preview && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={fechar} aria-hidden />
          <div
            role="dialog"
            aria-label="Mapear colunas da planilha"
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(880px,calc(100vw-2rem))] max-h-[calc(100vh-4rem)] overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-4 text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold">O que é cada coluna?</h2>
                <p className="text-xs text-text-muted mt-0.5">
                  {preview.total} linha(s) na aba <b>{preview.sheet}</b>. Já chutei o de/para pelo nome do cabeçalho —
                  confira antes de importar.
                </p>
              </div>
              <button type="button" onClick={fechar} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {preview.sheets.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-text-muted">Aba:</span>
                {preview.sheets.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => file && inspecionar(file, s)}
                    disabled={pending}
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border cursor-pointer transition-colors disabled:opacity-50 ${
                      s === preview.sheet ? "border-primary-strong bg-primary-strong text-white" : "border-border text-text-muted hover:border-primary-soft"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                    <th className="px-3 py-2">Coluna da planilha</th>
                    <th className="px-3 py-2">Exemplo</th>
                    <th className="px-3 py-2 w-56">Vira o quê</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h, i) => {
                    const exemplo = preview.sample.map((linha) => linha[i]).find((v) => v) ?? "";
                    const alvo = mapping[h] ?? "ignorar";
                    return (
                      <tr key={h} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-semibold">{h}</td>
                        <td className="px-3 py-2 text-text-muted truncate max-w-[220px]" title={exemplo}>
                          {exemplo || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={criandoPara === h ? NOVO_CAMPO : alvo}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === NOVO_CAMPO) {
                                setErroCampo(null);
                                setNovoCampoLabel(h);
                                setCriandoPara(h);
                                return;
                              }
                              setCriandoPara((c) => (c === h ? null : c));
                              setMapping((m) => ({ ...m, [h]: v as ImportTarget }));
                            }}
                            className={`w-full border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary bg-surface cursor-pointer ${
                              alvo === "ignorar" ? "border-border text-text-muted" : "border-primary-soft text-text"
                            }`}
                          >
                            {alvos.map((a) => (
                              <option key={a.key} value={a.key}>
                                {a.label}
                              </option>
                            ))}
                          </select>

                          {criandoPara === h && (
                            <div className="flex flex-col gap-1 mt-1.5">
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  value={novoCampoLabel}
                                  onChange={(e) => setNovoCampoLabel(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      criarCampo(h);
                                    }
                                    if (e.key === "Escape") setCriandoPara(null);
                                  }}
                                  maxLength={40}
                                  placeholder="Nome do campo (ex.: Faturamento)"
                                  className="flex-1 border border-primary-soft rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => criarCampo(h)}
                                  disabled={pending}
                                  className="text-xs font-bold px-2.5 py-1.5 rounded-md bg-primary-strong text-white cursor-pointer disabled:opacity-50"
                                >
                                  criar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCriandoPara(null)}
                                  className="text-xs font-bold px-1.5 py-1.5 text-text-muted cursor-pointer"
                                >
                                  cancelar
                                </button>
                              </div>
                              {erroCampo ? (
                                <span className="text-[11px] text-danger">{erroCampo}</span>
                              ) : (
                                <span className="text-[11px] text-text-muted">
                                  Vira um campo de texto do lead, visivel na tabela de contatos e na exportacao.
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Tags dessa lista</span>
              <p className="text-[11px] text-text-muted">
                Aplicadas a todas as {preview.total} linhas. É por elas que você escolhe esse grupo na hora de ativar um disparo —
                quem já existe mantém as tags que tinha, essas entram por cima.
              </p>
              <TagPicker value={tags} onChange={setTags} suggestions={availableTags} placeholder="ex.: Lista ENACAL 2026" compact />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Contato que já existe (mesmo telefone)</span>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={modo === "ignorar"} onChange={() => setModo("ignorar")} className="cursor-pointer accent-[var(--color-primary-strong)]" />
                  Pular — não mexe no que já está lá
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={modo === "atualizar"} onChange={() => setModo("atualizar")} className="cursor-pointer accent-[var(--color-primary-strong)]" />
                  Atualizar com o que veio na planilha
                </label>
              </div>
              <p className="text-[11px] text-text-muted">
                Atualizar mescla os campos: o que a planilha não traz continua como está na plataforma. Etapa do funil
                só muda se você mapear uma coluna pra ela.
              </p>
            </div>

            {erro && <span className="text-sm text-danger font-medium">{erro}</span>}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={importar}
                disabled={pending || !temDestino}
                className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60"
              >
                {pending ? "Importando…" : `Importar ${preview.total} linha(s)`}
              </button>
              {!temDestino && <span className="text-xs text-danger">Aponte uma coluna pra Telefone ou E-mail.</span>}
              <button type="button" onClick={fechar} disabled={pending} className="text-sm font-semibold text-text-muted hover:text-text cursor-pointer px-2">
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
