"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { signOut } from "@/app/login/actions";
import { inviteWorkspaceUser, listWorkspaceUsers, removeWorkspaceUser, type InviteState, type WorkspaceUser } from "@/app/actions/workspace-users";

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["Como conecto meu WhatsApp?", "Como organizo meu pipeline?", "Como crio uma automação?", "Como importo contatos?"];

const iconBtn =
  "grid place-items-center w-10 h-10 rounded-full border transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary";

function HelpPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/help-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) setError(data.error || "Não foi possível responder agora.");
      else setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch {
      setError("Sem conexão. Verifique a internet e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Central de ajuda"
      className="fixed z-50 right-3 top-14 w-[calc(100vw-1.5rem)] sm:w-[400px] h-[min(600px,calc(100vh-4.5rem))] flex flex-col rounded-xl border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
        <div>
          <h2 className="text-sm font-extrabold">Central de ajuda</h2>
          <p className="text-xs text-text-muted">Tire dúvidas sobre como usar a AutomaX</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar central de ajuda" className="text-text-muted hover:text-text p-1 cursor-pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        <div className="self-start max-w-[88%] rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-3 py-2 text-sm">
          Oi! Sou a assistente da AutomaX. Pergunte como fazer qualquer coisa na plataforma. Eu não vejo os dados da sua conta, só explico como tudo funciona.
        </div>
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:bg-primary-faint hover:text-primary-strong cursor-pointer">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "self-end rounded-tr-sm bg-primary-strong text-white" : "self-start rounded-tl-sm bg-surface-2 border border-border"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && <div className="self-start rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-3 py-2 text-sm text-text-muted">Digitando…</div>}
        {error && <p className="text-xs text-danger font-medium">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-center gap-2 px-3 py-3 border-t border-border shrink-0"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1500}
          placeholder="Escreva sua dúvida…"
          className="flex-1 min-w-0 border border-border rounded-full px-4 py-2 text-sm outline-none focus:border-primary bg-surface"
        />
        <button type="submit" disabled={loading || !draft.trim()} className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-full cursor-pointer disabled:opacity-50">
          Enviar
        </button>
      </form>
    </div>
  );
}

const INVITE_INITIAL: InviteState = { error: null };

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(inviteWorkspaceUser, INVITE_INITIAL);
  const [users, setUsers] = useState<WorkspaceUser[] | null>(null);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    listWorkspaceUsers().then((u) => alive && setUsers(u));
    return () => {
      alive = false;
    };
  }, [state.ok]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function remove(id: string) {
    setRemoveError(null);
    startRemove(async () => {
      const r = await removeWorkspaceUser(id);
      if (r.error) setRemoveError(r.error);
      else setUsers(await listWorkspaceUsers());
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // sem permissão de área de transferência: a senha continua visível pra copiar na mão
    }
  }

  const field = "w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary bg-surface";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Convidar usuário" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-surface border border-border shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold">Convidar usuário</h2>
            <p className="text-sm text-text-muted mt-0.5">A pessoa terá acesso apenas a este workspace.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text p-1 cursor-pointer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {state.ok && state.tempPassword ? (
          <div className="rounded-lg border border-border bg-success-soft p-4 flex flex-col gap-2 text-sm">
            <p className="font-bold">Acesso criado para {state.email}.</p>
            <p>Repasse o e-mail e esta senha provisória. Ela aparece só agora; depois a pessoa pode trocar em &quot;Esqueci minha senha&quot; na tela de login.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-surface border border-border px-3 py-2 font-mono text-sm select-all">{state.tempPassword}</code>
              <button type="button" onClick={() => copy(state.tempPassword!)} className="border border-border bg-surface text-xs font-bold px-3 py-2 rounded-md cursor-pointer shrink-0">
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Nome
              <input name="full_name" className={field} placeholder="Nome da pessoa" autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              E-mail
              <input name="email" type="email" required className={field} placeholder="pessoa@empresa.com" autoComplete="off" />
            </label>
            {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}
            <button type="submit" disabled={pending} className="self-start bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60">
              {pending ? "Criando…" : "Criar acesso"}
            </button>
          </form>
        )}

        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-bold mb-2">Quem tem acesso</h3>
          {users === null ? (
            <p className="text-xs text-text-muted">Carregando…</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-text-muted">Ninguém ainda.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {u.name || u.email} {u.isSelf && <span className="text-xs font-normal text-text-muted">(você)</span>}
                    </p>
                    {u.name && <p className="text-xs text-text-muted truncate">{u.email}</p>}
                  </div>
                  {!u.isSelf && (
                    <button type="button" onClick={() => remove(u.id)} disabled={removing} className="text-xs font-bold text-danger cursor-pointer disabled:opacity-60 shrink-0">
                      Remover
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {removeError && <p className="text-xs text-danger font-medium mt-2">{removeError}</p>}
        </div>
      </div>
    </div>
  );
}

const menuItem = "flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-semibold text-left rounded-md cursor-pointer hover:bg-surface-2 transition-colors";

// Atalhos fixos no topo: ajuda (chat com IA) e menu da conta (configurações, convidar usuário, sair).
export function TopbarActions({ email }: { email: string }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Clique fora e Esc fecham o menu; o link de Configurações fecha no próprio clique.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setHelpOpen((o) => !o);
          setMenuOpen(false);
        }}
        aria-label="Central de ajuda"
        aria-expanded={helpOpen}
        title="Central de ajuda"
        className={`${iconBtn} ${helpOpen ? "bg-primary-strong border-primary-strong text-white" : "bg-surface border-border text-text-muted hover:text-primary-strong hover:border-primary-strong"}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setMenuOpen((o) => !o);
            setHelpOpen(false);
          }}
          aria-label="Menu da conta"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={email}
          className={`${iconBtn} ${menuOpen ? "bg-primary-strong border-primary-strong text-white" : "bg-primary-soft border-primary/30 text-primary-strong hover:bg-primary-strong hover:text-white hover:border-primary-strong"}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>

        {menuOpen && (
          <div role="menu" className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-border bg-surface shadow-2xl p-1.5">
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Conta</p>
              <p className="text-sm font-semibold truncate" title={email}>
                {email}
              </p>
            </div>
            <Link href="/configuracoes" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
              </svg>
              Configurações
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setInviteOpen(true);
              }}
              className={menuItem}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Convidar usuário
            </button>
            <form action={signOut} className="border-t border-border mt-1 pt-1">
              <button type="submit" role="menuitem" className={`${menuItem} text-danger`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sair
              </button>
            </form>
          </div>
        )}
      </div>

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
