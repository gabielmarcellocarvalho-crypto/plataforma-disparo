"use client";

import { useState, useTransition } from "react";
import { ChevronDown, RefreshCw, Unplug } from "lucide-react";
import { disconnectFacebook, fetchFacebookForms, removeFacebookPage, saveFacebookForm, setFacebookPageActive, type FacebookForm } from "@/app/actions/facebook";
import { cn } from "@/lib/utils";

export type FacebookPageRow = { id: string; name: string; active: boolean; forms: FacebookForm[] };
export type FacebookConnectionRow = { id: string; name: string | null } | null;

const STATUS_TEXT: Record<string, { tone: "ok" | "warn"; text: string }> = {
  ok: { tone: "ok", text: "Conta do Facebook conectada. Escolha as páginas e os formulários abaixo." },
  parcial: { tone: "warn", text: "Conta conectada. Algumas páginas dessa conta do Facebook já pertencem a outro cliente e não foram adicionadas aqui." },
  ocupada: { tone: "warn", text: "As páginas dessa conta do Facebook já estão conectadas em outro cliente. Nada foi adicionado aqui." },
  cancelado: { tone: "warn", text: "Conexão cancelada na tela do Facebook. Nada foi alterado." },
  expirado: { tone: "warn", text: "O link de conexão expirou. Clique em Conectar Facebook de novo." },
  config: { tone: "warn", text: "A conexão com o Facebook ainda não está configurada no servidor." },
  erro: { tone: "warn", text: "Não foi possível concluir a conexão com o Facebook. Tente de novo." },
};

function PageForms({ page, canManage }: { page: FacebookPageRow; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [forms, setForms] = useState<FacebookForm[]>(page.forms);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    setError(null);
    startTransition(async () => {
      const r = await fetchFacebookForms(page.id);
      if (r.error !== null) setError(r.error);
      else setForms(r.forms);
    });
  }

  function update(formId: string, patch: Partial<FacebookForm>) {
    const next = forms.map((f) => (f.id === formId ? { ...f, ...patch } : f));
    setForms(next);
    const f = next.find((x) => x.id === formId)!;
    startTransition(async () => {
      const r = await saveFacebookForm(page.id, f.id, f.enabled, f.tag);
      if (r.error !== null) setError(r.error);
    });
  }

  return (
    <div className="border border-border rounded-lg">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center gap-3 px-3.5 py-3 text-left cursor-pointer">
        <span className="text-sm font-semibold flex-1 truncate">{page.name}</span>
        <span className="text-xs text-text-muted">{forms.filter((f) => f.enabled).length} formulário(s) ligado(s)</span>
        <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-border px-3.5 py-3 flex flex-col gap-3">
          {canManage && (
            <button type="button" onClick={refresh} disabled={pending} className="inline-flex items-center gap-1.5 text-xs font-bold w-fit cursor-pointer disabled:opacity-60">
              <RefreshCw className={cn("w-3.5 h-3.5", pending && "animate-spin")} aria-hidden />
              Buscar formulários da página
            </button>
          )}
          {forms.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhum formulário de lead encontrado. Crie um no Gerenciador de Anúncios e busque de novo.</p>
          ) : (
            forms.map((f) => (
              <div key={f.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={!canManage || pending}
                    onChange={(e) => update(f.id, { enabled: e.target.checked })}
                    className="cursor-pointer accent-[var(--color-primary-strong)]"
                  />
                  <span className="truncate">{f.name}</span>
                </label>
                <input
                  defaultValue={f.tag}
                  disabled={!canManage}
                  placeholder="Etiqueta (ex.: Facebook Mega Feirão)"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== f.tag) update(f.id, { tag: e.target.value.trim() });
                  }}
                  className="border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary bg-surface sm:w-64 min-w-0"
                  aria-label={`Etiqueta do formulário ${f.name}`}
                />
              </div>
            ))
          )}
          {error && <p className="text-xs text-danger font-semibold">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Página da conta: liga ou desliga os leads dela. Só página ligada tem formulários pra escolher.
function PageRow({ page, canManage }: { page: FacebookPageRow; canManage: boolean }) {
  const [active, setActive] = useState(page.active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function remove() {
    setError(null);
    startTransition(async () => {
      const r = await removeFacebookPage(page.id);
      if (r.error !== null) setError(r.error);
      setConfirmingRemove(false);
    });
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      const r = await setFacebookPageActive(page.id, !active);
      if (r.error !== null) setError(r.error);
      else setActive(!active);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 border border-border rounded-lg px-3.5 py-2.5">
        <span className="text-sm font-semibold flex-1 truncate">{page.name}</span>
        {canManage &&
          (confirmingRemove ? (
            <>
              <button type="button" onClick={remove} disabled={pending} className="text-xs font-bold px-2.5 py-1.5 rounded-md bg-danger text-white cursor-pointer disabled:opacity-60">
                Confirmar remoção
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)} disabled={pending} className="text-xs font-bold px-2.5 py-1.5 rounded-md border border-border cursor-pointer">
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingRemove(true)} disabled={pending} className="text-xs font-bold px-2.5 py-1.5 rounded-md border border-border text-text-muted hover:text-danger cursor-pointer disabled:opacity-60">
              Remover
            </button>
          ))}
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={toggle}
          disabled={!canManage || pending}
          className={cn(
            "text-xs font-bold px-3 py-1.5 rounded-full border cursor-pointer disabled:opacity-60",
            active ? "bg-success-soft border-success text-success" : "border-border text-text-muted"
          )}
        >
          {pending ? "Salvando…" : active ? "Ligada" : "Desligada"}
        </button>
      </div>
      {active ? (
        <PageForms page={page} canManage={canManage} />
      ) : (
        <p className="text-xs text-text-muted px-1">Ligue a página para escolher de quais formulários receber leads.</p>
      )}
      {error && <p className="text-xs text-danger font-semibold px-1">{error}</p>}
    </div>
  );
}

