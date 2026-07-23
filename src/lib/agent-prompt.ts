// Configuração estruturada do agente (formulário) → gera o system_prompt enxuto que vai pra
// Anthropic. Evita prompt gigante escrito à mão; o operador preenche campos, isso vira texto —
// mas o texto final continua editável (o gerado é só um ponto de partida).

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

export type AgentConfig = {
  companyName: string;
  businessType: string;
  tone: "" | "formal" | "informal";
  address: string;
  hours: WeekHours;
  handoffBehavior: string;
  collectFields: CollectField[];
  mediaFolderNotes: Record<string, string>;
};

export const EMPTY_AGENT_CONFIG: AgentConfig = {
  companyName: "",
  businessType: "",
  tone: "",
  address: "",
  hours: emptyWeekHours(),
  handoffBehavior: "",
  collectFields: [],
  mediaFolderNotes: {},
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
  const tone = r.tone === "formal" || r.tone === "informal" ? r.tone : "";
  return {
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
  };
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

  if (config.tone === "formal") {
    lines.push(
      'Tom de voz: formal e profissional. Você age claramente como um atendente representando a empresa — linguagem ' +
        'cuidada, cortês, sem gírias. Trate o cliente por "senhor(a)".'
    );
  } else if (config.tone === "informal") {
    lines.push(
      "Tom de voz: bem informal — responda exatamente como uma pessoa de verdade trocando mensagem no WhatsApp, nunca " +
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

  lines.push(
    "Nunca invente informação que você não tem certeza. Se não souber responder algo, seja honesto e ofereça encaminhar pra um humano."
  );

  return lines.join("\n");
}
