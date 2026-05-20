import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-auth";

const STORAGE_KEY = "current_alliance_id";

export type AllianceMembership = {
  alliance_id: string;
  role: "owner" | "member";
  name: string;
};

export function useMyAlliances() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["my_alliances", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alliance_members")
        .select("alliance_id, role, alliances(name)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        alliance_id: r.alliance_id,
        role: r.role as "owner" | "member",
        name: (r as unknown as { alliances: { name: string } | null }).alliances?.name ?? "—",
      })) as AllianceMembership[];
    },
  });
}

export function useCurrentAlliance() {
  const { data: list, isLoading } = useMyAlliances();
  const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const current = list?.find((a) => a.alliance_id === stored) ?? list?.[0] ?? null;
  return { current, all: list ?? [], isLoading };
}

export function setCurrentAlliance(id: string) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
}
