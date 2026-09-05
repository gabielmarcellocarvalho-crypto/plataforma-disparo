"use client";

import { useMemo, useState, useTransition } from "react";
import {
  bulkSaveTerritories,
  deleteTerritory,
  clearTerritories,
  setCityFieldKey,
  applyRoutingToExistingLeads,
  type TerritoryRow,
} from "@/app/actions/territories";
import type { TeamMemberRow } from "@/app/actions/team";
import type { CustomFieldDef } from "@/lib/custom-fields";

const INPUT = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface";

export function TerritoriesManager({
  territories: initial,
  members,
  fieldDefs,
  cityFieldKey: initialCityFieldKey,
}: {
  territories: TerritoryRow[];
  members: TeamMemberRow[];
  fieldDefs: CustomFieldDef[];
  cityFieldKey: string | null;
}) {
  const [territories, setTerritories] = useState(initial);
  const [cityKey, setCityKey] = useState(initialCityFieldKey ?? "");
  const [colagem, setColagem] = useState("");
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  const [pending, startTransition] = useTransition();

  const nomePorId = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtrados = q
      ? territories.filter((t) => t.city.toLowerCase().includes(q) || (nomePorId.get(t.team_member_id ?? "") ?? "").toLowerCase().includes(q))
      : territories;
    return filtrados.slice(0, 200);
  }, [territories, busca, nomePorId]);

  // Só campo de texto ou de lista pode guardar cidade — número e data não fazem sentido aqui.
  const camposCidade = fieldDefs.filter((d) => d.type === "texto" || d.type === "selecao");

  function salvarCampoCidade(key: string) {
    setCityKey(key);
    setErro(null);
    startTransition(async () => {
      const r = await setCityFieldKey(key);
      if (r.error) setErro(r.error);
    });
  }

  function colar() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = await bulkSaveTerritories(colagem);
      if (r.error) {
        setErro(r.error + (r.semVendedor?.length ? ` Sem correspondência: ${r.semVendedor.join(", ")}` : ""));
        return;
      }
      setAviso(
        `${r.salvos} cidade(s) no mapa.` +
          (r.semVendedor?.length ? ` Não achei na equipe: ${r.semVendedor.join(", ")}.` : "")
      );
      setColagem("");
      // O mapa volta do servidor no próximo carregamento da página; aqui só sinaliza que salvou.
      startTransition(() => {
        window.location.reload();
      });
    });
  }

  function remover(id: string) {
    startTransition(async () => {
      const r = await deleteTerritory(id);
      if (r.error) setErro(r.error);
      else setTerritories((prev) => prev.filter((t) => t.id !== id));
    });
  }

  function limparTudo() {
    startTransition(async () => {
      const r = await clearTerritories();
      if (r.error) setErro(r.error);
      else {
        setTerritories([]);
        setConfirmandoLimpeza(false);
      }
    });
  }

  function aplicarNosExistentes() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = await applyRoutingToExistingLeads();
      if (r.error) {
        setErro(r.error);
        return;
      }
      setAviso(
        `${r.atribuidos} lead(s) ganharam responsável pelo mapa.` +
          (r.semTerritorio ? ` ${r.semTerritorio} estavam sem dono e com cidade fora do mapa.` : "")
      );
    });
  }

  return (
    <section className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-bold">Territórios</h2>
        <p className="text-xs text-text-muted mt-0.5">
          De que vendedor é cada cidade. Com o mapa preenchido, o lead cai no dono certo sozinho: na importação de
          planilha e quando o agente descobre a cidade na conversa. Lead que já tem responsável nunca é reatribuído.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2.5 border-t border-border pt-3">
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label className="text-xs font-semibold text-text-muted">Qual campo do lead guarda a cidade</label>
          <select value={cityKey} onChange={(e) => salvarCampoCidade(e.target.value)} className={`${INPUT} cursor-pointer`}>
            <option value="">— nenhum (roteamento desligado)</option>
            {camposCidade.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {camposCidade.length === 0 && (
          <span className="text-xs text-text-muted py-2.5">Crie um campo de cidade no Pipeline primeiro.</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <label className="text-xs font-semibold text-text-muted">Colar mapa — uma linha por cidade</label>
        <textarea
          value={colagem}
          onChange={(e) => setColagem(e.target.value)}
          rows={5}
          placeholder={"Cidade A = Nome do vendedor\nCidade B = Nome do vendedor\nCidade C = Outro vendedor"}
          className={`${INPUT} resize-y font-mono text-xs`}
        />
        <p className="text-[11px] text-text-muted">
          Aceita <b>=</b>, <b>:</b> ou tabulação (o que sai ao colar duas colunas de planilha). O vendedor casa pelo
          nome completo ou só pelo primeiro nome. Cidade repetida sobrescreve — dá pra recolar o mapa inteiro sempre
          que ele mudar.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={colar}
            disabled={pending || !colagem.trim()}
            className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2 rounded-md cursor-pointer disabled:opacity-60"
          >
            Salvar mapa
          </button>
          <button
            type="button"
            onClick={aplicarNosExistentes}
            disabled={pending || territories.length === 0 || !cityKey}
            className="border border-border text-xs font-bold px-3.5 py-2 rounded-md cursor-pointer disabled:opacity-50"
          >
            Aplicar aos leads sem responsável
          </button>
          {territories.length > 0 &&
            (confirmandoLimpeza ? (
              <>
                <span className="text-xs font-bold text-danger">Apagar as {territories.length} cidades?</span>
                <button type="button" onClick={limparTudo} disabled={pending} className="text-xs font-bold text-white bg-danger px-2.5 py-1.5 rounded-md cursor-pointer">
                  Sim, limpar
                </button>
                <button type="button" onClick={() => setConfirmandoLimpeza(false)} className="text-xs font-semibold text-text-muted cursor-pointer">
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmandoLimpeza(true)} className="text-xs font-semibold text-text-muted hover:text-danger cursor-pointer">
                limpar mapa
              </button>
            ))}
        </div>
        {aviso && <span className="text-xs text-success font-medium">{aviso}</span>}
        {erro && <span className="text-xs text-danger font-medium">{erro}</span>}
      </div>

      {territories.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-bold text-text-muted">{territories.length} cidade(s) no mapa</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar cidade ou vendedor…" className={`${INPUT} w-56`} />
          </div>
          <div className="max-h-72 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <tbody>
                {visiveis.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{t.city}</td>
                    <td className="px-3 py-1.5 text-text-muted">{nomePorId.get(t.team_member_id ?? "") ?? "— sem vendedor"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" onClick={() => remover(t.id)} disabled={pending} className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer">
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visiveis.length < territories.length && (
            <span className="text-[11px] text-text-muted">Mostrando {visiveis.length} — use a busca pra achar o resto.</span>
          )}
        </div>
      )}
    </section>
  );
}
