// Substituição das variáveis de personalização no texto de campanha (WhatsApp e e-mail).
//
// Aceita {nome} E [Nome]: os templates que os clientes escrevem fora da plataforma (Google Docs,
// agência de conteúdo) usam colchete, e colar um deles aqui mandava "Olá, [Nome]," literal pro
// destinatário — falha silenciosa, porque nada no sistema reclama de um texto que não casa com a
// única sintaxe conhecida. Qualquer caixa serve ({NOME}, [nome], {Nome}).

export function firstName(name: string | null): string {
  const first = (name || "").trim().split(/\s+/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function applyContactVars(text: string, name: string | null): string {
  return text.replace(/[{[]\s*nome\s*[}\]]/gi, firstName(name));
}
