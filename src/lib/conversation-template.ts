// Template mandado pela tela de Conversas pra UM contato (fora da janela de 24h só template entra).
// Preenche as variáveis com a mesma regra do disparo de campanha: o mapeamento salvo em Templates
// ({{1}} → nome, empresa, campo...), o nome vira só o primeiro nome, e sem mapeamento um template de
// uma variável só recebe o primeiro nome (o padrão antigo das campanhas).
import { firstName } from "@/lib/message-vars";
import { fieldValue, type TemplateFieldContact } from "@/lib/template-send";

// Cabeçalho que dá pra mandar daqui: sem cabeçalho ou cabeçalho de texto fixo. Imagem/documento/vídeo
// pedem a mídia a cada envio — isso fica no disparo de campanha, que tem o upload.
export function templateHeaderSupported(headerFormat: string | null): boolean {
  return !headerFormat || headerFormat === "TEXT";
}

export type TemplateParams = { params: string[]; error: null } | { params: null; error: string };

export function templateParamsFor(
  varCount: number,
  mapping: string[] | null | undefined,
  contact: TemplateFieldContact,
  companyName: string | null
): TemplateParams {
  if (varCount <= 0) return { params: [], error: null };
  const fields = (mapping || []).slice(0, varCount);
  let params: string[];
  if (fields.length === varCount) {
    params = fields.map((f) => (f === "name" ? firstName(contact.name) : fieldValue(f, contact, companyName)).trim());
  } else if (varCount === 1) {
    params = [firstName(contact.name)];
  } else {
    return { params: null, error: "Esse template tem variáveis sem campo escolhido. Defina em Templates o que preenche cada {{n}}." };
  }
  const empty = params.findIndex((p) => !p);
  if (empty >= 0) {
    const campo = fields[empty] ?? "name";
    return { params: null, error: `O contato não tem o dado da variável {{${empty + 1}}} (${campo === "name" ? "nome" : campo.replace(/^cf:/, "")}).` };
  }
  return { params, error: null };
}
