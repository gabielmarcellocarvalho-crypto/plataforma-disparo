// Tarifas oficiais do WhatsApp Business Platform no Brasil (por mensagem entregue, em BRL).
// Fonte: tabela informada pelo dono em out/2026. Quando a Meta mudar, atualize só aqui.
export const WHATSAPP_PRICE_BRL = {
  marketing: 0.3217,
  utility: 0.035,
  authentication: 0.035,
  service: 0.035,
} as const;

// Mensagem de serviço (texto livre): 1.000 grátis por número comercial por mês, não acumula.
export const SERVICE_FREE_PER_NUMBER_MONTH = 1000;

// A cobrança de mensagem de serviço começa em 01/10/2026 (America/Sao_Paulo). Antes disso é grátis.
export const SERVICE_CHARGE_FROM = new Date("2026-10-01T03:00:00.000Z");

// Clique em anúncio Click-to-WhatsApp abre 72h em que as mensagens são grátis.
export const CTWA_WINDOW_MS = 72 * 60 * 60 * 1000;
