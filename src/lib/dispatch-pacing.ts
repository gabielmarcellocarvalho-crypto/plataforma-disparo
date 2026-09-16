// Ritmo de disparo: quanto sai por dia (rampa) e de quanto em quanto tempo sai cada um (delay).
//
// Antes isso era 100% manual: a pessoa digitava a rampa como "50,80,120,170,230,300" e o delay como
// dois números soltos, sem relação nenhuma entre eles. Dava pra configurar 300 disparos/dia com 180s
// de intervalo numa janela de 8h — que não cabe (só daria 160) e a campanha silenciosamente nunca
// cumpria a cota. Aqui a rampa virou escolha de caixa e o delay passa a ser DERIVADO dela.

export type Channel = "whatsapp" | "email";

export type RampPreset = { key: string; label: string; hint: string; ramp: number[] };

// Sem rampa = sem teto diário na prática (o limitador vira só a janela de horário e o delay).
const SEM_RAMPA = 100000;

export const RAMP_PRESETS: Record<Channel, RampPreset[]> = {
  // WhatsApp: a rampa é anti-ban. Número novo que dispara 500 mensagens no primeiro dia é bloqueado
  // pela Meta — os degraus abaixo são o que já rodou no piloto sem bloqueio.
  whatsapp: [
    { key: "conservadora", label: "Conservadora", hint: "50 → 300/dia. Número novo ou recém-desbloqueado.", ramp: [50, 80, 120, 170, 230, 300] },
    { key: "moderada", label: "Moderada", hint: "100 → 600/dia. Número com histórico de disparo.", ramp: [100, 160, 240, 340, 460, 600] },
    { key: "rapida", label: "Rápida", hint: "200 → 1200/dia. Só pra número maduro, com API oficial.", ramp: [200, 320, 480, 680, 920, 1200] },
    { key: "sem_rampa", label: "Sem rampa", hint: "Sem teto diário. Risco real de bloqueio do número.", ramp: [SEM_RAMPA] },
  ],
  // E-mail: a rampa é aquecimento de domínio/reputação, não anti-ban. Domínio novo que manda 2000
  // e-mails no primeiro dia vai direto pro spam — e quem paga a conta é o domínio, não a campanha.
  email: [
    { key: "conservadora", label: "Conservadora", hint: "50 → 1500/dia. Domínio novo, primeira campanha.", ramp: [50, 100, 200, 400, 800, 1500] },
    { key: "moderada", label: "Moderada", hint: "200 → 3000/dia. Domínio já usado, sem histórico de spam.", ramp: [200, 400, 800, 1600, 3000] },
    { key: "rapida", label: "Rápida", hint: "1000 → 8000/dia. Domínio aquecido e com engajamento.", ramp: [1000, 2000, 4000, 8000] },
    { key: "sem_rampa", label: "Sem rampa", hint: "Sem teto diário. Depende da cota do plano do Resend.", ramp: [SEM_RAMPA] },
  ],
};

// O cron externo invoca o motor a cada 60s. Dentro de uma invocação o motor manda em lote (até
// MAX_ENVIOS_POR_TICK por campanha), então o teto de entrega é 10/min por campanha — não 1/min.
export const TICK_SEGUNDOS = 60;
export const MAX_ENVIOS_POR_TICK = 10;

// Piso do intervalo, por canal:
// WhatsApp — 60s por decisão de produto, não técnica: rajada é o comportamento que a Meta usa pra
// identificar robô, e o número do cliente é que paga a conta de um bloqueio.
// E-mail — 5s. Não existe "ban" por ritmo aqui (reputação de domínio se constrói por volume DIÁRIO e
// engajamento, que é o que a rampa controla), então o limite é só não atropelar a API do Resend.
const DELAY_MINIMO: Record<Channel, number> = { whatsapp: TICK_SEGUNDOS, email: 5 };
const DELAY_MAXIMO = 900;

// Quanto o motor consegue entregar na janela, no melhor caso: 10 por minuto.
export function tetoDoMotor(hourStart: number, hourEnd: number): number {
  return Math.floor((Math.max(1, hourEnd - hourStart) * 60 * MAX_ENVIOS_POR_TICK));
}

export function rampPreset(channel: Channel, key: string): RampPreset | null {
  return RAMP_PRESETS[channel].find((p) => p.key === key) ?? null;
}

// Delay derivado: espalha a cota do dia pela janela de horário escolhida. 300 disparos numa janela
// das 9h às 20h = 1 a cada ~132s. Devolve faixa (mín/máx) em vez de valor fixo porque intervalo
// exato entre mensagens é, ele próprio, assinatura de robô.
export function autoDelaySeconds(quotaDoDia: number, hourStart: number, hourEnd: number, channel: Channel): [number, number] {
  const janelaSegundos = Math.max(1, hourEnd - hourStart) * 3600;
  const bruto = janelaSegundos / Math.max(1, quotaDoDia);
  const base = Math.min(DELAY_MAXIMO, Math.max(DELAY_MINIMO[channel], bruto));
  const min = Math.max(DELAY_MINIMO[channel], Math.round(base * 0.6));
  const max = Math.max(min + 1, Math.round(base * 1.4));
  return [min, max];
}

// Texto pra tela: "1 a cada ~2min (cabem 330 na janela)". Serve pra pessoa ver ANTES de ativar que a
// cota escolhida cabe (ou não) na janela de horário — o descompasso que antes só aparecia dias depois,
// como campanha que não termina.
export function describePacing(quotaDoDia: number, hourStart: number, hourEnd: number, channel: Channel): string {
  const [min, max] = autoDelaySeconds(quotaDoDia, hourStart, hourEnd, channel);
  const medio = (min + max) / 2;
  const janelaSegundos = Math.max(1, hourEnd - hourStart) * 3600;
  // O que cabe é o menor entre "o intervalo permite" e "o motor entrega" (10 por invocação, 1 por minuto).
  const cabem = Math.min(Math.floor(janelaSegundos / medio), tetoDoMotor(hourStart, hourEnd));
  const intervalo = medio >= 60 ? `${(medio / 60).toFixed(medio >= 600 ? 0 : 1)}min` : `${Math.round(medio)}s`;
  const cota = quotaDoDia >= SEM_RAMPA ? "sem teto diário" : `${quotaDoDia}/dia`;
  const base = `${cota} — 1 a cada ~${intervalo}, cabem ~${cabem} entre ${hourStart}h e ${hourEnd}h`;
  // Cota maior do que o motor entrega na janela: a diferença simplesmente transborda pro dia
  // seguinte. Melhor a pessoa ver isso aqui do que descobrir com a campanha atrasada.
  return quotaDoDia < SEM_RAMPA && quotaDoDia > cabem ? `${base} (o resto passa pro dia seguinte)` : base;
}
