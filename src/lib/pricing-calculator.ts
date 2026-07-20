// Estimativa de custo de disparo — WhatsApp (Evolution API/Baileys) e E-mail (Resend).
// Valores de e-mail baseados na tabela pública do Resend (resend.com/pricing, checado em 2026-07-19).
// São valores DE REFERÊNCIA pra planejamento comercial — confirme no site deles antes de fechar contrato.

export type EmailEstimate = {
  plano: string;
  custoMensalUsd: number;
  observacao: string;
};

// Planos com volume incluso fixo (sem overage) — Free e Pro.
const PLANOS_FIXOS = [
  { limite: 3_000, plano: "Free", custoMensalUsd: 0 },
  { limite: 50_000, plano: "Pro (até 50 mil/mês)", custoMensalUsd: 20 },
  { limite: 100_000, plano: "Pro (até 100 mil/mês)", custoMensalUsd: 35 },
];

// Acima de 100 mil/mês, o plano Pro não cobre mais domínios múltiplos com folga — considera-se o Scale,
// que tem base de 100k por US$90 + taxa decrescente por milheiro excedente.
const SCALE_BASE_USD = 90;
const SCALE_BASE_VOLUME = 100_000;
const SCALE_OVERAGE_TIERS = [
  { ate: 200_000, taxaPorMil: 0.9 },
  { ate: 500_000, taxaPorMil: 0.8 },
  { ate: 1_000_000, taxaPorMil: 0.7 },
  { ate: 1_500_000, taxaPorMil: 0.65 },
  { ate: Infinity, taxaPorMil: 0.46 },
];

export function estimateEmailCost(emailsPorMes: number): EmailEstimate {
  if (emailsPorMes <= 0) {
    return { plano: "—", custoMensalUsd: 0, observacao: "Informe o volume mensal de e-mails." };
  }

  const fixo = PLANOS_FIXOS.find((p) => emailsPorMes <= p.limite);
  if (fixo) {
    return {
      plano: fixo.plano,
      custoMensalUsd: fixo.custoMensalUsd,
      observacao: fixo.custoMensalUsd === 0 ? "Limite de 100 e-mails/dia no plano grátis." : "Inclui até 10 domínios.",
    };
  }

  // Acima de 100k: base Scale + overage por faixa.
  let restante = emailsPorMes - SCALE_BASE_VOLUME;
  let custo = SCALE_BASE_USD;
  let anterior = SCALE_BASE_VOLUME;
  for (const tier of SCALE_OVERAGE_TIERS) {
    const nesteTier = Math.max(0, Math.min(restante, tier.ate - anterior));
    custo += (nesteTier / 1000) * tier.taxaPorMil;
    restante -= nesteTier;
    anterior = tier.ate;
    if (restante <= 0) break;
  }

  return {
    plano: "Scale (volume alto, múltiplos domínios)",
    custoMensalUsd: Math.round(custo * 100) / 100,
    observacao: "Estimativa com taxa de excedente por milheiro — confirme o valor exato no Resend antes de fechar.",
  };
}

export type SharedEmailEstimate = {
  plano: string;
  custoTotalMensalUsd: number; // custo da conta Resend inteira (compartilhada entre todos os clientes)
  custoClienteMensalUsd: number; // fatia proporcional desse cliente
  percentualDoVolume: number; // % do volume total que esse cliente representa
};

// A conta do Resend é UMA só, compartilhada entre todos os clientes (igual a VPS do WhatsApp) — não um plano por cliente.
// O custo desse cliente é a fatia proporcional ao volume dele dentro do volume total contratado.
// Se o volume total (de todos os clientes somados) passar do plano atual, a função já sobe pro próximo tier sozinha.
export function estimateSharedEmailCost(emailsClientePorMes: number, volumeTotalTodosClientesPorMes: number): SharedEmailEstimate {
  // O total nunca pode ser menor que o volume desse cliente sozinho.
  const volumeTotal = Math.max(emailsClientePorMes, volumeTotalTodosClientesPorMes);
  const plano = estimateEmailCost(volumeTotal);

  const percentualDoVolume = volumeTotal > 0 ? emailsClientePorMes / volumeTotal : 0;
  const custoClienteMensalUsd = plano.custoMensalUsd * percentualDoVolume;

  return {
    plano: plano.plano,
    custoTotalMensalUsd: plano.custoMensalUsd,
    custoClienteMensalUsd: Math.round(custoClienteMensalUsd * 100) / 100,
    percentualDoVolume: Math.round(percentualDoVolume * 1000) / 10, // em %, 1 casa decimal
  };
}

