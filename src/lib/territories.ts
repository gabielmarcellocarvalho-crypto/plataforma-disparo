// Roteamento por território: cidade do lead → vendedor responsável.
//
// Usado em três momentos, sempre com a mesma regra: na importação de planilha, quando o agente
// descobre a cidade no meio da conversa, e no botão que aplica em massa aos leads já existentes.

// A mesma cidade chega escrita de N jeitos ("Três Pontas", "TRES PONTAS", "tres  pontas", "Três
// Pontas - MG"). A chave normalizada é o que faz as três virarem a mesma linha do mapa.
export function normalizeCity(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Sufixo de UF é ruído pro casamento: a planilha escreve "Barroso - MG" numa coluna e "Barroso"
    // na outra, e são a mesma cidade.
    .replace(/[\s-]+(mg|sp|rj|es|go|mt|ms|pr|sc|rs|ba|mn)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type TerritoryRoute = { teamMemberId: string | null; branchId: string | null };

// ── Casamento de nome de vendedor ─────────────────────────────────────────
// O mapa de território é escrito com apelido ("JADER", "FRED CARVALHO", "Joao H."), enquanto o
// cadastro tem o nome completo ("Jader Augusto Reis Brito", "Frederico Teixeira Carvalho Firmiano").
// Casar só por primeiro nome erra nos dois sentidos: "FRED" não é prefixo exato de nada, e "Joao"
// bate em dois vendedores diferentes da mesma filial.

const RUIDO = new Set(["de", "da", "do", "das", "dos", "junior", "filho", "neto"]);

function tokens(nome: string): string[] {
  return normalizeCity(nome)
    .split(" ")
    .filter((t) => t.length >= 1 && !RUIDO.has(t));
}

function tokenCasa(a: string, b: string): boolean {
  if (a === b) return true;
  // Letra sozinha é inicial abreviada: em "Joao H." o "H" é o que separa João Henrique de João
  // Batista, os dois vendedores da mesma filial. Sem isso os dois empatam e ninguém ganha.
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  // Prefixo nos dois sentidos cobre "fred" -> "frederico".
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (b.length >= 3 && a.startsWith(b)) return true;
  return false;
}

export type NamedMember = { id: string; name: string; branch_id?: string | null };

// Devolve a pessoa quando existe UMA melhor candidata. Empate devolve null de propósito: chutar
// entre dois vendedores manda o lead pro errado, o que é pior do que devolver "não achei" e deixar
// quem colou o mapa desambiguar.
export function matchMemberByName<T extends NamedMember>(nome: string, membros: T[]): T | null {
  const alvo = tokens(nome);
  if (alvo.length === 0) return null;

  const exato = membros.find((m) => normalizeCity(m.name) === normalizeCity(nome));
  if (exato) return exato;

  const pontuados = membros
    .map((m) => ({ m, score: alvo.filter((t) => tokens(m.name).some((x) => tokenCasa(t, x))).length }))
    .filter((c) => c.score > 0);
  if (pontuados.length === 0) return null;

  const melhor = Math.max(...pontuados.map((c) => c.score));
  const finalistas = pontuados.filter((c) => c.score === melhor);
  return finalistas.length === 1 ? finalistas[0].m : null;
}

// Uma linha "Cidade = Vendedor" (aceita também ":" e tab, que é o que sai ao colar de planilha).
export function parseTerritoryLine(linha: string): { city: string; member: string } | null {
  const m = /^(.*?)\s*(?:=|:|\t)\s*(.*)$/.exec(linha.trim());
  if (!m) return null;
  const city = m[1].trim();
  const member = m[2].trim();
  if (!city || !member) return null;
  return { city, member };
}
