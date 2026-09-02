import type { ContactStage } from "@/lib/crm-stages";
import type { TriggerType, WorkflowStepInput } from "@/lib/workflow-types";

// Templates prontos (item final do pedido do usuário) — pré-preenchem o builder pra não obrigar
// montar tudo do zero. Cobrem só o que o motor atual suporta de verdade (sem valor de negócio/tags,
// já que a feature de Negócios foi removida e não existe sistema de tags ainda).
export type WorkflowTemplateSeed = {
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerStage: ContactStage;
  triggerDays: number;
  audienceStage: ContactStage | "";
  stopOnReply: boolean;
  stopOnStageChange: boolean;
  respectBusinessHours: boolean;
  allowReentry: boolean;
  reentryCooldownHours: number | null;
  steps: WorkflowStepInput[];
};

export type WorkflowTemplate = {
  id: string;
  title: string;
  description: string;
  seed: WorkflowTemplateSeed;
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "stale_followup",
    title: "Follow-up de lead parado",
    description: "Lead parou numa etapa? Manda 2 mensagens de follow-up com intervalo.",
    seed: {
      name: "Follow-up de lead parado",
      description: "Segue com o lead que não avança há alguns dias.",
      triggerType: "stage_stale",
      triggerStage: "interessado",
      triggerDays: 3,
      audienceStage: "",
      stopOnReply: true,
      stopOnStageChange: true,
      respectBusinessHours: true,
      allowReentry: false,
      reentryCooldownHours: null,
      steps: [
        { step_type: "action", config: { action_type: "send_message", text: "Oi {{primeiro_nome}}, tudo bem? Vi que ainda não fechamos — posso te ajudar em algo?" } },
        { step_type: "wait", config: { amount: 2, unit: "days" } },
        { step_type: "action", config: { action_type: "send_message", text: "{{primeiro_nome}}, só passando pra saber se ainda faz sentido pra você. Qualquer dúvida, me chama!" } },
      ],
    },
  },
  {
    id: "no_reply_recovery",
    title: "Recuperação de lead sem resposta",
    description: "Mandou mensagem e o lead sumiu? Reforça e, se continuar sem resposta, avisa o vendedor.",
    seed: {
      name: "Recuperação de lead sem resposta",
      description: "",
      triggerType: "no_reply",
      triggerStage: "interessado",
      triggerDays: 2,
      audienceStage: "",
      stopOnReply: true,
      stopOnStageChange: false,
      respectBusinessHours: true,
      allowReentry: false,
      reentryCooldownHours: null,
      steps: [
        { step_type: "action", config: { action_type: "send_message", text: "Oi {{primeiro_nome}}! Ainda por aí? Fico à disposição se precisar." } },
        { step_type: "wait", config: { amount: 2, unit: "days" } },
        {
          step_type: "condition",
          config: { condition_type: "replied" },
          yesSteps: [],
          noSteps: [{ step_type: "action", config: { action_type: "create_task", title: "Ligar pra {{primeiro_nome}} — sumiu depois do follow-up" } }],
        },
      ],
    },
  },
  {
    id: "stage_enter_proposal",
    title: "Lead entrou em proposta",
    description: "Assim que o lead chega na etapa de proposta, manda uma mensagem de reforço.",
    seed: {
      name: "Lead entrou em proposta",
      description: "",
      triggerType: "stage_enter",
      triggerStage: "fechando_proposta",
      triggerDays: 1,
      audienceStage: "",
      stopOnReply: false,
      stopOnStageChange: true,
      respectBusinessHours: true,
      allowReentry: true,
      reentryCooldownHours: 24,
      steps: [
        { step_type: "wait", config: { amount: 1, unit: "hours" } },
        { step_type: "action", config: { action_type: "send_message", text: "Oi {{primeiro_nome}}! Te mandei a proposta — qualquer dúvida, só chamar por aqui." } },
      ],
    },
  },
  {
    id: "hot_lead_alert",
    title: "Avisar vendedor sobre lead quente",
    description: "Lead demonstrou interesse? Cria uma tarefa pro responsável na hora.",
    seed: {
      name: "Avisar vendedor sobre lead quente",
      description: "",
      triggerType: "stage_enter",
      triggerStage: "interessado",
      triggerDays: 1,
      audienceStage: "",
      stopOnReply: false,
      stopOnStageChange: false,
      respectBusinessHours: false,
      allowReentry: true,
      reentryCooldownHours: 24,
      steps: [{ step_type: "action", config: { action_type: "create_task", title: "Lead quente: {{primeiro_nome}} — falar o quanto antes" } }],
    },
  },
  {
    id: "reactivation",
    title: "Reativação de leads antigos",
    description: "Lead descartado há muito tempo? Manda uma mensagem pra tentar reengajar.",
    seed: {
      name: "Reativação de leads antigos",
      description: "",
      triggerType: "stage_stale",
      triggerStage: "descartado",
      triggerDays: 30,
      audienceStage: "",
      stopOnReply: true,
      stopOnStageChange: true,
      respectBusinessHours: true,
      allowReentry: true,
      reentryCooldownHours: 720,
      steps: [{ step_type: "action", config: { action_type: "send_message", text: "Oi {{primeiro_nome}}! Faz um tempo que a gente não conversa — ainda faz sentido pra você retomar?" } }],
    },
  },
];
