import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useProfiles, useSequences } from "@/lib/queries";
import { Badge, Button, Input, Label, Panel, PanelHeader, Textarea } from "@/components/term";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <div className="label">SETTINGS</div>
        <h1 className="text-lg font-semibold mt-0.5">Workspace</h1>
      </div>
      <StrategySection />
      <MembersSection />
      <SequencesSection />
      <InstagramSection />
    </div>
  );
}

function StrategySection() {
  const qc = useQueryClient();
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: ["settings", "outreach_strategy"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("*").eq("key", "outreach_strategy").maybeSingle();
      return data;
    },
  });
  const [text, setText] = useState("");
  useEffect(() => { if (data?.value) setText((data.value as { text?: string }).text ?? ""); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("settings").upsert({
        key: "outreach_strategy", value: { text }, updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "outreach_strategy"] }),
  });

  return (
    <Panel>
      <PanelHeader>
        <span>OUTREACH STRATEGY PROMPT</span>
        <button className="text-[var(--accent)]" onClick={() => save.mutate()}>{save.isPending ? "SAVING…" : "SAVE"}</button>
      </PanelHeader>
      <div className="p-3">
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe your overall outreach strategy, ideal customer, tone of voice, key value props…" />
      </div>
    </Panel>
  );
}

function MembersSection() {
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: profiles = [] } = useProfiles();
  const { data: roles = [] } = useQuery({
    queryKey: ["user_roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*");
      if (error) throw error;
      return data;
    },
  });
  const { data: allowed = [] } = useQuery({
    queryKey: ["allowed_emails"],
    queryFn: async () => {
      const { data, error } = await supabase.from("allowed_emails").select("*").order("invited_at", { ascending: false });
      if (error) return [];
      return data;
    },
  });

  const isOwner = roles.some((r) => r.user_id === user?.id && r.role === "owner");

  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () => {
      const e = email.trim().toLowerCase();
      if (!e) throw new Error("Email required");
      const { error: addErr } = await supabase.from("allowed_emails").upsert({
        email: e, role: "member", invited_by: user?.id ?? null,
      });
      if (addErr) throw addErr;
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: e, options: { emailRedirectTo: `${window.location.origin}/pipeline` },
      });
      if (otpErr) throw otpErr;
    },
    onSuccess: () => {
      setEmail(""); setErr(null);
      qc.invalidateQueries({ queryKey: ["allowed_emails"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (em: string) => {
      const profile = profiles.find((p) => p.email === em);
      if (profile) {
        await supabase.from("user_roles").delete().eq("user_id", profile.id);
      }
      await supabase.from("allowed_emails").delete().eq("email", em);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowed_emails"] });
      qc.invalidateQueries({ queryKey: ["user_roles"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  if (!isOwner) {
    return (
      <Panel>
        <PanelHeader>MEMBERS</PanelHeader>
        <div className="p-3 mono text-xs text-[var(--text-muted)]">Owner-only section.</div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader>MEMBERS</PanelHeader>
      <div className="p-3 space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="flex gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="invite@email.com" required />
          <Button type="submit" variant="primary" disabled={invite.isPending}>
            {invite.isPending ? "SENDING…" : "INVITE"}
          </Button>
        </form>
        {err && <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">{err}</div>}

        <div className="border border-[var(--border)]">
          {allowed.map((a) => {
            const profile = profiles.find((p) => p.email === a.email);
            const role = roles.find((r) => r.user_id === profile?.id)?.role ?? a.role;
            return (
              <div key={a.email} className="flex items-center gap-3 border-b border-[var(--border)] last:border-b-0 px-3 py-2">
                <span className="mono text-sm flex-1">{a.email}</span>
                <Badge variant={role === "owner" ? "accent" : "muted"}>{role.toUpperCase()}</Badge>
                <Badge variant={profile ? "success" : "warning"}>{profile ? "ACTIVE" : "PENDING"}</Badge>
                {role !== "owner" && (
                  <button onClick={() => confirm(`Remove ${a.email}?`) && removeMember.mutate(a.email)} className="text-[var(--text-muted)] hover:text-[var(--danger)] text-xs">REMOVE</button>
                )}
              </div>
            );
          })}
          {allowed.length === 0 && <div className="p-3 mono text-xs text-[var(--text-muted)]">No invites yet.</div>}
        </div>
      </div>
    </Panel>
  );
}

function SequencesSection() {
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: sequences = [] } = useSequences();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sequences").insert({ name, created_by: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["sequences"] }); },
  });

  return (
    <Panel>
      <PanelHeader>SEQUENCES · {sequences.length}</PanelHeader>
      <div className="p-3 space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Luxury Agent Flow" required />
          <Button type="submit" variant="primary" disabled={create.isPending}>+ NEW</Button>
        </form>
        <div className="space-y-3">
          {sequences.map((s) => <SequenceEditor key={s.id} sequence={s} />)}
        </div>
      </div>
    </Panel>
  );
}

function SequenceEditor({ sequence }: { sequence: { id: string; name: string; sequence_steps: { id: string; day_offset: number; instructions: string; link_urls: string[]; order_index: number }[] } }) {
  const qc = useQueryClient();
  const steps = [...sequence.sequence_steps].sort((a, b) => a.order_index - b.order_index || a.day_offset - b.day_offset);

  const addStep = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sequence_steps").insert({
        sequence_id: sequence.id, day_offset: (steps.at(-1)?.day_offset ?? 0) + 3,
        instructions: "", link_urls: [], order_index: steps.length,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequences"] }),
  });
  const updateStep = useMutation({
    mutationFn: async (patch: { id: string; day_offset?: number; instructions?: string; link_urls?: string[] }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("sequence_steps").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequences"] }),
  });
  const deleteStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sequence_steps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequences"] }),
  });
  const deleteSeq = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sequences").delete().eq("id", sequence.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequences"] }),
  });

  return (
    <div className="border border-[var(--border-strong)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="mono text-sm">{sequence.name}</span>
        <div className="flex gap-2">
          <button onClick={() => addStep.mutate()} className="text-[var(--accent)] text-xs">+ STEP</button>
          <button onClick={() => confirm("Delete sequence?") && deleteSeq.mutate()} className="text-[var(--danger)] text-xs">DELETE</button>
        </div>
      </div>
      <div>
        {steps.map((st) => (
          <div key={st.id} className="border-b border-[var(--border)] last:border-b-0 p-3 grid grid-cols-12 gap-2 items-start">
            <div className="col-span-2">
              <Label>DAY +</Label>
              <Input type="number" defaultValue={st.day_offset} onBlur={(e) => updateStep.mutate({ id: st.id, day_offset: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className="col-span-9">
              <Label>INSTRUCTIONS</Label>
              <Textarea rows={2} defaultValue={st.instructions} onBlur={(e) => updateStep.mutate({ id: st.id, instructions: e.target.value })} />
              <Label className="mt-2">LINKS (one per line)</Label>
              <Textarea rows={2} defaultValue={st.link_urls.join("\n")} onBlur={(e) => updateStep.mutate({ id: st.id, link_urls: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })} />
            </div>
            <div className="col-span-1 flex justify-end">
              <button onClick={() => deleteStep.mutate(st.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">×</button>
            </div>
          </div>
        ))}
        {steps.length === 0 && <div className="p-3 mono text-xs text-[var(--text-muted)]">No steps yet.</div>}
      </div>
    </div>
  );
}

function InstagramSection() {
  return (
    <Panel>
      <PanelHeader>
        <span>INSTAGRAM INTEGRATION</span>
        <Badge variant="warning">PHASE 3</Badge>
      </PanelHeader>
      <div className="p-3 space-y-3">
        <p className="text-sm text-[var(--text-dim)]">
          Live message sync with Instagram is planned for Phase 3 and only covers <span className="text-[var(--text)]">replies</span> from prospects who responded to you. Cold opener DMs and follow-ups to non-responders stay manual — Meta's API does not allow unsolicited messages.
        </p>
        <div className="mono text-xs text-[var(--text-muted)] border border-[var(--border-strong)] p-3 space-y-1">
          <div>REQUIREMENTS:</div>
          <div>• Instagram Business or Creator account</div>
          <div>• Linked Facebook Page</div>
          <div>• Meta Developer App + App Review (1–4 weeks)</div>
          <div>• 24h customer-initiated reply window</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled>CONNECT META ACCOUNT</Button>
          <Button variant="outline" disabled>SYNC MESSAGES NOW</Button>
        </div>
      </div>
    </Panel>
  );
}
