import { AuthShell } from "@/components/auth-shell";

// Tela final pra quem conectou pelo link (sem login). Quem conectou pelo painel volta pra /integracoes.
const RESULTS: Record<string, { title: string; subtitle: string; body: string }> = {
  ok: {
    title: "Agenda conectada",
    subtitle: "Tudo certo por aqui",
    body: "Pode fechar esta página. Lembre de criar eventos \"Marque aqui\" nos horários em que você atende.",
  },
  cancelado: {
    title: "Conexão cancelada",
    subtitle: "Nada foi alterado",
    body: "Se quiser conectar depois, é só abrir o link de novo.",
  },
  "sem-permissao": {
    title: "Faltou a permissão da agenda",
    subtitle: "A conexão não foi concluída",
    body: "Na tela do Google, marque a opção de acesso ao Google Agenda. Abra o link de novo pra tentar.",
  },
  "link-invalido": {
    title: "Link expirado",
    subtitle: "Esse link de conexão não vale mais",
    body: "Peça pra quem te enviou gerar um novo em Integrações.",
  },
  erro: {
    title: "Não deu certo",
    subtitle: "Algo falhou ao conectar",
    body: "Tente abrir o link de novo em alguns minutos.",
  },
};

export default async function ConnectResultPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const r = RESULTS[status || ""] ?? RESULTS.erro;
  return (
    <AuthShell title={r.title} subtitle={r.subtitle}>
      <p className="text-sm text-text-muted leading-relaxed">{r.body}</p>
    </AuthShell>
  );
}
