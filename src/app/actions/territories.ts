"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { normalizeCity, parseTerritoryLine, matchMemberByName } from "@/lib/territories";

export type ActionResult = { error: string | null; ok?: boolean };

export type TerritoryRow = {
  id: string;
  city: string;
  city_key: string;
  team_member_id: string | null;
  branch_id: string | null;
};

export async function listTerritories(): Promise<TerritoryRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const todos: TerritoryRow[] = [];
  let offset = 0;
  // Território é uma linha por cidade: a Luchini tem ~300, e o teto de 1000 do servidor está logo
  // ali pra quem cobrir um estado inteiro.
  for (;;) {
    const { data } = await supabase
      .from("territories")
      .select("id, city, city_key, team_member_id, branch_id")
      .eq("workspace_id", workspace.id)
      .order("city_key", { ascending: true })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    todos.push(...(data as TerritoryRow[]));
    if (data.length < 1000) break;
    offset += 1000;
  }
  return todos;
}

export async function getCityFieldKey(): Promise<string | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("city_field_key").eq("id", workspace.id).maybeSingle();
  return data?.city_field_key ?? null;
}

export async function setCityFieldKey(key: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ city_field_key: key || null }).eq("id", workspace.id);
  if (error) return { error: "Não foi possível salvar." };

  revalidatePath("/equipe");
  return { error: null, ok: true };
}

export type BulkResult = ActionResult & { salvos?: number; semVendedor?: string[] };

// Colar em massa: uma linha por cidade, no formato "Cidade = Vendedor". É como o mapa existe hoje —
// numa aba de planilha com uma coluna por vendedor — e digitar 300 cidades numa a uma não é opção.
export async function bulkSaveTerritories(texto: string): Promise<BulkResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: team } = await supabase.from("team_members").select("id, name, branch_id").eq("workspace_id", workspace.id);

  const linhas: { city: string; member: string }[] = [];
  for (const l of texto.split("\n")) {
    const p = parseTerritoryLine(l);
    if (p) linhas.push(p);
  }
  if (linhas.length === 0) return { error: 'Nenhuma linha no formato "Cidade = Vendedor".' };

  const semVendedor = new Set<string>();
  const registros: Record<string, unknown>[] = [];
  const chavesVistas = new Set<string>();

  for (const { city, member } of linhas) {
    const alvo = matchMemberByName(member, team ?? []);
    if (!alvo) {
      semVendedor.add(member);
      continue;
    }
    const key = normalizeCity(city);
    if (!key || chavesVistas.has(key)) continue; // cidade repetida na colagem: fica a primeira
    chavesVistas.add(key);
    registros.push({
      workspace_id: workspace.id,
      city: city.trim(),
      city_key: key,
      team_member_id: alvo.id,
      branch_id: alvo.branch_id ?? null,
    });
  }

  if (registros.length === 0) {
    return { error: "Nenhuma linha casou com alguém da equipe.", semVendedor: [...semVendedor].slice(0, 20) };
  }

  // Recolar o mapa inteiro é o caso normal (a planilha de território é reeditada e colada de novo),
  // então cidade repetida atualiza em vez de dar erro de chave única.
  let salvos = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const { error, count } = await supabase
      .from("territories")
      .upsert(registros.slice(i, i + 500), { onConflict: "workspace_id,city_key", count: "exact" });
    if (error) return { error: `Não foi possível salvar: ${error.message}` };
    salvos += count ?? 0;
  }

  revalidatePath("/equipe");
  return { error: null, ok: true, salvos, semVendedor: [...semVendedor].slice(0, 20) };
}

export async function deleteTerritory(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("territories").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível remover." };

  revalidatePath("/equipe");
  return { error: null, ok: true };
}

export async function clearTerritories(): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("territories").delete().eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível limpar o mapa." };

  revalidatePath("/equipe");
  return { error: null, ok: true };
}

export type ApplyResult = ActionResult & { atribuidos?: number; semTerritorio?: number; jaTinham?: number };

// Aplica o mapa aos leads que JÁ existem. Só mexe em quem está sem responsável — reatribuir um lead
// que alguém pegou na mão seria arrancar o atendimento de quem já está falando com o cliente.
export async function applyRoutingToExistingLeads(): Promise<ApplyResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: ws } = await supabase.from("workspaces").select("city_field_key").eq("id", workspace.id).maybeSingle();
  const cityKey = ws?.city_field_key;
  if (!cityKey) return { error: "Escolha antes qual campo do lead guarda a cidade." };

  const territorios = await listTerritories();
  if (territorios.length === 0) return { error: "O mapa de territórios está vazio." };
  const porCidade = new Map(territorios.map((t) => [t.city_key, t]));

  const semDono: { id: string; custom_fields: Record<string, unknown> | null }[] = [];
  let offset = 0;
  for (;;) {
    const { data } = await supabase
      .from("contacts")
      .select("id, custom_fields")
      .eq("workspace_id", workspace.id)
      .is("team_member_id", null)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    semDono.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  let atribuidos = 0;
  let semTerritorio = 0;
  // Agrupa por destino: um UPDATE por vendedor em vez de um por lead. Com centenas de leads, uma
  // chamada por linha levaria a Server Action pro limite de tempo da Vercel.
  const porDestino = new Map<string, { teamMemberId: string; branchId: string | null; ids: string[] }>();

  for (const c of semDono) {
    const valor = (c.custom_fields ?? {})[cityKey];
    if (!valor) continue;
    const t = porCidade.get(normalizeCity(String(valor)));
    if (!t || !t.team_member_id) {
      semTerritorio++;
      continue;
    }
    const chave = `${t.team_member_id}|${t.branch_id ?? ""}`;
    if (!porDestino.has(chave)) porDestino.set(chave, { teamMemberId: t.team_member_id, branchId: t.branch_id, ids: [] });
    porDestino.get(chave)!.ids.push(c.id);
    atribuidos++;
  }

  for (const { teamMemberId, branchId, ids } of porDestino.values()) {
    // Nunca mandar a lista inteira num `.in()` só: com algumas centenas de ids a URL do PostgREST
    // estoura o limite do servidor e a chamada falha calada.
    for (let i = 0; i < ids.length; i += 100) {
      const patch: Record<string, unknown> = { team_member_id: teamMemberId };
      if (branchId) patch.branch_id = branchId;
      const { error } = await supabase.from("contacts").update(patch).eq("workspace_id", workspace.id).in("id", ids.slice(i, i + 100));
      if (error) return { error: `Falhou no meio: ${error.message}` };
    }
  }

  for (const path of ["/crm", "/contatos", "/metricas", "/equipe"]) revalidatePath(path);
  return { error: null, ok: true, atribuidos, semTerritorio, jaTinham: 0 };
}
