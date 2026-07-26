// Configuração estruturada do agente (formulário) → gera o system_prompt enxuto que vai pra
// Anthropic. Evita prompt gigante escrito à mão; o operador preenche campos, isso vira texto —
// mas o texto final continua editável (o gerado é só um ponto de partida).
import { STATUS_TAG_TO_STAGE } from "@/lib/crm-stages";

export type DayKey = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
export const DAY_KEYS: DayKey[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
export const DAY_LABELS: Record<DayKey, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

export type DayHours = { enabled: boolean; open: string; close: string };
export type WeekHours = Record<DayKey, DayHours>;

export function emptyWeekHours(): WeekHours {
  return DAY_KEYS.reduce((acc, day) => {
    acc[day] = { enabled: false, open: "08:00", close: "18:00" };
    return acc;
  }, {} as WeekHours);
}

export type CollectFieldMode = "discreto" | "perguntar";
export type CollectField = { key: string; label: string; mode: CollectFieldMode };

export type AgentMode = "" | "recepcionista" | "sdr" | "closer";

export type AgentConfig = {
  // Objetivo do agente na conversa (Recepcionista/SDR/Closer). "Ativo vs passivo" (quem inicia) é
  // resolvido pelas campanhas, não aqui — um agente "ativo" é uma campanha modo-agente com um desses objetivos.
  mode: AgentMode;
  companyName: string;
  businessType: string;
  tone: "" | "formal" | "humanizado";
  address: string;
  hours: WeekHours;
  handoffBehavior: string;
  collectFields: CollectField[];
  mediaFolderNotes: Record<string, string>;
  // Máximo de bolhas por resposta. A partir de 01/10/2026 a Meta cobra por mensagem enviada, então
  // cada bolha extra é uma cobrança de serviço a mais — 1 = uma mensagem só (sem quebrar).
  maxBubbles: number;
};

export type AgentModeDef = {
  key: Exclude<AgentMode, "">;
  label: string;
  short: string; // descrição de uma linha pra UI
  objective: string; // bloco injetado no prompt (objetivo + onde parar)
  defaultHandoff: string;
  defaultCollectFields: CollectField[];
};

// Modos = escopo do agente tratado como produto (mesmo motor, objetivo diferente), pra implantação
// não virar projeto sob medida a cada cliente. Cada modo define o objetivo, onde a conversa termina,
// e defaults sensatos (editáveis) de dados a coletar e de encaminhamento humano.
export const AGENT_MODES: AgentModeDef[] = [
  {
    key: "recepcionista",
    label: "Recepcionista",
    short: "Acolhe, tira dúvidas e separa curioso de comprador. Passa pro vendedor com o que entendeu.",
    objective:
      "Seu objetivo é recepcionar: acolher quem chega, responder dúvidas e separar curioso de quem tem intenção real. " +
      "Você NÃO negocia preço nem fecha venda. Quando o lead demonstrar intenção real de comprar ou avançar, conduza a " +
      "conversa normalmente e sinalize internamente pra um vendedor humano assumir.",
    defaultHandoff: "quando o lead demonstrar intenção real de compra ou pedir falar com um vendedor.",
    defaultCollectFields: [
      { key: "nome", label: "nome do cliente", mode: "discreto" },
      { key: "telefone", label: "telefone de contato", mode: "discreto" },
    ],
  },
  {
    key: "sdr",
    label: "SDR",
    short: "Qualifica, quebra a objeção inicial e leva pro próximo passo (agendar com o time).",
    objective:
      "Seu objetivo é qualificar o lead: entender a necessidade, o momento e o orçamento, quebrar a objeção inicial e " +
      "levar pra um próximo passo (agendar uma conversa/reunião com o time). Você NÃO apresenta preço final nem fecha a venda. " +
      "Quando o lead estiver qualificado e quente, conduza pro agendamento e sinalize internamente pra um humano assumir.",
    defaultHandoff: "quando o lead estiver qualificado e quente (pronto pra agendar ou falar com um vendedor).",
    defaultCollectFields: [
      { key: "nome", label: "nome do cliente", mode: "discreto" },
      { key: "telefone", label: "telefone de contato", mode: "discreto" },
      { key: "interesse", label: "o que o cliente procura", mode: "discreto" },
      { key: "orcamento", label: "faixa de orçamento / momento de compra", mode: "perguntar" },
    ],
  },
  {
    key: "closer",
    label: "Closer",
    short: "Apresenta preço na faixa autorizada, negocia e conduz ao fechamento.",
    objective:
      "Seu objetivo é conduzir até a venda: apresentar preço e condições dentro da faixa autorizada, contornar objeções e " +
      "levar o cliente ao fechamento. Se o cliente pedir desconto fora da faixa autorizada, ou quando chegar a hora de gerar " +
      "o pagamento/finalizar, conduza normalmente e sinalize internamente pra um humano assumir esse passo.",
    defaultHandoff: "quando o cliente pedir desconto fora da faixa autorizada ou estiver pronto pra pagar/fechar.",
    defaultCollectFields: [
      { key: "nome", label: "nome do cliente", mode: "discreto" },
      { key: "telefone", label: "telefone de contato", mode: "discreto" },
      { key: "produto", label: "produto/pacote de interesse", mode: "discreto" },
    ],
  },
];

export function getAgentMode(key: string): AgentModeDef | undefined {
  return AGENT_MODES.find((m) => m.key === key);
}

export const MAX_BUBBLES_DEFAULT = 3;
export const MAX_BUBBLES_CAP = 4;

export const EMPTY_AGENT_CONFIG: AgentConfig = {
  mode: "",
  companyName: "",
  businessType: "",
  tone: "",
  address: "",
  hours: emptyWeekHours(),
  handoffBehavior: "",
  collectFields: [],
  mediaFolderNotes: {},
  maxBubbles: MAX_BUBBLES_DEFAULT,
};

function normalizeWeekHours(raw: unknown): WeekHours {
  const base = emptyWeekHours();
  if (raw && typeof raw === "object") {
    for (const day of DAY_KEYS) {
      const d = (raw as Record<string, unknown>)[day];
      if (d && typeof d === "object") {
        const dd = d as Partial<DayHours>;
        base[day] = {
          enabled: Boolean(dd.enabled),
          open: typeof dd.open === "string" ? dd.open : base[day].open,
          close: typeof dd.close === "string" ? dd.close : base[day].close,
        };
      }
    }
  }
  return base;
}

// Tolerante a config antiga/parcial vinda do banco (jsonb '{}', formato anterior com hours em
// texto livre, ou colunas faltando).
export function normalizeAgentConfig(raw: unknown): AgentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // "informal" era o nome antigo de "humanizado" — mantém compatibilidade com agente já salvo assim.
  const tone = r.tone === "formal" || r.tone === "humanizado" ? r.tone : r.tone === "informal" ? "humanizado" : "";
  const mode = getAgentMode(String(r.mode)) ? (r.mode as AgentMode) : "";
  return {
    mode,
    companyName: typeof r.companyName === "string" ? r.companyName : "",
    businessType: typeof r.businessType === "string" ? r.businessType : "",
    tone,
    address: typeof r.address === "string" ? r.address : "",
    hours: normalizeWeekHours(r.hours),
    handoffBehavior: typeof r.handoffBehavior === "string" ? r.handoffBehavior : "",
    collectFields: Array.isArray(r.collectFields)
      ? (r.collectFields as unknown[])
          .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as Record<string, unknown>).key === "string")
          .map((f) => ({
            key: String(f.key),
            label: typeof f.label === "string" ? f.label : String(f.key),
            mode: f.mode === "perguntar" ? "perguntar" : ("discreto" as CollectFieldMode),
          }))
      : [],
    mediaFolderNotes:
      r.mediaFolderNotes && typeof r.mediaFolderNotes === "object" ? (r.mediaFolderNotes as Record<string, string>) : {},
    // Agente antigo sem esse campo cai no padrão 3 (mantém o comportamento que já tinha).
    maxBubbles: clampBubbles(r.maxBubbles),
  };
}

