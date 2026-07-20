const STAT_CARDS = [
  { label: "contatos", value: "—" },
  { label: "campanhas ativas", value: "—" },
  { label: "mensagens enviadas hoje", value: "—" },
  { label: "workspaces", value: "—" },
];

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Visão geral</h1>
        <p className="text-text-muted text-sm mt-1">
          Painel ainda sem dados reais — conectar ao Supabase é o próximo passo.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map((c) => (
          <div key={c.label} className="bg-surface border border-border rounded-lg p-4 shadow-sm">
            <b className="block text-2xl tracking-tight">{c.value}</b>
            <span className="text-xs font-semibold text-text-muted">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
        <h3 className="font-bold text-[15px] mb-2">Próximos passos</h3>
        <ul className="text-sm text-text-muted list-disc pl-5 space-y-1">
          <li>Criar o projeto no Supabase (plano gratuito) e configurar as variáveis de ambiente.</li>
          <li>Rodar as migrations de banco (workspaces, contatos, campanhas).</li>
          <li>Ligar o login (Supabase Auth) e o seletor de workspace.</li>
        </ul>
      </div>
    </div>
  );
}
