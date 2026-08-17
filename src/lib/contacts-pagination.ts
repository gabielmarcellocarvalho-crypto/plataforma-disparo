// Constante compartilhada entre o componente cliente (seletor de tamanho de página) e a página de
// servidor (Contatos) — precisa ficar FORA de um arquivo "use client": exports não-componente de um
// módulo client não atravessam a fronteira server/client como o valor real (viram uma referência
// opaca), então `PAGE_SIZES.includes(...)` quebra em runtime no servidor ("includes is not a
// function") mesmo compilando sem erro.
export const PAGE_SIZES = [50, 100, 500] as const;
