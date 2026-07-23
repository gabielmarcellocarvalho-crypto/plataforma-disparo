import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { estimateAnthropicCostUsd } from "@/lib/pricing-calculator";
import { AgentEditView } from "@/components/agent-edit-view";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export default async function AgentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { isColaborador } = await getCurrentWorkspace();
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select(
      "id, name, system_prompt, config, evolution_instance_name, phone_number, photo_url, connection_status, status, reply_delay_min_seconds, reply_delay_max_seconds"
    )
    .eq("id", id)
    .maybeSingle();
  if (!agent) notFound();

  const [{ data: usageRows }, { data: mediaRows }, { data: knowledgeRows }] = await Promise.all([
    supabase
      .from("messages")
      .select("input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
      .eq("agent_id", agent.id),
    supabase
      .from("agent_media")
      .select("id, category, url, caption, media_type, file_name")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("agent_knowledge")
      .select("id, file_name, char_count")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: true }),
  ]);

  const totalCostUsd = (usageRows || []).reduce(
    (sum, row) =>
      sum +
      estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
        cacheReadInputTokens: row.cache_read_input_tokens || 0,
      }),
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <Link href="/agentes" className="text-sm font-semibold text-text-muted hover:text-text w-fit flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Agentes
      </Link>
      <AgentEditView
        agent={agent}
        model={ANTHROPIC_MODEL}
        totalCostUsd={totalCostUsd}
        media={mediaRows || []}
        knowledge={knowledgeRows || []}
        canManage={isColaborador}
      />
    </div>
  );
}
