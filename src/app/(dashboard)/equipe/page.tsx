import { getCurrentWorkspace } from "@/lib/workspace";
import { listBranches, listTeamMembers } from "@/app/actions/team";
import { TeamManager } from "@/components/team-manager";

export default async function EquipePage() {
  const { workspace } = await getCurrentWorkspace();
  const [branches, members] = workspace ? await Promise.all([listBranches(), listTeamMembers()]) : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Equipe</h1>
        <p className="text-text-muted text-sm mt-1">
          Filiais e pessoas de {workspace?.name} que podem ficar responsáveis por um lead. É cadastro, não acesso —
          quem precisa entrar na plataforma continua sendo criado em Acessos.
        </p>
      </div>

      <TeamManager branches={branches} members={members} />
    </div>
  );
}
