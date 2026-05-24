import { supabase } from "@/integrations/supabase/client";
import type { PipelineStage } from "@/lib/queries";

export const DEFAULT_PIPELINE_STAGE_NAMES = [
  "Researched",
  "DM Sent",
  "Responded",
  "Call Booked",
  "Closed",
] as const;

export async function ensurePipelineStages(allianceId: string): Promise<PipelineStage[]> {
  const { data: existing, error: fetchError } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("alliance_id", allianceId)
    .order("order_index", { ascending: true });

  if (fetchError) throw fetchError;
  if (existing && existing.length > 0) return existing;

  const payload = DEFAULT_PIPELINE_STAGE_NAMES.map((name, i) => ({
    alliance_id: allianceId,
    name,
    order_index: i,
  }));

  const { error: insertError } = await supabase.from("pipeline_stages").insert(payload);
  if (insertError) throw insertError;

  const { data: created, error: refetchError } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("alliance_id", allianceId)
    .order("order_index", { ascending: true });
  if (refetchError) throw refetchError;
  return created ?? [];
}
