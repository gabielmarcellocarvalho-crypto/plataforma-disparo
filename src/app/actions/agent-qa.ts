"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";

export type QaResult = { error: string | null };

const MAX_QUESTION = 500;
const MAX_ANSWER = 2000;

async function ctx() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, workspaceId: workspace.id, userId: data.user?.id ?? null };
}

function done(error: string | null): QaResult {
  if (!error) revalidatePath("/agentes");
  return { error };
}

// A equipe responde uma dúvida que o agente abriu: a resposta vira memória dele.
export async function answerQuestion(id: string, answer: string): Promise<QaResult> {
  const c = await ctx();
  if (!c) return { error: "Nenhum workspace ativo." };
  const text = answer.trim().slice(0, MAX_ANSWER);
  if (!text) return { error: "Escreva a resposta." };
  const { error } = await c.supabase
    .from("agent_qa")
    .update({ answer: text, status: "respondida", answered_at: new Date().toISOString(), answered_by: c.userId })
    .eq("id", id)
    .eq("workspace_id", c.workspaceId);
  return done(error ? "Não foi possível salvar a resposta." : null);
}

export async function discardQuestion(id: string): Promise<QaResult> {
  const c = await ctx();
  if (!c) return { error: "Nenhum workspace ativo." };
  const { error } = await c.supabase.from("agent_qa").update({ status: "descartada" }).eq("id", id).eq("workspace_id", c.workspaceId);
  return done(error ? "Não foi possível descartar." : null);
}

// Pergunta frequente cadastrada pela equipe: já nasce respondida.
export async function addFaq(agentId: string, question: string, answer: string): Promise<QaResult> {
  const c = await ctx();
  if (!c) return { error: "Nenhum workspace ativo." };
  const q = question.trim().slice(0, MAX_QUESTION);
  const a = answer.trim().slice(0, MAX_ANSWER);
  if (!q || !a) return { error: "Preencha a pergunta e a resposta." };
  const { data: agent } = await c.supabase.from("agents").select("id").eq("id", agentId).eq("workspace_id", c.workspaceId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };
  const { error } = await c.supabase.from("agent_qa").insert({
    workspace_id: c.workspaceId,
    agent_id: agentId,
    question: q,
    answer: a,
    status: "respondida",
    source: "manual",
    answered_at: new Date().toISOString(),
    answered_by: c.userId,
  });
  return done(error ? "Não foi possível adicionar." : null);
}

export async function updateQa(id: string, question: string, answer: string): Promise<QaResult> {
  const c = await ctx();
  if (!c) return { error: "Nenhum workspace ativo." };
  const q = question.trim().slice(0, MAX_QUESTION);
  const a = answer.trim().slice(0, MAX_ANSWER);
  if (!q || !a) return { error: "Preencha a pergunta e a resposta." };
  const { error } = await c.supabase.from("agent_qa").update({ question: q, answer: a }).eq("id", id).eq("workspace_id", c.workspaceId);
  return done(error ? "Não foi possível salvar." : null);
}

export async function deleteQa(id: string): Promise<QaResult> {
  const c = await ctx();
  if (!c) return { error: "Nenhum workspace ativo." };
  const { error } = await c.supabase.from("agent_qa").delete().eq("id", id).eq("workspace_id", c.workspaceId);
  return done(error ? "Não foi possível excluir." : null);
}
