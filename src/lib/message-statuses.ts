import type { SupabaseClient } from "@supabase/supabase-js";

// Status de entrega da Meta (statuses[] do webhook): "sent" → "delivered" → "read" (ou "failed").
// Aqui só importa entregue e lida, pra mostrar nas campanhas.
export type DeliveryStatus = { id: string; status: "delivered" | "read"; at: string };

type StatusBody = {
  entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; timestamp?: string }[] } }[] }[];
};

export function parseDeliveryStatuses(body: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  for (const entry of (body as StatusBody | null)?.entry || []) {
    for (const change of entry.changes || []) {
      for (const st of change.value?.statuses || []) {
        if (!st.id || (st.status !== "delivered" && st.status !== "read")) continue;
        const ts = Number(st.timestamp);
        out.push({ id: st.id, status: st.status, at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString() });
      }
    }
  }
  return out;
}

// Marca entregue/lida no destinatário da campanha com esse wamid. Lida implica entregue (a Meta às
// vezes manda só o "read"). Mensagem que não é de campanha simplesmente não casa com nenhuma linha.
export async function saveDeliveryStatuses(supabase: SupabaseClient, statuses: DeliveryStatus[]) {
  for (const st of statuses) {
    await supabase.from("campaign_recipients").update({ delivered_at: st.at }).eq("external_id", st.id).is("delivered_at", null);
    if (st.status === "read") {
      await supabase.from("campaign_recipients").update({ read_at: st.at }).eq("external_id", st.id).is("read_at", null);
    }
  }
}
