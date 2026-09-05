import { getCurrentWorkspace } from "@/lib/workspace";
import { listBranches, listTeamMembers } from "@/app/actions/team";
import { listTerritories, getCityFieldKey } from "@/app/actions/territories";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { TeamManager } from "@/components/team-manager";
import { TerritoriesManager } from "@/components/territories-manager";

// Colar o mapa de territórios de uma rede inteira são centenas de linhas num upsert só — o limite
// padrão da Vercel é curto demais e a Server Action morre no meio sem erro visível.
export const maxDuration = 120;

export default async function EquipePage() {
  const { workspace } = await getCurrentWorkspace();
  const [branches, members, territories, cityFieldKey, fieldDefs] = workspace
    ? await Promise.all([listBranches(), listTeamMembers(), listTerritories(), getCityFieldKey(), listCustomFieldDefs()])
    : [[], [], [], null, []];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Equipe</h1>
        <p className="text-text-muted text-sm mt-1">
          Filiais, pessoas e territórios de {workspace?.name}. É cadastro, não acesso — quem precisa entrar na
          plataforma continua sendo criado em Acessos.
        </p>
      </div>

      <TeamManager branches={branches} members={members} />
      <TerritoriesManager territories={territories} members={members} fieldDefs={fieldDefs} cityFieldKey={cityFieldKey} />
    </div>
  );
}