export type WhatsappEstimate = {
  custoTotalMensalBrl: number;
  custoPorDisparoBrl: number;
  observacao: string;
};

// Via Evolution API/Baileys (não-oficial) não existe cobrança por mensagem da Meta —
// o único custo real é a infraestrutura (VPS), ratear entre os clientes que a dividem.
export function estimateWhatsappCost(
  disparosPorMes: number,
  custoVpsMensalBrl: number,
  clientesNaVps: number
): WhatsappEstimate {
  if (disparosPorMes <= 0 || clientesNaVps <= 0) {
    return { custoTotalMensalBrl: 0, custoPorDisparoBrl: 0, observacao: "Informe o volume de disparos e quantos clientes dividem a VPS." };
  }
  const custoTotalMensalBrl = custoVpsMensalBrl / clientesNaVps;
  const custoPorDisparoBrl = custoTotalMensalBrl / disparosPorMes;
  return {
    custoTotalMensalBrl: Math.round(custoTotalMensalBrl * 100) / 100,
    custoPorDisparoBrl: Math.round(custoPorDisparoBrl * 10000) / 10000,
    observacao: "Não há cobrança por mensagem (Evolution API/Baileys, não é a API oficial paga da Meta) — é rateio da VPS entre os clientes.",
  };
}

export type RiskLevel = "baixo" | "medio" | "alto";

export type WhatsappRiskAssessment = {
  disparosPorDia: number;
  nivel: RiskLevel;
  label: string;
  explicacao: string;
};

// Faixas baseadas na mesma rampa anti-ban já validada no piloto (50→300 disparos/dia, número já aquecido).
// É uma referência prática, não uma garantia — a Meta não publica os thresholds reais de detecção.
export function assessWhatsappRisk(disparosPorMes: number): WhatsappRiskAssessment {
  const disparosPorDia = disparosPorMes / 26; // ~26 dias úteis/mês (janela seg-sáb já usada na rampa)

  if (disparosPorDia <= 100) {
    return {
      disparosPorDia: Math.round(disparosPorDia),
      nivel: "baixo",
      label: "Baixo risco",
      explicacao: "Dentro da faixa inicial da rampa (dia 1-2). Seguro pra número já aquecido, seguindo delay/janela.",
    };
  }
  if (disparosPorDia <= 300) {
    return {
      disparosPorDia: Math.round(disparosPorDia),
      nivel: "medio",
      label: "Risco médio",
      explicacao: "Topo da rampa validada no piloto. Só seguro se o número já estiver bem aquecido e a rampa/delay forem respeitados à risca.",
    };
  }
  return {
    disparosPorDia: Math.round(disparosPorDia),
    nivel: "alto",
    label: "Risco alto",
    explicacao: "Acima do que validamos como seguro via Evolution/Baileys. Nesse volume, vale considerar a API oficial (Cloud API) em vez de esticar a rampa.",
  };
}

export type ConnectorGuide = {
  nome: string;
  indicadoPara: string;
  risco: string;
  custo: string;
  implementado: boolean;
};

export const CONNECTOR_GUIDES: ConnectorGuide[] = [
  {
    nome: "Evolution API (Baileys) — não oficial",
    indicadoPara: "Número já existente que o cliente quer manter, volume baixo/médio (até ~300 disparos/dia), disparo em massa sem custo por mensagem.",
    risco: "Real — a Meta pode bloquear o número se detectar padrão de automação. Mitigado (não eliminado) pela rampa, delay e janela já implementados.",
    custo: "Sem custo por mensagem. Só a VPS (fixa, ratear entre clientes).",
    implementado: true,
  },
  {
    nome: "API Oficial (WhatsApp Cloud API) — Meta",
    indicadoPara: "Volume alto, ou cliente sem apego a manter o número atual, ou operação que não pode correr risco de bloqueio.",
    risco: "Não tem risco de bloqueio por detecção — mas tem restrição por política (nota de qualidade, templates aprovados) se usada fora das regras da Meta.",
    custo: "Cobrança por conversa (varia por tipo/país) + processo de verificação de negócio.",
    implementado: false,
  },
];
