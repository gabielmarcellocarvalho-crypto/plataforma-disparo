"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Check, Copy, Link2, Megaphone, Unplug, Webhook } from "lucide-react";
import { IntegrationCard } from "@/components/ui/integration-card";
import { GoogleLogo } from "@/components/google-logo";
import { createConnectLink, disconnectCalendar } from "@/app/actions/integrations";
import { cn } from "@/lib/utils";

export type CloserRow = {
  id: string;
  name: string;
  role: string | null;
  status: "conectado" | "reconectar" | "desconectado";
  accountEmail: string | null;
  // null = não deu pra consultar agora (ou não conectado).
  freeSlots: number | null;
};

// Retorno do Google quando a conexão foi feita por aqui ("Conectar agora").
const RETURN_MESSAGES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  ok: { tone: "ok", text: "Agenda conectada." },
  cancelado: { tone: "warn", text: "Conexão cancelada na tela do Google — nada foi alterado." },
  "sem-permissao": { tone: "warn", text: "Faltou marcar a permissão do Google Agenda na tela do Google. Tente de novo." },
  "link-invalido": { tone: "warn", text: "A autorização expirou. Clique em Conectar de novo." },
  erro: { tone: "warn", text: "Não foi possível conectar a agenda. Tente de novo em alguns minutos." },
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function StatusPill({ row }: { row: CloserRow }) {
  if (row.status === "conectado") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-success-soft text-success max-w-full">
        <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden />
        <span className="truncate">Conectado{row.accountEmail ? ` · ${row.accountEmail}` : ""}</span>
      </span>
    );
  }
  if (row.status === "reconectar") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-text">
        <span className="w-1.5 h-1.5 rounded-full bg-warning-text shrink-0" aria-hidden />
        Precisa reconectar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden />
      Desconectado
    </span>
  );
}

function SlotsInfo({ row }: { row: CloserRow }) {
  if (row.status !== "conectado") return null;
  if (row.freeSlots === null) return <span className="text-xs text-text-muted">Horários: —</span>;
  const none = row.freeSlots === 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", none ? "text-warning-text font-semibold" : "text-text-muted")}>
      <CalendarClock className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {none ? "Nenhum “Marque aqui” nos próximos 7 dias" : `${row.freeSlots} “Marque aqui” livre${row.freeSlots > 1 ? "s" : ""} nos próximos 7 dias`}
    </span>
  );
}

function CloserItem({ row }: { row: CloserRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCopy() {
    setError(null);
    startTransition(async () => {
      const r = await createConnectLink(row.id);
      if (r.error !== null) return setError(r.error);
      try {
        await navigator.clipboard.writeText(r.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setError("Não foi possível copiar. Tente de novo.");
      }
    });
  }

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      const r = await disconnectCalendar(row.id);
      if (r.error !== null) setError(r.error);
      setConfirmDisconnect(false);
      router.refresh();
    });
  }

  const connected = row.status === "conectado";
  const btn =
    "inline-flex items-center justify-center gap-1.5 min-h-9 px-3 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
          {initials(row.name)}
        </span>
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{row.name}</span>
            {row.role && <span className="text-xs text-text-muted truncate">{row.role}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <StatusPill row={row} />
            <SlotsInfo row={row} />
          </div>
          {error && <span className="text-xs text-danger font-medium">{error}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
        {!connected && (
          <a href={`/api/integrations/google/start?member=${row.id}`} className={cn(btn, "border border-border bg-surface hover:bg-surface-2 text-text")}>
            <GoogleLogo size={14} />
            {row.status === "reconectar" ? "Reconectar" : "Conectar agora"}
          </a>
        )}
        {!connected && (
          <button type="button" onClick={handleCopy} disabled={pending} className={cn(btn, "border border-border bg-surface hover:bg-surface-2 text-text")}>
            {copied ? <Check className="w-3.5 h-3.5 text-success" aria-hidden /> : <Link2 className="w-3.5 h-3.5" aria-hidden />}
            {copied ? "Link copiado" : "Copiar link"}
          </button>
        )}
        {connected &&
          (confirmDisconnect ? (
            <>
              <span className="text-xs text-text-muted">Desconectar a agenda?</span>
              <button type="button" onClick={handleDisconnect} disabled={pending} className={cn(btn, "bg-danger text-white hover:opacity-90")}>
                Sim, desconectar
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} className={cn(btn, "text-text-muted hover:text-text")}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDisconnect(true)} className={cn(btn, "text-text-muted hover:text-danger")}>
              <Unplug className="w-3.5 h-3.5" aria-hidden />
              Desconectar
            </button>
          ))}
      </div>
    </li>
  );
}

