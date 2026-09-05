// Funis personalizados — a camada de vocabulário e ordenação por cima dos 7 sinais internos.
//
// Ler junto com crm-stages.ts. Resumindo a divisão:
//   contacts.stage        → o SINAL (7 valores fixos). É o que o agente classifica, o que as
//                           métricas somam e o que os workflows filtram. Nunca muda de vocabulário.
//   pipeline_stage_id     → onde o card aparece no funil DAQUELE cliente. Só apresentação e ordem.
//
// Um lead vive em um funil por vez. Trocar de funil é mover, não duplicar.
import { STAGE_ORDER, STAGE_LABELS, type ContactStage } from "@/lib/crm-stages";

export type Pipeline = { id: string; name: string; position: number; is_default: boolean };

export type PipelineStage = {
  id: string;
  pipeline_id: string;
  name: string;
  signal: ContactStage;
  position: number;
};

// Ajuda a montar a lista de sinais na tela de configuração do funil, em linguagem de quem vende e
// não de quem programa.
export const SIGNAL_OPTIONS: { key: ContactStage; label: string; hint: string }[] = [
  { key: "nao_abordado", label: "Chegou", hint: "lead entrou e ninguém falou com ele ainda" },
  { key: "abordado", label: "Em contato", hint: "a conversa começou" },
  { key: "interessado", label: "Demonstrou interesse", hint: "quer saber mais, é público certo" },
  { key: "encaminhamento", label: "Passou pro time", hint: "saiu do automático e virou trabalho humano" },
  { key: "fechando_proposta", label: "Em proposta", hint: "já viu preço ou condição" },
  { key: "concluido", label: "Ganho", hint: "fechou — conta como conversão" },
  { key: "descartado", label: "Perda", hint: "não vai fechar — pede motivo, se configurado" },
];

export function signalLabel(signal: ContactStage): string {
  return SIGNAL_OPTIONS.find((s) => s.key === signal)?.label ?? STAGE_LABELS[signal];
}

// Modelo inicial de um funil novo: as 4 âncoras que qualquer operação comercial tem. Sai enxuto de
// propósito — é mais fácil acrescentar a etapa que falta do que apagar cinco que não se usa.
export function defaultStageDraft(): { name: string; signal: ContactStage }[] {
  return [
    { name: "Não abordado", signal: "nao_abordado" },
    { name: "Em contato", signal: "abordado" },
    { name: "Ganho", signal: "concluido" },
    { name: "Perda", signal: "descartado" },
  ];
}

// Um funil só serve se der pra chegar ao fim: sem etapa de ganho e de perda, lead nenhum sai do
// meio, o relatório de conversão não fecha e o motivo de perda nunca é pedido.
export function validateStages(etapas: { name: string; signal: ContactStage }[]): string | null {
  const limpas = etapas.filter((e) => e.name.trim());
  if (limpas.length < 2) return "Um funil precisa de pelo menos duas etapas.";
  if (!limpas.some((e) => e.signal === "concluido")) return "Falta uma etapa de ganho (o que conta como fechado).";
  if (!limpas.some((e) => e.signal === "descartado")) return "Falta uma etapa de perda (onde o lead que não fecha para).";
  return null;
}

// Traduz o sinal que o agente emitiu para a etapa correspondente do funil onde o lead está.
//
// Pode haver mais de uma etapa com o mesmo sinal (um funil com "Proposta enviada" e "Proposta em
// negociação", ambas "Em proposta"): nesse caso vale a PRIMEIRA na ordem do funil, que é a entrada
// natural daquele bloco — o agente diz "chegou em proposta", não em qual sub-etapa.
//
// Sinal sem etapa nenhuma (o cliente não modelou "interesse", por exemplo) cai na etapa anterior mais
// próxima que exista, seguindo a ordem canônica — mesma regra do displayStageFor no modo sem funil,
// e nunca joga o lead pra frente do que ele realmente é.
export function stageForSignal(signal: ContactStage, stages: PipelineStage[]): PipelineStage | null {
  if (stages.length === 0) return null;
  const ordenadas = [...stages].sort((a, b) => a.position - b.position);

  const direta = ordenadas.find((s) => s.signal === signal);
  if (direta) return direta;

  const idx = STAGE_ORDER.indexOf(signal);
  for (let i = idx - 1; i >= 0; i--) {
    const anterior = ordenadas.find((s) => s.signal === STAGE_ORDER[i]);
    if (anterior) return anterior;
  }
  return ordenadas[0];
}

// Ordena as etapas pela posição declarada. A ordem do funil é a do cliente, não a ordem canônica dos
// sinais — ele pode ter "Perda" no meio do board se for assim que a equipe trabalha.
export function sortStages(stages: PipelineStage[]): PipelineStage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}
