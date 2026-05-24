import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Prospect = Database["public"]["Tables"]["prospects"]["Row"];
export type FollowUp = Database["public"]["Tables"]["follow_ups"]["Row"];
export type Sequence = Database["public"]["Tables"]["sequences"]["Row"];
export type SequenceStep = Database["public"]["Tables"]["sequence_steps"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProspectStatus = Database["public"]["Enums"]["prospect_status"];
export type PipelineStage = Database["public"]["Tables"]["pipeline_stages"]["Row"];

export const STATUSES: ProspectStatus[] = [
  "researched",
  "dm_sent",
  "responded",
  "call_booked",
  "closed",
];

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  researched: "RESEARCHED",
  dm_sent: "DM SENT",
  responded: "RESPONDED",
  call_booked: "CALL BOOKED",
  closed: "CLOSED",
};

export function usePipelineStages(allianceId?: string) {
  return useQuery({
    queryKey: ["pipeline_stages", allianceId ?? "none"],
    enabled: !!allianceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("alliance_id", allianceId!)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useProspects() {
  return useQuery({
    queryKey: ["prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useProspect(id: string) {
  return useQuery({
    queryKey: ["prospects", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("prospects").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useFollowUps(prospectId?: string) {
  return useQuery({
    queryKey: ["follow_ups", prospectId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("follow_ups").select("*").order("due_date", { ascending: true });
      if (prospectId) q = q.eq("prospect_id", prospectId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useSequences() {
  return useQuery({
    queryKey: ["sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequences")
        .select("*, sequence_steps(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (Sequence & { sequence_steps: SequenceStep[] })[];
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useMessages(prospectId: string) {
  return useQuery({
    queryKey: ["messages", prospectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages_log")
        .select("*")
        .eq("prospect_id", prospectId)
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function invalidateProspect(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ["prospects"] });
  if (id) qc.invalidateQueries({ queryKey: ["prospects", id] });
}