export function IntegrationsView({ workspaceName, closers }: { workspaceName: string; closers: CloserRow[] }) {
  const params = useSearchParams();
  const ret = RETURN_MESSAGES[params.get("agenda") || ""];
  const connectedCount = closers.filter((c) => c.status === "conectado").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Integrações</h1>
        <p className="text-text-muted text-sm mt-1">Conecte ferramentas externas às pessoas e aos agentes de {workspaceName}.</p>
      </div>

      {ret && (
        <p
          role="status"
          className={cn(
            "text-sm font-medium rounded-lg px-3.5 py-2.5",
            ret.tone === "ok" ? "bg-success-soft text-success" : "bg-warning-soft text-warning-text"
          )}
        >
          {ret.text}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <IntegrationCard
          title="Google Agenda"
          description="O agente SDR marca a reunião direto na agenda do closer, com link do Meet."
          cta="Configurar"
          href="#google-agenda"
          variant="default"
          badge={
            <span
              className={cn(
                "text-[11px] font-bold px-2 py-0.5 rounded-full",
                connectedCount > 0 ? "bg-success-soft text-success" : "bg-surface-2 border border-border text-text-muted"
              )}
            >
              {connectedCount > 0 ? `${connectedCount} conectado${connectedCount > 1 ? "s" : ""}` : "Nenhum conectado"}
            </span>
          }
          art={<GoogleLogo size={112} />}
        />
        <IntegrationCard
          title="Anúncios de formulário"
          description="Leads dos formulários de anúncio caindo direto em Contatos."
          cta="Em breve"
          variant="muted"
          art={<Megaphone className="w-24 h-24 text-text-muted" strokeWidth={1.25} />}
        />
        <IntegrationCard
          title="Webhooks"
          description="Enviar e receber eventos de outros sistemas."
          cta="Em breve"
          variant="muted"
          art={<Webhook className="w-24 h-24 text-text-muted" strokeWidth={1.25} />}
        />
      </div>

      <section id="google-agenda" className="scroll-mt-6 bg-surface border border-border rounded-xl shadow-sm">
        <div className="flex items-start gap-3 px-4 py-4 border-b border-border">
          <span className="grid place-items-center w-10 h-10 rounded-lg bg-surface-2 border border-border shrink-0" aria-hidden>
            <GoogleLogo size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold">Google Agenda dos closers</h2>
            <p className="text-sm text-text-muted mt-0.5 leading-relaxed max-w-3xl">
              Pro agente marcar reuniões, cada closer cria na própria agenda eventos com o título{" "}
              <strong className="text-text">Marque aqui</strong> nos horários em que atende (pode ser recorrente). Quando um lead
              escolhe um deles, o evento vira a reunião, com Meet. O resto da agenda não é usado.
            </p>
          </div>
        </div>

        {closers.length === 0 ? (
          <div className="px-4 py-10 text-center flex flex-col items-center gap-2">
            <p className="text-sm text-text-muted">Nenhuma pessoa cadastrada na Equipe ainda.</p>
            <Link href="/equipe" className="text-sm font-bold text-primary-strong hover:underline">
              Cadastrar em Equipe
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {closers.map((row) => (
              <CloserItem key={row.id} row={row} />
            ))}
          </ul>
        )}

        <p className="px-4 py-3 border-t border-border text-xs text-text-muted flex items-center gap-1.5">
          <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden />
          O closer não precisa de login: use “Copiar link” e mande pra ele. O link vale 7 dias e só conecta a agenda daquela pessoa.
        </p>
      </section>
    </div>
  );
}
