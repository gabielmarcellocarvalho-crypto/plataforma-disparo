import { getCurrentWorkspace, isCurrentUserColaborador } from "@/lib/workspace";
import { getDispatchStats } from "@/lib/dispatch-stats";
import { CalculadoraForm } from "@/components/calculadora-form";

export default async function CalculadoraPage() {
  const isColaborador = await isCurrentUserColaborador();

  if (!isColaborador) {
    return (
      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Acesso restrito</p>
        <p className="text-sm mt-1">Essa área é só pra colaboradores da agência.</p>
      </div>
    );
  }

  const { workspace } = await getCurrentWorkspace();
  const stats = await getDispatchStats(workspace?.id ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Calculadora de custo</h1>
        <p className="text-text-muted text-sm mt-1">
          Estimativa de quanto {workspace?.name || "o cliente"} custa em disparo — volumes puxados automaticamente do
          histórico real de campanhas no banco. Edite os campos se quiser projetar um cenário diferente do atual, ou
          salve uma estimativa fixa pra esse cliente (útil antes dele ter disparo real rodando).
        </p>
      </div>
      <CalculadoraForm
        key={workspace?.id ?? "none"}
        workspaceId={workspace?.id ?? null}
        initialEmailsCliente={stats.emailsCliente}
        initialEmailsTotalTodosClientes={stats.emailsTotalTodosClientes}
        initialWhatsappCliente={stats.whatsappCliente}
        hasSavedEstimate={stats.hasSavedEstimate}
      />
    </div>
  );
}
