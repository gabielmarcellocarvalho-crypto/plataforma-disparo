import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com a service_role key — ignora RLS. Só usar em contexto de servidor
// sem sessão de usuário (webhooks, workers/scripts de disparo). Nunca expor ao client.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
