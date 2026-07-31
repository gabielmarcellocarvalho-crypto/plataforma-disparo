"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AttentionAlert } from "@/lib/attention-center";

export function AttentionCenterCard({ alerts }: { alerts: AttentionAlert[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Central de atenção"
        aria-label={`Central de atenção${alerts.length > 0 ? `, ${alerts.length} alerta(s)` : ""}`}
        className={`relative grid place-items-center w-10 h-10 rounded-xl border cursor-pointer transition-colors ${
          open ? "border-primary-strong bg-primary-faint text-primary-strong" : "border-border bg-surface text-text-muted hover:text-text hover:border-primary-soft"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold leading-4 text-center border-2 border-bg">
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-2 right-0 w-[340px] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-bold text-sm">Central de atenção</h3>
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8 px-4">Tudo certo por aqui — nenhum alerta agora.</p>
          ) : (
            <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
              {alerts.map((a) => (
                <Link
                  key={a.key}
                  href={a.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-text hover:bg-bg transition-colors group"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-text shrink-0" aria-hidden />
                  <span className="flex-1">{a.label}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
