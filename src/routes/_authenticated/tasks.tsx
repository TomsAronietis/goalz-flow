import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useFollowUps, useProfiles, useProspects } from "@/lib/queries";
import { Badge, Panel, Select } from "@/components/term";
import { initials, smartDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { data: followUps = [] } = useFollowUps();
  const { data: prospects = [] } = useProspects();
  const { data: profiles = [] } = useProfiles();
  const [filter, setFilter] = useState<string>("me");
  const nav = useNavigate();

  const assignee = filter === "me" ? user?.id : filter === "all" ? null : filter;

  const filtered = useMemo(() => {
    let rows = followUps.filter((f) => !f.completed_at);
    if (assignee) rows = rows.filter((f) => f.assigned_to === assignee);
    return rows;
  }, [followUps, assignee]);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = filtered.filter((f) => f.due_date < today);
  const dueToday = filtered.filter((f) => f.due_date === today);
  const upcoming = filtered.filter((f) => f.due_date > today);

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("follow_ups")
        .update({ completed_at: new Date().toISOString(), completed_by: user?.id ?? null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_ups"] }),
  });

  function Row({ f }: { f: (typeof followUps)[number] }) {
    const p = prospects.find((x) => x.id === f.prospect_id);
    const profile = profiles.find((x) => x.id === f.assigned_to);
    return (
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-2)]">
        <button
          onClick={(e) => { e.stopPropagation(); complete.mutate(f.id); }}
          className="w-4 h-4 border border-[var(--border-strong)] hover:border-[var(--accent)]"
          title="Mark complete"
        />
        <span className="mono text-[11px] text-[var(--text-muted)] w-24">{f.due_date}</span>
        <button
          onClick={() => p && nav({ to: "/prospects/$id", params: { id: p.id } })}
          className="mono text-sm text-[var(--text)] hover:text-[var(--accent)] w-40 text-left truncate"
        >
          @{p?.ig_handle ?? "—"}
        </button>
        <span className="text-sm text-[var(--text-dim)] flex-1 truncate">{f.instructions || "—"}</span>
        {profile && (
          <span className="mono text-[10px] text-[var(--text-dim)] border border-[var(--border)] px-1.5 py-0.5">
            {initials(profile.display_name, profile.email)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="label">TASKS</div>
          <h1 className="text-lg font-semibold mt-0.5">
            {overdue.length + dueToday.length} active · {upcoming.length} upcoming
          </h1>
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56">
          <option value="me">ASSIGNED TO ME</option>
          <option value="all">ALL ASSIGNEES</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
          ))}
        </Select>
      </div>

      <div className="space-y-4">
        <Section title="OVERDUE" count={overdue.length} variant="danger">
          {overdue.map((f) => <Row key={f.id} f={f} />)}
          {overdue.length === 0 && <Empty />}
        </Section>
        <Section title="DUE TODAY" count={dueToday.length} variant="accent">
          {dueToday.map((f) => <Row key={f.id} f={f} />)}
          {dueToday.length === 0 && <Empty />}
        </Section>
        <Section title="UPCOMING" count={upcoming.length}>
          {upcoming.map((f) => <Row key={f.id} f={f} />)}
          {upcoming.length === 0 && <Empty />}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, count, variant, children }: { title: string; count: number; variant?: "danger" | "accent"; children: React.ReactNode }) {
  return (
    <Panel>
      <div className="label flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className={variant === "danger" ? "text-[var(--danger)]" : variant === "accent" ? "text-[var(--accent)]" : "text-[var(--text)]"}>
          {title}
        </span>
        <Badge variant={variant ?? "muted"}>{count}</Badge>
      </div>
      <div>{children}</div>
    </Panel>
  );
}

function Empty() {
  return <div className="mono text-xs text-[var(--text-muted)] px-3 py-4">— No tasks —</div>;
}
