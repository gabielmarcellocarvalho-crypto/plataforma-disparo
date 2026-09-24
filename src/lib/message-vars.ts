// Substituição das variáveis de personalização no texto de campanha (WhatsApp e e-mail).
//
// Aceita {nome}, {{nome}} E [Nome]: os templates que os clientes escrevem fora da plataforma (Google
// Docs, agência de conteúdo) usam colchete, e quem já mexeu com outra ferramenta de disparo escreve
// chave dupla. Colar um deles aqui mandava "Olá, [Nome]," literal pro destinatário — falha
// silenciosa, porque nada no sistema reclama de um texto que não casa com a sintaxe conhecida.
//
// Além de {nome}, qualquer CAMPO PERSONALIZADO do lead vira variável: a planilha importada com a
// coluna "Área de atuação" permite escrever "vi que você atua com {área de atuação}". O casamento é
// pela mesma normalização que gera a chave do campo na importação, então tanto o rótulo escrito por
// extenso quanto a chave crua funcionam.

export function firstName(name: string | null): string {
  const first = (name || "").trim().split(/\s+/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Mesma regra de normalizeFieldKey (custom-fields.ts): sem acento, minúsculo, separador virando "_".
// Duplicada de propósito — este módulo é usado no motor de disparo, que não deve depender do módulo
// de definição de campos só por uma função de 6 linhas.
function chaveDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function valorDoCampo(campos: Record<string, unknown>, chave: string): string {
  for (const [k, v] of Object.entries(campos)) {
    if (chaveDe(k) !== chave) continue;
    if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
    return String(v ?? "").trim();
  }
  return "";
}

// `{campo|texto padrão}` — o padrão entra quando o lead não tem esse campo preenchido. Sem isso, uma
// base onde metade dos contatos não tem "Área de atuação" mandaria meia frase pro cliente ("vi que
// você atua com ."), que é pior que uma frase genérica.
const VARIAVEL = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}|\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}|\[\s*([^[\]|]+?)\s*(?:\|\s*([^[\]]*?)\s*)?\]/g;

export function applyContactVars(text: string, name: string | null, customFields: Record<string, unknown> | null = null): string {
  const campos = customFields ?? {};
  const substituido = text.replace(VARIAVEL, (original, n1, f1, n2, f2, n3, f3) => {
    const nomeVar = (n1 ?? n2 ?? n3 ?? "").trim();
    const fallback = (f1 ?? f2 ?? f3 ?? "").trim();
    if (!nomeVar) return original;

    const chave = chaveDe(nomeVar);
    if (!chave) return original;
    if (chave === "nome" || chave === "primeiro_nome") return firstName(name) || fallback;

    const valor = valorDoCampo(campos, chave);
    if (valor) return valor;
    if (fallback) return fallback;
    // Campo desconhecido/vazio e sem padrão: apaga a variável em vez de mandar "{faturamento}" cru
    // pro lead. O espaço duplo que sobra é limpo abaixo.
    return "";
  });

  return substituido.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?;:])/g, "$1");
}

// Variáveis escritas num texto, pra tela de criação avisar o que não existe ANTES do disparo sair.
export function varsUsadas(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VARIAVEL)) {
    const nomeVar = (m[1] ?? m[3] ?? m[5] ?? "").trim();
    const chave = chaveDe(nomeVar);
    if (chave) out.add(chave);
  }
  return [...out];
}
