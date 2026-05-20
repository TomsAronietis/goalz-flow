import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useCurrentAlliance } from "@/hooks/use-alliance";
import { useSequences } from "@/lib/queries";
import { Badge, Button, Input, Label, Panel, PanelHeader, Textarea } from "@/components/term";
import { smartDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { current } = useCurrentAlliance();
  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <div className="label">SETTINGS</div>
        <h1 className="text-lg font-semibold mt-0.5">{current?.name ?? "Workspace"}</h1>
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
  const { current } = useCurrentAlliance();
  const allianceId = current?.alliance_id;
  const { data } = useQuery({
    queryKey: ["settings", "outreach_strategy", allianceId],
    enabled: !!allianceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("settings")
        .select("*")
        .eq("alliance_id", allianceId!)
        .eq("key", "outreach_strategy")
        .maybeSingle();
      return data;
    },
  });
  const [text, setText] = useState("");
  useEffect(() => { if (data?.value) setText((data.value as { text?: string }).text ?? ""); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!allianceId) throw new Error("No active alliance.");
      const { error } = await supabase.from("settings").upsert({
        alliance_id: allianceId,
        key: "outreach_strategy",
        value: { text },
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "outreach_strategy", allianceId] }),
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
  const { current } = useCurrentAlliance();
  const allianceId = current?.alliance_id;
  const isOwner = current?.role === "owner";

  const { data: members = [] } = useQuery({
    queryKey: ["alliance_members", allianceId],
    enabled: !!allianceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alliance_members")
        .select("user_id, role, joined_at, profiles(email, display_name)")
        .eq("alliance_id", allianceId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["alliance_invites", allianceId],
    enabled: !!allianceId && isOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alliance_invites")
        .select("*")
        .eq("alliance_id", allianceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () => {
      if (!allianceId) throw new Error("No active alliance.");
      const e = email.trim().toLowerCase();
      if (!e) throw new Error("Email required");
      const { error } = await supabase.from("alliance_invites").insert({
        alliance_id: allianceId,
        email: e,
        role: "member",
        invited_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail(""); setErr(null);
      qc.invalidateQueries({ queryKey: ["alliance_invites", allianceId] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alliance_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alliance_invites", allianceId] }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("alliance_members")
        .delete()
        .eq("alliance_id", allianceId!)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alliance_members", allianceId] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  function inviteUrl(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/login?invite=${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
    } catch {
      // ignore
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <span>MEMBERS · {members.length}</span>
        {!isOwner && <Badge variant="muted">VIEW ONLY</Badge>}
      </PanelHeader>
      <div className="p-3 space-y-4">
        <div className="border border-[var(--border)]">
          {members.map((m) => {
            type ProfileRel = { email: string; display_name: string | null } | null;
            const profile = (m as unknown as { profiles: ProfileRel }).profiles;
            return (
              <div key={m.user_id} className="flex items-center gap-3 border-b border-[var(--border)] last:border-b-0 px-3 py-2">
                <span className="mono text-sm flex-1">{profile?.display_name || profile?.email || m.user_id.slice(0, 8)}</span>
                <span className="mono text-[11px] text-[var(--text-muted)]">{profile?.email}</span>
                <Badge variant={m.role === "owner" ? "accent" : "muted"}>{m.role.toUpperCase()}</Badge>
                {isOwner && m.role !== "owner" && m.user_id !== user?.id && (
                  <button
                    onClick={() => confirm(`Remove ${profile?.email ?? "this member"}?`) && removeMember.mutate(m.user_id)}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] text-xs"
                  >
                    REMOVE
                  </button>
                )}
              </div>
            );
          })}
          {members.length === 0 && <div className="p-3 mono text-xs text-[var(--text-muted)]">No members yet.</div>}
        </div>

        {isOwner && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="flex gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="invite@email.com"
                required
              />
              <Button type="submit" variant="primary" disabled={invite.isPending}>
                {invite.isPending ? "CREATING…" : "+ INVITE"}
              </Button>
            </form>
            {err && <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">{err}</div>}

            {invites.length > 0 && (
              <div>
                <div className="label mb-2">PENDING INVITES · {invites.filter((i) => !i.accepted_at).length}</div>
                <div className="border border-[var(--border)]">
                  {invites.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 border-b border-[var(--border)] last:border-b-0 px-3 py-2">
                      <span className="mono text-sm flex-1 truncate">{i.email}</span>
                      <Badge variant={i.accepted_at ? "success" : new Date(i.expires_at) < new Date() ? "danger" : "warning"}>
                        {i.accepted_at ? "ACCEPTED" : new Date(i.expires_at) < new Date() ? "EXPIRED" : "PENDING"}
                      </Badge>
                      {!i.accepted_at && (
                        <>
                          <button
                            onClick={() => copyLink(i.token)}
                            className="mono text-[11px] text-[var(--accent)] hover:underline"
                            title={inviteUrl(i.token)}
                          >
                            COPY LINK
                          </button>
                          <button
                            onClick={() => revokeInvite.mutate(i.id)}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] text-xs"
                          >
                            REVOKE
                          </button>
                        </>
                      )}
                      <span className="mono text-[10px] text-[var(--text-muted)]">{smartDate(i.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function SequencesSection() {
  const qc = useQueryClient();
  const { user } = useSession();
  const { current } = useCurrentAlliance();
  const allianceId = current?.alliance_id;
  const { data: sequences = [] } = useSequences();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!allianceId) throw new Error("No active alliance.");
      const { error } = await supabase.from("sequences").insert({
        alliance_id: allianceId,
        name,
        created_by: user?.id ?? null,
      });
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
