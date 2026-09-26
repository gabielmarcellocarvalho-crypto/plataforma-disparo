import { headers } from "next/headers";
import { AuthShell } from "@/components/auth-shell";
import { GoogleLogo } from "@/components/google-logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyConnectToken } from "@/lib/calendar/connect-token";
import { buildAuthUrl } from "@/lib/calendar/google-oauth";

// Página PÚBLICA do link que vai pro WhatsApp do closer — ele normalmente não tem login na plataforma.
// O token no endereço é assinado e só conecta a agenda da pessoa que está dentro dele.
export default async function ConnectCalendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyConnectToken(token);

  if (!payload || payload.origin !== "link") {
    return (
      <AuthShell title="Link expirado" subtitle="Esse link de conexão não vale mais">
        <p className="text-sm text-text-muted">
          Links de conexão valem 7 dias. Peça pra quem te enviou gerar um novo em Integrações.
        </p>
      </AuthShell>
    );
  }

  const admin = createAdminClient();
  const [{ data: member }, { data: workspace }] = await Promise.all([
    admin.from("team_members").select("name").eq("id", payload.teamMemberId).eq("workspace_id", payload.workspaceId).maybeSingle(),
    admin.from("workspaces").select("name").eq("id", payload.workspaceId).maybeSingle(),
  ]);

  if (!member || !workspace) {
    return (
      <AuthShell title="Link inválido" subtitle="Não encontramos essa conexão">
        <p className="text-sm text-text-muted">Peça pra quem te enviou gerar um novo link em Integrações.</p>
      </AuthShell>
    );
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  const authUrl = buildAuthUrl(`${proto}://${host}`, token);

  return (
    <AuthShell title="Conectar sua agenda" subtitle={`${member.name} · ${workspace.name}`}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-text-muted leading-relaxed">
          Com a agenda conectada, o assistente de atendimento marca reuniões com você direto no seu Google Agenda,
          já com o link do Meet.
        </p>
        <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3 flex flex-col gap-1.5">
          <span className="font-semibold">Como funciona</span>
          <span className="text-text-muted leading-relaxed">
            Crie na sua agenda eventos chamados <strong className="text-text">Marque aqui</strong> nos horários em que
            você atende. Quando um cliente escolhe um deles, o evento vira a reunião. O resto da sua agenda não é usado.
          </span>
        </div>
        <a
          href={authUrl}
          className="flex items-center justify-center gap-2.5 w-full border border-border rounded-lg py-2.5 font-semibold hover:bg-surface-2 transition-colors"
        >
          <GoogleLogo size={18} />
          Conectar com Google
        </a>
      </div>
    </AuthShell>
  );
}
