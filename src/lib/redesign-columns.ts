import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// As colunas da migration 0089 (valor do negócio, análise da IA) já existem? Antes dela rodar, pedir
// essas colunas derrubaria a consulta inteira — então as telas perguntam aqui e só incluem quando dá.
export const hasRedesignColumns = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").select("deal_value, ai_score").limit(1);
  return !error;
});

export const CONTACT_REDESIGN_COLUMNS = "deal_value, ai_score, ai_temperature, ai_summary, ai_next_action, ai_scored_at";
