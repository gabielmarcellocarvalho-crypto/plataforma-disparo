import Link from "next/link";
import type { AttentionAlert } from "@/lib/attention-center";

export function AttentionCenterCard({ alerts }: { alerts: AttentionAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-2.5">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-warning-soft text-warning-text shrink-0" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
        </span>
        <h3 className="font-bold text-[15px]">Central de atenção</h3>
        <span className="text-[11px] font-mono text-text-muted bg-bg rounded-full px-2 py-0.5 ml-auto">{alerts.length}</span>
      </div>
      <div className="divide-y divide-border">
        {alerts.map((a) => (
          <Link
            key={a.key}
            href={a.href}
            className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-text hover:bg-bg transition-colors group"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning-text shrink-0" aria-hidden />
            <span className="flex-1">{a.label}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
