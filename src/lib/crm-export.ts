// Exportação dos leads do Pipeline pra planilha. A equipe do cliente trabalha o lead exportado fora
// da plataforma (lista de ligação do vendedor, planilha de agendamentos da concessionária), então o
// que importa aqui é sair no formato que o Excel pt-BR abre sem nenhum ajuste: separador ";" e BOM
// UTF-8 — sem isso, acento vira caractere quebrado e a linha inteira cai numa coluna só.
//
// O arquivo é gerado no navegador a partir do que já está na tela: o mesmo conjunto filtrado que a
// pessoa está vendo, na mesma ordem. Exportar "o que o board mostra" é o que evita a pergunta
// seguinte ("por que a planilha veio com lead que não aparece aqui?").
import { formatFieldValue, readMultiValue, type CustomFieldDef } from "@/lib/custom-fields";

export type ExportableContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  stage_changed_at: string;
  lost_reason: string | null;
  team_member_id: string | null;
  branch_id: string | null;
};

export type ExportContext = {
  // Nome da fase/etapa de cada lead — o board já sabe calcular isso (funil ou as 7 fases fixas).
  stageName: (c: ExportableContact) => string;
  teamName: (id: string | null) => string;
  branchName: (id: string | null) => string;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Célula de CSV: aspas dobradas e o campo inteiro entre aspas quando tem separador, aspas ou quebra
// de linha. Campo que começa com =, +, - ou @ ganha um apóstrofo na frente — o Excel trataria como
// fórmula, e um telefone colado como "+55..." viraria erro na planilha do cliente.
export function csvCell(value: string): string {
  const s = value.replace(/\r?\n/g, " ").trim();
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Colunas fixas + uma coluna por campo personalizado definido, na ordem em que o cliente organizou
// os campos. Campo gravado sem definição (formato livre antigo, ou o que o agente de IA coletou
// sozinho via [[DADOS: chave=valor]]) entra depois, senão o dado existiria no lead e sumiria da
// planilha — que é justamente onde o cliente vai procurar.
export function buildCrmCsv(contacts: ExportableContact[], defs: CustomFieldDef[], ctx: ExportContext): string {
  const known = new Set(defs.map((d) => d.key));
  const extraKeys: string[] = [];
  for (const c of contacts) {
    for (const [k, v] of Object.entries(c.custom_fields || {})) {
      if (known.has(k) || extraKeys.includes(k)) continue;
      if (v === null || v === undefined || v === "") continue;
      extraKeys.push(k);
    }
  }
  extraKeys.sort();

  const header = [
    "Nome",
    "Telefone",
    "E-mail",
    "Fase",
    "Responsável",
    "Filial",
    "Motivo da perda",
    "Entrou em",
    "Mudou de fase em",
    ...defs.map((d) => d.label),
    ...extraKeys,
  ];

  const linhas = contacts.map((c) => {
    const cf = c.custom_fields || {};
    const valores = defs.map((d) => formatFieldValue(d, cf[d.key]));
    const extras = extraKeys.map((k) => {
      const raw = cf[k];
      return Array.isArray(raw) ? readMultiValue(raw).join(", ") : String(raw ?? "");
    });
    return [
      c.name || "",
      c.phone || "",
      c.email || "",
      ctx.stageName(c),
      ctx.teamName(c.team_member_id),
      ctx.branchName(c.branch_id),
      c.lost_reason || "",
      formatDateTime(c.created_at),
      formatDateTime(c.stage_changed_at),
      ...valores,
      ...extras,
    ];
  });

  return [header, ...linhas].map((linha) => linha.map(csvCell).join(";")).join("\r\n");
}

// "Semana do Cliente" + "Agendado" vira "semana-do-cliente-agendado-2026-09-17.csv".
export function exportFileName(pipelineName: string, stageName: string | null): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

  const hoje = new Date().toISOString().slice(0, 10);
  const partes = [slug(pipelineName) || "pipeline", stageName ? slug(stageName) : "todas-as-fases", hoje].filter(Boolean);
  return `${partes.join("-")}.csv`;
}

// BOM na frente: é o que faz o Excel abrir o arquivo como UTF-8 em vez de latin-1.
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
