// Constantes puras (sem import de Supabase/server) — importável tanto no client quanto no server.
export const COST_USD_TO_BRL = 5.4;
// Tarifa de entrega estimada (API oficial/Meta, repassada pelo BSP a custo) — mesma referência da
// calculadora (~0,68¢ USD ≈ R$0,037/msg no Brasil). Editável na tela, é só o valor sugerido.
export const DEFAULT_DELIVERY_RATE_BRL = 0.037;
