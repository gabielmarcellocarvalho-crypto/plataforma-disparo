"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tag, X } from "lucide-react";
import type { TagCount } from "@/lib/overview-leads";
import { AutomaxLoader } from "@/components/page-loading";
import { DonutChart } from "@/components/charts/donut-chart";

// Troca (ou limpa) ?tag= mantendo período e o resto da query.
function useTagNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const setTag = (tag: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tag) params.set("tag", tag);
    else params.delete("tag");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return { setTag, pending };
}

// Troca de tag refaz a página inteira no servidor; sem isto a tela ficava parada com os números antigos.
function PendingOverlay() {
  return (
    <div className="absolute inset-0 z-30 bg-bg/70 rounded-xl" aria-live="polite">
      <div className="sticky top-[35vh] flex flex-col items-center gap-3 pt-24">
        <AutomaxLoader />
        <p className="text-sm text-text-muted font-semibold">Carregando…</p>
      </div>
    </div>
  );
}

// Seletor no topo da Visão geral: filtra os cards de leads/ganhos por tag.
export function TagFilterSelect({ tags, active }: { tags: string[]; active: string | null }) {
  const { setTag, pending } = useTagNavigation();
  if (tags.length === 0 && !active) return null;
  const options = active && !tags.includes(active) ? [active, ...tags] : tags;
  return (
    <>
    {pending && <PendingOverlay />}
    <label className={`flex items-center gap-2 rounded-lg border bg-surface px-3 h-10 text-sm shadow-sm ${active ? "border-primary-strong" : "border-border"} ${pending ? "opacity-60" : ""}`}>
      <Tag size={15} className={active ? "text-primary-strong" : "text-text-muted"} aria-hidden />
      <span className="sr-only">Filtrar por tag</span>
      <select
        value={active ?? ""}
        onChange={(e) => setTag(e.target.value || null)}
        className="bg-transparent font-semibold outline-none cursor-pointer max-w-[160px] truncate"
      >
        <option value="">Todas as tags</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
    </>
  );
}

// "Leads por tag" em rosca. Clicar numa fatia (ou na legenda) aplica o filtro; clicar de novo limpa.
export function LeadsByTagCard({ tags, untagged, total, active, periodLabel }: { tags: TagCount[]; untagged: number; total: number; active: string | null; periodLabel: string }) {
  const { setTag, pending } = useTagNavigation();
  const top = tags.slice(0, 10);
  const rest = tags.slice(10).reduce((s, t) => s + t.value, 0);
  const data = [...top, ...(rest > 0 ? [{ label: "Outras tags", value: rest }] : []), ...(untagged > 0 ? [{ label: "Sem tag", value: untagged }] : [])];

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
      {pending && <PendingOverlay />}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-bold text-[15px]">Leads por tag</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Quem entrou <span className="capitalize">{periodLabel}</span> em cada tag ({total.toLocaleString("pt-BR")} leads). Clique numa tag para filtrar a página.
          </p>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => setTag(null)}
            className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-bold text-primary-strong whitespace-nowrap cursor-pointer"
          >
            {active}
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">Nenhum lead com tag nesse período.</p>
      ) : (
        <DonutChart
          data={data}
          size={190}
          thickness={30}
          selected={active}
          onSelect={(label) => {
            if (label === "Sem tag" || label === "Outras tags") return;
            setTag(active === label ? null : label);
          }}
        />
      )}
    </div>
  );
}
