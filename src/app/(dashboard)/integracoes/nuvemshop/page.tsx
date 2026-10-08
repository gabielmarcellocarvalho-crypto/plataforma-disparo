import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegration } from "@/lib/integrations/connections";
import { NUVEMSHOP_CAPABILITIES, NUVEMSHOP_PROVIDER } from "@/lib/integrations/nuvemshop/capabilities";
import { NuvemshopPanel, type CapabilityView, type NuvemshopState } from "@/components/nuvemshop-panel";

// Só o que a tela precisa: nunca o token. A leitura passa pelo servidor com service role.
export default async function NuvemshopPage() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const conn = await getIntegration(createAdminClient(), workspace.id, NUVEMSHOP_PROVIDER).catch(() => null);
  const state: NuvemshopState = {
    connected: Boolean(conn),
    storeId: conn?.external_id ?? null,
    storeName: conn?.display_name ?? null,
    status: conn?.status ?? null,
    enabled: conn?.enabled_capabilities ?? [],
  };
  const capabilities: CapabilityView[] = NUVEMSHOP_CAPABILITIES.map(({ id, label, kind, available, description }) => ({
    id,
    label,
    kind,
    available,
    description,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/integracoes" className="text-xs font-bold text-text-muted hover:text-text">← Integrações</Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-1">Nuvemshop</h1>
        <p className="text-text-muted text-sm mt-1">Loja conectada aos agentes de {workspace.name}.</p>
      </div>
      <NuvemshopPanel state={state} capabilities={capabilities} />
    </div>
  );
}
