"use client";

import { useRef, useState, useTransition } from "react";
import { RotateCcw, Send, Sparkles } from "lucide-react";
import { testAgentReply } from "@/app/actions/ai-features";

type Msg = { role: "user" | "assistant"; content: string };

// "Testar agente": conversa de teste com o prompt salvo do agente, sem WhatsApp. Nada é enviado nem
// gravado, e as ferramentas (foto, link de pagamento, agenda) ficam desligadas no teste.
export function AgentPlayground({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setDraft("");
    setError(null);
    startTransition(async () => {
      const r = await testAgentReply(agentId, next);
      if (r.error !== null) setError(r.error);
      else setMsgs((cur) => [...cur, { role: "assistant", content: r.data }]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  }

  return (
    <aside className="bg-surface border border-border rounded-lg shadow-sm flex flex-col h-[560px] xl:sticky xl:top-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles size={14} className="text-primary" aria-hidden /> Testar agente
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">não envia WhatsApp</span>
          {msgs.length > 0 && (
            <button type="button" onClick={() => setMsgs([])} title="Recomeçar" aria-label="Recomeçar conversa de teste" className="text-text-muted hover:text-text cursor-pointer">
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2" style={{ background: "#efeae2" }}>
        {msgs.length === 0 && (
          <p className="text-xs text-[#667781] text-center my-auto px-4">
            Escreva como se fosse um cliente pra ver como {agentName} responde com o prompt salvo. Usa o mesmo modelo do agente (gasta tokens como uma conversa normal).
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-snug shadow-sm whitespace-pre-wrap break-words text-[#111b21] ${m.role === "user" ? "self-end rounded-tr-none" : "self-start rounded-tl-none"}`}
            style={{ background: m.role === "user" ? "#d9fdd3" : "#ffffff" }}
          >
            {m.content}
          </div>
        ))}
        {pending && <div className="self-start text-[11px] text-[#667781] px-2">digitando…</div>}
        <div ref={endRef} />
      </div>
      {error && <p className="text-xs text-danger font-medium px-3 pt-2">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 p-3 border-t border-border"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Fale como se fosse o cliente…"
          className="flex-1 border border-border rounded-full px-3.5 py-2 text-sm outline-none focus:border-primary bg-surface"
        />
        <button type="submit" disabled={pending || !draft.trim()} aria-label="Enviar mensagem de teste" className="grid place-items-center w-9 h-9 rounded-full bg-primary-strong text-white cursor-pointer disabled:opacity-50">
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
