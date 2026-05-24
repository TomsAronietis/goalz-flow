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
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useCurrentAlliance } from "@/hooks/use-alliance";
import {
  useFollowUps,
  usePipelineStages,
  useProfiles,
  DEFAULT_PIPELINE_STAGE_NAMES,
  useProspects,
  type PipelineStage,
  type Prospect,
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
  const { current } = useCurrentAlliance();
  const { data: stages = [] } = usePipelineStages(current?.alliance_id);
  const { data: followUps = [] } = useFollowUps();
  const { data: profiles = [] } = useProfiles();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [newStage, setNewStage] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    async function ensureDefaultStages() {
      if (!current || stages.length > 0) return;
      const payload = DEFAULT_PIPELINE_STAGE_NAMES.map((name, i) => ({
        alliance_id: current.alliance_id,
        name,
        order_index: i,
      }));
      const { error } = await supabase.from("pipeline_stages").insert(payload);
      if (!error) {
        qc.invalidateQueries({ queryKey: ["pipeline_stages", current.alliance_id] });
      }
    }
    ensureDefaultStages();
  }, [current, stages.length, qc]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const filteredProspects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return prospects;
    return prospects.filter((p) => {
      const hay = [p.ig_handle, p.first_name, p.location, p.bio, p.notes, p.email, p.niche, p.brokerage]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) return true;
      return needle.split(/\s+/).every((token) => hay.includes(token));
    });
  }, [prospects, search]);

  const grouped = useMemo(() => {
    const out: Record<string, Prospect[]> = {};
    for (const stage of stages) out[stage.id] = [];
    for (const p of filteredProspects) if (p.stage_id && out[p.stage_id]) out[p.stage_id].push(p);
    return out;
  }, [filteredProspects, stages]);

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

  const setStage = useMutation({
    mutationFn: async ({ id, stageId }: { id: string; stageId: string }) => {
      const { error } = await supabase.from("prospects").update({ stage_id: stageId }).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["prospects"] }),
  });

  const createStage = useMutation({
    mutationFn: async () => {
      if (!current || !newStage.trim()) return;
      const { error } = await supabase.from("pipeline_stages").insert({
        alliance_id: current.alliance_id,
        name: newStage.trim(),
        order_index: stages.length,
      });
      if (error) throw error;
    },
    onSuccess: () => { setNewStage(""); qc.invalidateQueries({ queryKey: ["pipeline_stages", current?.alliance_id ?? "none"] }); },
  });

  const renameStage = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("pipeline_stages").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pipeline_stages", current?.alliance_id ?? "none"] }),
  });

  const deleteStage = useMutation({
    mutationFn: async (stage: PipelineStage) => {
      const fallback = stages.find((s) => s.id !== stage.id);
      if (!fallback) throw new Error("At least one stage is required.");
      await supabase.from("prospects").update({ stage_id: fallback.id }).eq("stage_id", stage.id);
      const { error } = await supabase.from("pipeline_stages").delete().eq("id", stage.id);
      if (error) throw error;
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["pipeline_stages", current?.alliance_id ?? "none"] }); qc.invalidateQueries({ queryKey: ["prospects"] }); },
  });

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const stageId = e.over?.id as string | undefined;
    if (!stageId) return;
    const p = prospects.find((x) => x.id === id);
    if (!p || p.stage_id === stageId) return;
    setStage.mutate({ id, stageId });
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
      <div className="flex gap-2 mb-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Smart search (handle, name, niche, notes, bio...)" />
      </div>
      <div className="flex gap-2 mb-4">
        <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Add pipeline stage (e.g. Send DM)" />
        <Button onClick={() => createStage.mutate()} disabled={!newStage.trim()}>ADD STAGE</Button>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {stages.map((s) => (
            <Column
              key={s.id}
              stage={s}
              prospects={grouped[s.id] ?? []}
              overdueByProspect={overdueByProspect}
              profiles={profiles}
              onRename={(name) => renameStage.mutate({ id: s.id, name })}
              onDelete={() => deleteStage.mutate(s)}
              onClick={(id) => nav({ to: "/prospects/$id", params: { id } })}
            />
          ))}
        </div>
      </DndContext>

      <AddProspectModal open={adding} onClose={() => setAdding(false)} />
      <ImportProspectsModal open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function Column({
  stage, prospects, overdueByProspect, profiles, onRename, onDelete, onClick,
}: {
  stage: PipelineStage;
  prospects: Prospect[];
  overdueByProspect: Map<string, number>;
  profiles: { id: string; email: string; display_name: string | null }[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div ref={setNodeRef} className={`border ${isOver ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <div className="label flex items-center justify-between px-3 py-2 border-b border-[var(--border)] gap-2">
        <input className="bg-transparent text-[var(--text)] w-full" value={stage.name} onChange={(e) => onRename(e.target.value)} />
        <button className="text-[var(--danger)]" onClick={onDelete}>×</button>
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

function AddProspectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { current } = useCurrentAlliance();
  const { data: stages = [] } = usePipelineStages(current?.alliance_id);
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
      const defaultStage = stages[0];
      const { error } = await supabase.from("prospects").insert({
        alliance_id: current.alliance_id,
        stage_id: defaultStage?.id ?? null,
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
