import { createClient } from "@/lib/supabase/server";

export type TeamPerformanceRow = { memberId: string; total: number; open: number; won: number; lost: number; winRate: number | null };

const PAGE = 1000; // teto do PostgREST por requisição
const MAX_PAGES = 50;

// Taxa de ganho entre os leads que já tiveram desfecho (ganho ou perdido). Sem desfecho ainda, null.
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed > 0 ? Math.round((won / closed) * 100) : null;
}

export function aggregateTeam(rows: { team_member_id: string; stage: string }[]): Map<string, TeamPerformanceRow> {
  const out = new Map<string, TeamPerformanceRow>();
  for (const r of rows) {
    const cur = out.get(r.team_member_id) || { memberId: r.team_member_id, total: 0, open: 0, won: 0, lost: 0, winRate: null };
    cur.total++;
    if (r.stage === "concluido") cur.won++;
    else if (r.stage === "descartado") cur.lost++;
    else cur.open++;
    out.set(r.team_member_id, cur);
  }
  for (const v of out.values()) v.winRate = winRate(v.won, v.lost);
  return out;
}

// Desempenho por pessoa da equipe (leads atribuídos e desfecho), a partir do estado atual dos leads.
export async function getTeamPerformance(workspaceId: string): Promise<Map<string, TeamPerformanceRow>> {
  const supabase = await createClient();
  const rows: { team_member_id: string; stage: string }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await supabase
      .from("contacts")
      .select("team_member_id, stage")
      .eq("workspace_id", workspaceId)
      .not("team_member_id", "is", null)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const batch = (data || []) as { team_member_id: string; stage: string }[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return aggregateTeam(rows);
}
