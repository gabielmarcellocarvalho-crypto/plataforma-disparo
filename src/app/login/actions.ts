"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentIp, emailKey, hitRateLimit, ipKey, peekRateLimit, resetRateLimit, waitMessage } from "@/lib/rate-limit-db";

export type SignInState = { error: string | null };

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Preencha e-mail e senha." };
  }

  // Dois limites compartilhados entre instâncias: por IP (qualquer tentativa) e por e-mail (só as que
  // erram). O de e-mail barra o ataque que troca de IP mirando uma conta só; o de IP barra quem testa
  // muitas contas da mesma origem. A mensagem de erro segue genérica.
  const ipLimit = await hitRateLimit(ipKey("login", await currentIp()), 20, 600);
  if (!ipLimit.allowed) return { error: waitMessage(ipLimit.retryAfterSeconds) };
  const failKey = emailKey("login", email);
  const blocked = await peekRateLimit(failKey, 5);
  if (!blocked.allowed) return { error: waitMessage(blocked.retryAfterSeconds) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await hitRateLimit(failKey, 5, 900);
    return { error: "E-mail ou senha inválidos." };
  }

  await resetRateLimit(failKey);
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
