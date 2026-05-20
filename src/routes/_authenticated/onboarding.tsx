import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useMyAlliances } from "@/hooks/use-alliance";
import { Button, Input, Label, Panel } from "@/components/term";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: alliances = [] } = useMyAlliances();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("alliances")
        .insert({ name: name.trim(), created_by: user.id })
        .select("id")
        .single();
      if (error) throw error;
      const { error: mErr } = await supabase
        .from("alliance_members")
        .insert({ alliance_id: data.id, user_id: user.id, role: "owner" });
      if (mErr) throw mErr;
      return data.id;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my_alliances"] });
      nav({ to: "/pipeline" });
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (alliances.length > 0) {
    nav({ to: "/pipeline" });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Panel className="w-full max-w-md p-6">
        <div className="mono text-xs tracking-wider text-[var(--text-muted)] mb-1">
          WEBGOALZ // OUTREACH
        </div>
        <h1 className="text-xl font-semibold mb-1">Create your alliance</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          An alliance is your team workspace. Prospects, sequences, and follow-ups live inside it. You can invite teammates after this step.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); setErr(null); create.mutate(); }} className="space-y-3">
          <div>
            <Label>ALLIANCE NAME</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Webgoalz"
              autoFocus
            />
          </div>
          {err && (
            <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">{err}</div>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "CREATING…" : "CREATE ALLIANCE"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
