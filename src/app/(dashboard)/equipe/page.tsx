import { getCurrentWorkspace } from "@/lib/workspace";
import { listBranches, listTeamMembers } from "@/app/actions/team";
import { listTerritories, getCityFieldKey } from "@/app/actions/territories";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { TeamManager } from "@/components/team-manager";
import { TerritoriesManager } from "@/components/territories-manager";
import { getTeamPerformance } from "@/lib/team-performance";

// Colar o mapa de territórios de uma rede inteira são centenas de linhas num upsert só — o limite
// padrão da Vercel é curto demais e a Server Action morre no meio sem erro visível.
export const maxDuration = 120;

export default async function EquipePage() {
  const { workspace } = await getCurrentWorkspace();
  const [branches, members, territories, cityFieldKey, fieldDefs] = workspace
    ? await Promise.all([listBranches(), listTeamMembers(), listTerritories(), getCityFieldKey(), listCustomFieldDefs()])
    : [[], [], [], null, []];
  const performance = workspace ? await getTeamPerformance(workspace.id) : new Map();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const ranked = members
    .filter((m) => m.active)
    .map((m) => ({ member: m, perf: performance.get(m.id) }))
    .sort((a, b) => (b.perf?.won ?? 0) - (a.perf?.won ?? 0) || (b.perf?.total ?? 0) - (a.perf?.total ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Equipe</h1>
        <p className="text-text-muted text-sm mt-1">
          Filiais, pessoas e territórios de {workspace?.name}. É cadastro, não acesso — quem precisa entrar na
          plataforma continua sendo criado em Acessos.
        </p>
      </div>

      {ranked.length > 0 && (
        <section className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <h2 className="font-bold text-[15px] mb-1">Desempenho da equipe</h2>
          <p className="text-xs text-text-muted mb-4">Leads atribuídos a cada pessoa e como estão agora. Ordenado por ganhos.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Pessoa</th>
                  <th className="px-3 py-2">Filial</th>
                  <th className="px-3 py-2 text-right">Leads</th>
                  <th className="px-3 py-2 text-right">Em aberto</th>
                  <th className="px-3 py-2 text-right">Ganhos</th>
                  <th className="px-3 py-2 text-right">Perdidos</th>
                  <th className="px-3 py-2 text-right">Taxa de ganho</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ member, perf }, i) => (
                  <tr key={member.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 text-text-muted tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold">
                      {member.name}
                      {member.role && <span className="block text-[11px] font-normal text-text-muted">{member.role}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted">{(member.branch_id && branchName.get(member.branch_id)) || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{perf?.total ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{perf?.open ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-success">{perf?.won ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-danger">{perf?.lost ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold">{perf?.winRate == null ? "—" : `${perf.winRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TeamManager branches={branches} members={members} />
      <TerritoriesManager territories={territories} members={members} fieldDefs={fieldDefs} cityFieldKey={cityFieldKey} />
    </div>
  );
}
