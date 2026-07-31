"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function siteUrl(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || ""}`;
}

// Redireciona pro fluxo OAuth do Google via Supabase Auth. Só funciona depois que o provider
// Google estiver habilitado no painel do Supabase (Authentication → Providers) com Client ID/Secret
// de um app OAuth criado no Google Cloud Console — sem isso, o Supabase recusa a chamada.
export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?erro=google");
  redirect(data.url);
}

export type ForgotPasswordState = { error: string | null; sent?: boolean };

// Sempre responde com sucesso genérico (mesmo se o e-mail não existir) — não dá pra um visitante
// descobrir quais e-mails têm conta só tentando recuperar senha.
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { error: "Informe o e-mail." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/redefinir-senha`,
  });

  return { error: null, sent: true };
}

export type UpdatePasswordState = { error: string | null };

export async function updatePassword(_prev: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < 6) return { error: "A senha precisa de pelo menos 6 caracteres." };
  if (password !== confirm) return { error: "As senhas não são iguais." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível trocar a senha. Peça um novo link de redefinição." };

  redirect("/");
}