function clampBubbles(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : MAX_BUBBLES_DEFAULT;
  if (!Number.isFinite(n)) return MAX_BUBBLES_DEFAULT;
  return Math.min(MAX_BUBBLES_CAP, Math.max(1, n));
}

// Agrupa dias consecutivos com o mesmo horário (ex: "Segunda a sábado: 08:00–20:00. Domingo: fechado.").
export function formatWeekHours(hours: WeekHours): string {
  const groups: { start: DayKey; end: DayKey; open: string; close: string; enabled: boolean }[] = [];
  for (const day of DAY_KEYS) {
    const h = hours[day];
    const last = groups[groups.length - 1];
    if (last && last.enabled === h.enabled && last.open === h.open && last.close === h.close) {
      last.end = day;
    } else {
      groups.push({ start: day, end: day, open: h.open, close: h.close, enabled: h.enabled });
    }
  }
  if (groups.every((g) => !g.enabled)) return "";
  return groups
    .map((g) => {
      const range = g.start === g.end ? DAY_LABELS[g.start] : `${DAY_LABELS[g.start]} a ${DAY_LABELS[g.end]}`;
      return g.enabled ? `${range}: ${g.open}–${g.close}` : `${range}: fechado`;
    })
    .join(". ");
}

export function buildSystemPrompt(config: AgentConfig): string {
  const lines: string[] = [];

  const empresa = config.companyName || "a empresa";
  const negocio = config.businessType ? `, ${config.businessType}` : "";
  lines.push(
    `Você é o atendente virtual de ${empresa}${negocio}. Atende clientes pelo WhatsApp em português, de forma natural, ` +
      "objetiva e humana — nunca revele que é uma IA a menos que perguntem diretamente."
  );

  const modeDef = getAgentMode(config.mode);
  if (modeDef) lines.push(modeDef.objective);

  lines.push(
    "Regras de formatação (o WhatsApp não renderiza markdown, então isso quebra a mensagem pro cliente): nunca use " +
      "negrito, itálico, títulos, listas com traço ou emoji como marcador. Escreva texto corrido, como alguém digitando " +
      "de verdade. Nunca use travessão (—) — nenhum humano digita travessão no WhatsApp; troque por vírgula, ponto, ou " +
      "reformule a frase."
  );
  if (config.maxBubbles <= 1) {
    lines.push(
      "Seja direto e vá ao ponto — sem repetir o que o cliente já disse, sem enrolar antes de responder, sem gastar frase " +
        "à toa. Responda sempre em uma única mensagem, curta e objetiva; nunca quebre a resposta em várias mensagens."
    );
  } else {
    lines.push(
      "Seja direto e vá ao ponto — sem repetir o que o cliente já disse, sem enrolar antes de responder, sem gastar frase " +
        `à toa. Se a resposta tiver mais de uma ideia (por exemplo, uma pergunta e depois uma explicação), quebre em até ${config.maxBubbles} ` +
        "mensagens curtas usando a marca [[NOVA_MSG]] entre elas, ao invés de mandar tudo numa mensagem só enorme com parágrafos — " +
        "igual uma pessoa real manda várias bolhas seguidas no WhatsApp. Quebre só quando fizer sentido; se uma mensagem curta já resolve, mande uma só."
    );
  }

  if (config.tone === "formal") {
    lines.push(
      'Tom de voz: formal e profissional. Você age claramente como um atendente representando a empresa — linguagem ' +
        'cuidada, cortês, sem gírias, sem emojis. Trate o cliente por "senhor(a)".'
    );
  } else if (config.tone === "humanizado") {
    lines.push(
      "Tom de voz: humanizado — responda exatamente como uma pessoa de verdade trocando mensagem no WhatsApp, nunca " +
        "como um atendente ou robô. Frases curtas, jeito de escrever do dia a dia (pode abreviar, começar frase com " +
        "minúscula, ser direto), sem soar automático ou institucional. Nunca use emojis. Trate o cliente por \"você\"."
    );
  }

  if (config.address) lines.push(`Endereço: ${config.address}.`);

  const horario = formatWeekHours(config.hours);
  if (horario) lines.push(`Horário de atendimento: ${horario}.`);

  if (config.handoffBehavior) {
    lines.push(
      `Encaminhamento para humano: ${config.handoffBehavior} Quando isso acontecer, NUNCA diga ao cliente que vai chamar ` +
        'alguém, passar pra equipe, transferir a conversa ou que "alguém vai te responder" — isso quebra a naturalidade ' +
        "da conversa. Continue respondendo normalmente, com uma resposta apropriada, como se você mesmo estivesse " +
        "cuidando do assunto. Só adicione ao final da resposta (nunca visível pro cliente) a tag [[PRECISA_HUMANO]], " +
        "que sinaliza a equipe internamente."
    );
  }

  const discretos = config.collectFields.filter((f) => f.mode === "discreto");
  const perguntar = config.collectFields.filter((f) => f.mode === "perguntar");
  if (discretos.length) {
    lines.push(
      "Anote discretamente, sem perguntar diretamente — só quando o cliente mencionar naturalmente na conversa: " +
        `${discretos.map((f) => `${f.key} (${f.label})`).join(", ")}.`
    );
  }
  if (perguntar.length) {
    lines.push(`Pergunte diretamente quando for necessário pra atender: ${perguntar.map((f) => `${f.key} (${f.label})`).join(", ")}.`);
  }
  if (config.collectFields.length) {
    const chaves = config.collectFields.map((f) => f.key).join(", ");
    lines.push(
      "Toda vez que descobrir ou atualizar uma dessas informações, adicione ao final da resposta (o cliente nunca vê isso) " +
        `uma tag [[DADOS: chave=valor; chave2=valor2]], usando exatamente estas chaves: ${chaves}. ` +
        "Só inclua a tag quando tiver uma informação nova pra registrar."
    );
  }

  const statusVocab = Object.keys(STATUS_TAG_TO_STAGE).filter((w) => w !== "fechando_proposta").join(", ");
  lines.push(
    "Classificação do funil (uso interno, essencial): ao final de TODA resposta, depois de qualquer outra tag, adicione " +
      `[[STATUS: <palavra>]] usando exatamente uma destas palavras: ${statusVocab}. Use "abordado" enquanto ainda está ` +
      'entendendo a necessidade, "interessado" quando o cliente demonstrar interesse real, "encaminhamento" quando estiver ' +
      'perto de fechar ou precisar de humano, "proposta" quando já enviou valores/condições, "concluido" quando fechou ou ' +
      'confirmou o que precisava, "descartado" quando o cliente claramente não é o público ou desistiu. Nunca deixe de ' +
      "incluir essa tag; ela nunca aparece pro cliente."
  );

  lines.push(
    "Nunca invente informação que você não tem certeza. Se não souber responder algo, seja honesto e ofereça encaminhar pra um humano."
  );

  return lines.join("\n");
}