export function FacebookLeadsSection({
  connection,
  pages,
  canManage,
  status,
}: {
  connection: FacebookConnectionRow;
  pages: FacebookPageRow[];
  canManage: boolean;
  status: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const banner = status ? STATUS_TEXT[status] : null;

  function handleDisconnect() {
    if (!connection) return;
    setError(null);
    startTransition(async () => {
      const r = await disconnectFacebook(connection.id);
      if (r.error !== null) setError(r.error);
      else setConfirming(false);
    });
  }

  return (
    <section id="facebook-leads" className="scroll-mt-6 bg-surface border border-border rounded-xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-4 border-b border-border">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Facebook — leads de formulário de anúncio</h2>
          <p className="text-sm text-text-muted mt-0.5 leading-relaxed max-w-3xl">
            Quem preenche o formulário de um anúncio cai direto nos contatos, com nome, telefone, e-mail, as perguntas do
            formulário, a etiqueta que você escolher e a origem &quot;Facebook&quot;. Se já existe o mesmo telefone, o contato é
            atualizado, não duplicado.
          </p>
        </div>
        {canManage && !connection && (
          <a href="/api/integrations/facebook/start" className="inline-flex items-center justify-center min-h-9 px-3.5 rounded-lg bg-primary-strong text-white text-sm font-bold hover:opacity-90 shrink-0">
            Conectar Facebook
          </a>
        )}
      </div>

      {banner && (
        <p role="status" className={cn("mx-4 mt-4 text-sm font-medium rounded-lg px-3.5 py-2.5", banner.tone === "ok" ? "bg-success-soft text-success" : "bg-warning-soft text-warning-text")}>
          {banner.text}
        </p>
      )}

      {connection ? (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-success-soft text-success">Conectado como {connection.name ?? "conta do Facebook"}</span>
            {canManage && (
              <>
                <a href="/api/integrations/facebook/start" className="text-xs font-bold text-text-muted hover:text-text">
                  Conectar outra conta
                </a>
                {confirming ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted">Desconectar? Os leads já recebidos continuam.</span>
                    <button type="button" onClick={handleDisconnect} disabled={pending} className="font-bold text-danger cursor-pointer disabled:opacity-60">
                      Sim, desconectar
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="font-bold text-text-muted cursor-pointer">
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 text-xs font-bold text-text-muted hover:text-danger cursor-pointer">
                    <Unplug className="w-3.5 h-3.5" aria-hidden />
                    Desconectar
                  </button>
                )}
              </>
            )}
          </div>

          {pages.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma página autorizada. Conecte de novo e marque as páginas na tela do Facebook.</p>
          ) : (
            pages.map((p) => <PageRow key={p.id} page={p} canManage={canManage} />)
          )}
          {error && <p className="text-xs text-danger font-semibold">{error}</p>}
        </div>
      ) : (
        <p className="p-4 text-sm text-text-muted">Ainda não conectado. Clique em Conectar Facebook pra entrar com a conta que administra as páginas.</p>
      )}
    </section>
  );
}
