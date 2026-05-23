import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useCurrentAlliance } from "@/hooks/use-alliance";
import {
  STATUSES,
  STATUS_LABEL,
  useFollowUps,
  useProfiles,
  useProspects,
  type Prospect,
  type ProspectStatus,
} from "@/lib/queries";
import { Badge, Button, Input, Label, Modal, Panel, Select, Textarea } from "@/components/term";
import { initials, parseIgHandle, smartDate } from "@/lib/format";
import { ImportProspectsModal } from "@/components/import-prospects-modal";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

function PipelinePage() {
  const qc = useQueryClient();
  const { data: prospects = [] } = useProspects();
  const { data: followUps = [] } = useFollowUps();
  const { data: profiles = [] } = useProfiles();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const nav = useNavigate();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => {
    const out: Record<ProspectStatus, Prospect[]> = {
      researched: [], dm_sent: [], responded: [], call_booked: [], closed: [],
    };
    for (const p of prospects) out[p.status].push(p);
    return out;
  }, [prospects]);

  const overdueByProspect = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, number>();
    for (const f of followUps) {
      if (!f.completed_at && f.due_date <= today) {
        map.set(f.prospect_id, (map.get(f.prospect_id) ?? 0) + 1);
      }
    }
    return map;
  }, [followUps]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProspectStatus }) => {
      const { error } = await supabase.from("prospects").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["prospects"] });
      const prev = qc.getQueryData<Prospect[]>(["prospects"]);
      qc.setQueryData<Prospect[]>(["prospects"], (cur) =>
        cur?.map((p) => (p.id === id ? { ...p, status } : p)) ?? [],
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["prospects"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["prospects"] }),
  });

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const status = e.over?.id as ProspectStatus | undefined;
    if (!status) return;
    const p = prospects.find((x) => x.id === id);
    if (!p || p.status === status) return;
    setStatus.mutate({ id, status });
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="label">PIPELINE</div>
          <h1 className="text-lg font-semibold mt-0.5">{prospects.length} prospects</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setImporting(true)}>IMPORT CSV/XLSX</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>+ ADD PROSPECT</Button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {STATUSES.map((s) => (
            <Column
              key={s}
              status={s}
              prospects={grouped[s]}
              overdueByProspect={overdueByProspect}
              profiles={profiles}
              onClick={(id) => nav({ to: "/prospects/$id", params: { id } })}
            />
          ))}
        </div>
      </DndContext>

      <AddProspectModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Column({
  status, prospects, overdueByProspect, profiles, onClick,
}: {
  status: ProspectStatus;
  prospects: Prospect[];
  overdueByProspect: Map<string, number>;
  profiles: { id: string; email: string; display_name: string | null }[];
  onClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`border ${isOver ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <div className="label flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[var(--text)]">{STATUS_LABEL[status]}</span>
        <span className="text-[var(--text-muted)]">{prospects.length}</span>
      </div>
      <div className="p-2 space-y-2 min-h-[120px]">
        {prospects.map((p) => (
          <ProspectCard
            key={p.id}
            prospect={p}
            overdue={overdueByProspect.get(p.id) ?? 0}
            profile={profiles.find((x) => x.id === p.assigned_to)}
            onClick={() => onClick(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProspectCard({
  prospect, overdue, profile, onClick,
}: {
  prospect: Prospect;
  overdue: number;
  profile?: { email: string; display_name: string | null };
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: prospect.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`group cursor-pointer border border-[var(--border-strong)] bg-[var(--surface-2)] p-2.5 hover:border-[var(--accent)] ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-sm text-[var(--text)] truncate">@{prospect.ig_handle}</div>
        {overdue > 0 && <Badge variant="danger">{overdue} OVERDUE</Badge>}
      </div>
      {prospect.first_name && (
        <div className="text-xs text-[var(--text-dim)] mt-0.5 truncate">{prospect.first_name}</div>
      )}
      <div className="mono text-[10px] text-[var(--text-muted)] mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
        {prospect.location && <span>{prospect.location}</span>}
        {prospect.follower_count != null && <span>{prospect.follower_count.toLocaleString()} FLW</span>}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]">
        <span className="mono text-[10px] text-[var(--text-muted)]">
          {prospect.last_contacted_at
            ? `LAST: ${smartDate(prospect.last_contacted_at)}`
            : `ADDED ${smartDate(prospect.created_at)}`}
        </span>
        {profile && (
          <span className="mono text-[10px] text-[var(--text-dim)] border border-[var(--border)] px-1.5 py-0.5">
            {initials(profile.display_name, profile.email)}
          </span>
        )}
      </div>
    </div>
  );
}

function AddProspectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { current } = useCurrentAlliance();
  const [igUrl, setIgUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [firstName, setFirstName] = useState("");
  const [location, setLocation] = useState("");
  const [followers, setFollowers] = useState("");
  const [bio, setBio] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setIgUrl(""); setWebsite(""); setFirstName(""); setLocation(""); setFollowers(""); setBio(""); setErr(null);
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No active alliance.");
      const handle = parseIgHandle(igUrl);
      if (!handle) throw new Error("Could not parse Instagram handle from URL.");
      const { error } = await supabase.from("prospects").insert({
        alliance_id: current.alliance_id,
        ig_handle: handle,
        ig_url: igUrl.trim(),
        website_url: website.trim() || null,
        first_name: firstName.trim() || null,
        location: location.trim() || null,
        follower_count: followers ? parseInt(followers, 10) : null,
        bio: bio.trim() || null,
        created_by: user?.id ?? null,
        assigned_to: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      reset(); onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="ADD PROSPECT">
      <form
        onSubmit={(e) => { e.preventDefault(); setErr(null); create.mutate(); }}
        className="space-y-3"
      >
        <div>
          <Label>INSTAGRAM URL *</Label>
          <Input required value={igUrl} onChange={(e) => setIgUrl(e.target.value)} placeholder="https://instagram.com/handle" />
        </div>
        <div>
          <Label>WEBSITE URL</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>FIRST NAME</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>LOCATION</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>FOLLOWER COUNT</Label>
          <Input type="number" value={followers} onChange={(e) => setFollowers(e.target.value)} />
        </div>
        <div>
          <Label>BIO</Label>
          <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        {err && <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>CANCEL</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? "SAVING…" : "CREATE"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
