import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiKey, readRateLimit } from "@/lib/api-auth";
import { parseLeadsQuery } from "@/lib/leads-api";
import { applyLeadFilterOps, describeFilters, leadFilterOps, parseLeadFilters } from "@/lib/leads-api-filters";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { funnelTotals, resolveQualification } from "@/lib/lead-qualification";

// Resumo do funil pra dashboard: quantos leads, MQLs, SQLs, oportunidades, clientes e perdidos, entre
// os leads que entraram no período (desde/ate). Só leitura; aceita chave completa ou só de leitura.
export async function GET(req: Request) {
  const supabase = createAdminClient();
  const authed = await authenticateApiKey(req, supabase, { write: false });
  if ("error" in authed) return authed.error;
  const { key } = authed;
  const limited = await readRateLimit(key.id);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const parsed = parseLeadsQuery(params);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const parsedFilters = parseLeadFilters(params);
  if ("error" in parsedFilters) return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  const { fromIso, toIso } = parsed.query;
  const { filters } = parsedFilters;

  const [{ data: ws }, { data: wsTags }] = await Promise.all([
    supabase.from("workspaces").select("lead_qualification").eq("id", key.workspace_id).maybeSingle(),
    filters.tags.length ? supabase.rpc("workspace_tags", { ws_id: key.workspace_id }) : Promise.resolve({ data: [] }),
  ]);
  const qualification = resolveQualification(ws?.lead_qualification);
  // Mesmos filtros da lista de leads (origem, tag, campanha, UTM...): o funil é o da fatia pedida.
  const ops = leadFilterOps(filters, qualification, ((wsTags as { tag: string }[] | null) ?? []).map((t) => t.tag));

  // Uma contagem por etapa (no banco, sem trazer linha): o teto de 1000 linhas da API não afeta.
  const counts = await Promise.all(
    STAGE_ORDER.map(async (stage) => {
      let q = supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", key.workspace_id).eq("stage", stage);
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);
      q = applyLeadFilterOps(q, ops);
      const { count, error } = await q;
      return [stage, error ? null : count ?? 0] as const;
    })
  );
  if (counts.some(([, n]) => n === null)) return NextResponse.json({ error: "Não foi possível contar os leads." }, { status: 500 });

  const byStage = Object.fromEntries(counts) as Record<ContactStage, number>;

  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  return NextResponse.json({
    periodo: { desde: params.get("desde"), ate: params.get("ate") },
    filtros: describeFilters(filters),
    totais: funnelTotals(byStage, qualification),
    por_etapa: byStage,
    regras: qualification,
  });
}
