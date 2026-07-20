export default function MetricasPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Métricas</h1>
        <p className="text-text-muted text-sm mt-1">Funil e desempenho das campanhas do workspace atual.</p>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Sem dados ainda</p>
        <p className="text-sm mt-1">Aparece assim que a primeira campanha for disparada.</p>
      </div>
    </div>
  );
}
