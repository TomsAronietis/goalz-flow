import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { enrichProspect } from "@/lib/enrich.functions";
import { verifyProspect } from "@/lib/verify.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useCurrentAlliance } from "@/hooks/use-alliance";
import {
  STATUSES, STATUS_LABEL,
  useFollowUps, useMessages, useProfiles, useProspect, useSequences,
  type ProspectStatus,
} from "@/lib/queries";
import { Badge, Button, Input, Label, Panel, PanelHeader, Select, Textarea } from "@/components/term";
import { smartDate, ymd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/prospects/$id")({
  component: ProspectPage,
});

function ProspectPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useSession();
  const { current } = useCurrentAlliance();
  const { data: p, isLoading } = useProspect(id);
  const { data: followUps = [] } = useFollowUps(id);
  const { data: messages = [] } = useMessages(id);
  const { data: profiles = [] } = useProfiles();
  const { data: sequences = [] } = useSequences();

  const [intel, setIntel] = useState(""); const [gaps, setGaps] = useState("");
  const [dm, setDm] = useState(""); const [notes, setNotes] = useState("");
  const [enrichStartedAt, setEnrichStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (p) { setIntel(p.intel_brief ?? ""); setGaps(p.website_gaps ?? ""); setDm(p.dm_copy ?? ""); setNotes(p.notes ?? ""); }
  }, [p]);

  const update = useMutation({
    mutationFn: async (patch: Partial<NonNullable<typeof p>>) => {
      const { error } = await supabase.from("prospects").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects", id] });
    },
  });

  const logDm = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No active alliance.");
      const { error } = await supabase.from("messages_log").insert({
        alliance_id: current.alliance_id,
        prospect_id: id, summary: "DM sent", created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects", id] });
    },
  });

  const applySequence = useMutation({
    mutationFn: async (sequenceId: string) => {
      if (!current) throw new Error("No active alliance.");
      const seq = sequences.find((s) => s.id === sequenceId);
      if (!seq) throw new Error("Sequence not found");
      const start = new Date();
      const rows = (seq.sequence_steps ?? []).map((s) => {
        const d = new Date(start); d.setDate(d.getDate() + s.day_offset);
        return {
          alliance_id: current.alliance_id,
          prospect_id: id, sequence_step_id: s.id, due_date: ymd(d),
          instructions: s.instructions, link_urls: s.link_urls,
          assigned_to: p?.assigned_to ?? user?.id ?? null, order_index: s.order_index,
        };
      });
      if (rows.length) {
        const { error } = await supabase.from("follow_ups").insert(rows);
        if (error) throw error;
      }
      await supabase.from("prospects").update({
        applied_sequence_id: sequenceId, sequence_started_at: start.toISOString(),
      }).eq("id", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow_ups"] });
      qc.invalidateQueries({ queryKey: ["prospects", id] });
    },
  });

  const completeFu = useMutation({
    mutationFn: async (fuId: string) => {
      const { error } = await supabase.from("follow_ups").update({
        completed_at: new Date().toISOString(), completed_by: user?.id ?? null,
      }).eq("id", fuId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_ups"] }),
  });

  const deleteFu = useMutation({
    mutationFn: async (fuId: string) => {
      const { error } = await supabase.from("follow_ups").delete().eq("id", fuId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_ups"] }),
  });

  const deleteProspect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("prospects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      nav({ to: "/pipeline" });
    },
  });

  const enrichFn = useServerFn(enrichProspect);
  const enrich = useMutation({
    mutationFn: async () => {
      setEnrichStartedAt(Date.now());
      await enrichFn({ data: { prospectId: id } });
    },
    onSuccess: () => {
      setEnrichStartedAt(null);
      setElapsedSec(0);
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects", id] });
    },
    onError: () => {
      setEnrichStartedAt(null);
      setElapsedSec(0);
    },
  });

  useEffect(() => {
    if (!enrich.isPending || !enrichStartedAt) return;
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - enrichStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [enrich.isPending, enrichStartedAt]);

  const verifyFn = useServerFn(verifyProspect);
  const verify = useMutation({
    mutationFn: async () => {
      await verifyFn({ data: { prospectId: id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects", id] });
    },
  });

  if (isLoading || !p) {
    return <div className="p-6 mono text-xs text-[var(--text-muted)]">LOADING…</div>;
  }

  const completedSteps = followUps.filter((f) => f.sequence_step_id && f.completed_at).length;
  const totalSteps = followUps.filter((f) => f.sequence_step_id).length;
  const nextStep = followUps.find((f) => !f.completed_at && f.sequence_step_id);

  const confidence = p.verification_confidence ?? null;
  const confColor =
    confidence == null ? "" :
    confidence >= 80 ? "var(--accent)" :
    confidence >= 50 ? "#d4a017" : "var(--danger)";

  const enrichStages = [
    { name: "Scraping Instagram", eta: 8 },
    { name: "Scraping website pages", eta: 18 },
    { name: "Analyzing with AI", eta: 35 },
    { name: "Quality retry/check", eta: 50 },
    { name: "Saving enriched profile", eta: 60 },
  ];
  const totalEta = enrichStages[enrichStages.length - 1].eta;
  const currentStage =
    enrichStages.find((stage, idx) => {
      const next = enrichStages[idx + 1];
      return elapsedSec >= stage.eta && (!next || elapsedSec < next.eta);
    }) ?? enrichStages[0];
  const etaLeft = Math.max(0, totalEta - elapsedSec);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Link to="/pipeline" className="mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← PIPELINE</Link>
        <div className="flex gap-2 items-center flex-wrap justify-end">
          {p.enriched_at && (
            <span title={`Enriched ${smartDate(p.enriched_at)}`}>
              <Badge variant="success">✓ ENRICHED</Badge>
            </span>
          )}
          {p.verified_at && (
            <span title={`Verified ${smartDate(p.verified_at)}${confidence != null ? ` · ${confidence}% confidence` : ""}`}>
              <Badge variant="success">
                ✓✓ VERIFIED{confidence != null ? ` ${confidence}%` : ""}
              </Badge>
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => enrich.mutate()}
            disabled={enrich.isPending}
            title="Scrapes IG + website, fills empty fields via AI"
          >
            {enrich.isPending ? "ENRICHING…" : (p.enriched_at ? "RE-ENRICH" : "✨ AUTO-ENRICH")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => verify.mutate()}
            disabled={verify.isPending || !p.enriched_at}
            title={p.enriched_at ? "Re-scrape sources & fact-check stored data" : "Run AUTO-ENRICH first"}
          >
            {verify.isPending ? "VERIFYING…" : (p.verified_at ? "🔍 RE-VERIFY" : "🔍 VERIFY")}
          </Button>
          <Button variant="danger" size="sm" onClick={() => confirm("Delete prospect?") && deleteProspect.mutate()}>DELETE</Button>
        </div>
      </div>
      {enrich.isError && (
        <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2 mb-3">
          {(enrich.error as Error).message}
        </div>
      )}
      {enrich.isPending && (
        <Panel className="mb-3">
          <PanelHeader>
            <span>AI RESEARCH STATUS</span>
            <span className="mono text-[10px] text-[var(--text-muted)]">
              ELAPSED {elapsedSec}s · EST LEFT {etaLeft}s
            </span>
          </PanelHeader>
          <div className="p-3 space-y-2">
            <div className="mono text-xs text-[var(--text)]">
              Current stage: <span className="text-[var(--accent)]">{currentStage.name}</span>
            </div>
            <div className="h-2 bg-[var(--surface-2)] border border-[var(--border)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.floor((elapsedSec / totalEta) * 100))}%` }} />
            </div>
            <div className="mono text-[10px] text-[var(--text-muted)]">
              Stages: {enrichStages.map((s) => s.name).join(" → ")}
            </div>
          </div>
        </Panel>
      )}
      {verify.isError && (
        <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2 mb-3">
          {(verify.error as Error).message}
        </div>
      )}
      {p.verified_at && p.verification_notes && (
        <Panel className="mb-3">
          <PanelHeader>
            <span>VERIFICATION REPORT</span>
            <span className="mono text-[10px] text-[var(--text-muted)]">
              {smartDate(p.verified_at)}
              {confidence != null && (
                <> · <span style={{ color: confColor }}>{confidence}% CONFIDENCE</span></>
              )}
            </span>
          </PanelHeader>
          <div className="p-3 mono text-xs text-[var(--text-dim)] whitespace-pre-wrap">
            {p.verification_notes}
          </div>
        </Panel>
      )}

      {/* Header strip */}
      <Panel className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-[var(--border)]">
          <Cell label="HANDLE" value={`@${p.ig_handle}`} link={p.ig_url} />
          <Cell label="NAME" value={p.first_name} />
          <Cell label="LOCATION" value={p.location} />
          <Cell label="FOLLOWERS" value={p.follower_count?.toLocaleString()} />
          <Cell label="LAST CONTACT" value={p.last_contacted_at ? smartDate(p.last_contacted_at) : "—"} />
          <div className="bg-[var(--surface)] p-3">
            <div className="label mb-1">STATUS</div>
            <Select value={p.status} onChange={(e) => update.mutate({ status: e.target.value as ProspectStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-[var(--border)] border-t border-[var(--border)]">
          <div className="bg-[var(--surface)] p-3">
            <div className="label mb-1">ASSIGNED TO</div>
            <Select value={p.assigned_to ?? ""} onChange={(e) => update.mutate({ assigned_to: e.target.value || null })}>
              <option value="">— UNASSIGNED —</option>
              {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.display_name || pr.email}</option>)}
            </Select>
          </div>
          <div className="bg-[var(--surface)] p-3">
            <div className="label mb-1">WEBSITE</div>
            {p.website_url ? (
              <a href={p.website_url} target="_blank" rel="noreferrer" className="mono text-sm text-[var(--accent)] truncate block">{p.website_url}</a>
            ) : <div className="mono text-sm text-[var(--text-muted)]">—</div>}
          </div>
          <div className="bg-[var(--surface)] p-3 flex items-end">
            <Button variant="primary" onClick={() => logDm.mutate()} disabled={logDm.isPending} className="w-full">
              {logDm.isPending ? "LOGGING…" : "+ LOG DM SENT"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border)] border-t border-[var(--border)]">
          <Cell label="NICHE" value={p.niche} />
          <Cell label="BROKERAGE" value={p.brokerage} />
          <Cell label="EMAIL" value={p.email} link={p.email ? `mailto:${p.email}` : null} />
          <Cell label="PHONE" value={p.phone} link={p.phone ? `tel:${p.phone}` : null} />
        </div>
        {(p.awards?.length || p.press_mentions?.length) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--border)] border-t border-[var(--border)]">
            <div className="bg-[var(--surface)] p-3">
              <div className="label mb-1">AWARDS</div>
              {p.awards?.length ? (
                <ul className="mono text-xs text-[var(--text-dim)] space-y-0.5">
                  {p.awards.map((a, i) => <li key={i}>• {a}</li>)}
                </ul>
              ) : <div className="mono text-sm text-[var(--text-muted)]">—</div>}
            </div>
            <div className="bg-[var(--surface)] p-3">
              <div className="label mb-1">PRESS MENTIONS</div>
              {p.press_mentions?.length ? (
                <ul className="mono text-xs text-[var(--text-dim)] space-y-0.5">
                  {p.press_mentions.map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
              ) : <div className="mono text-sm text-[var(--text-muted)]">—</div>}
            </div>
          </div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: editable text fields */}
        <div className="lg:col-span-2 space-y-4">
          <EditPanel title="INTEL BRIEF" value={intel} onChange={setIntel}
            onSave={() => update.mutate({ intel_brief: intel })} />
          <EditPanel title="WEBSITE GAPS" value={gaps} onChange={setGaps}
            onSave={() => update.mutate({ website_gaps: gaps })} />
          <EditPanel title="DM COPY" value={dm} onChange={setDm}
            onSave={() => update.mutate({ dm_copy: dm })} />
          <EditPanel title="NOTES" value={notes} onChange={setNotes}
            onSave={() => update.mutate({ notes: notes })} />

          {p.bio && (
            <Panel>
              <PanelHeader>BIO</PanelHeader>
              <div className="p-3 mono text-sm text-[var(--text-dim)] whitespace-pre-wrap">{p.bio}</div>
            </Panel>
          )}

          <Panel>
            <PanelHeader>MESSAGE LOG · {messages.length}</PanelHeader>
            <div>
              {messages.length === 0 && <div className="mono text-xs text-[var(--text-muted)] p-3">— No messages logged —</div>}
              {messages.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                  <span className="mono text-[11px] text-[var(--text-muted)] w-44">{new Date(m.sent_at).toLocaleString()}</span>
                  <span className="text-sm text-[var(--text-dim)]">{m.summary}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Right: sequence + follow-ups */}
        <div className="space-y-4">
          <Panel>
            <PanelHeader>SEQUENCE</PanelHeader>
            <div className="p-3 space-y-3">
              {p.applied_sequence_id ? (
                <>
                  <div className="mono text-sm text-[var(--text)]">
                    {sequences.find((s) => s.id === p.applied_sequence_id)?.name ?? "—"}
                  </div>
                  <div className="mono text-xs text-[var(--text-muted)]">
                    Started {p.sequence_started_at ? smartDate(p.sequence_started_at) : "—"}
                  </div>
                  <div className="mono text-xs text-[var(--text-dim)]">
                    {completedSteps} / {totalSteps} steps complete
                  </div>
                  {nextStep && (
                    <div className="border border-[var(--accent)] p-2">
                      <div className="label text-[var(--accent)] mb-1">NEXT</div>
                      <div className="mono text-[11px] text-[var(--text-muted)] mb-1">DUE {nextStep.due_date}</div>
                      <div className="text-sm">{nextStep.instructions || "—"}</div>
                    </div>
                  )}
                </>
              ) : (
                <ApplySequence sequences={sequences} onApply={(sid) => applySequence.mutate(sid)} />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader>
              <span>FOLLOW-UPS · {followUps.length}</span>
            </PanelHeader>
            <div>
              {followUps.map((f) => (
                <div key={f.id} className="border-b border-[var(--border)] last:border-b-0 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => completeFu.mutate(f.id)}
                      disabled={!!f.completed_at}
                      className={`w-4 h-4 border ${f.completed_at ? "bg-[var(--accent)] border-[var(--accent)]" : "border-[var(--border-strong)] hover:border-[var(--accent)]"}`}
                    />
                    <span className="mono text-[11px] text-[var(--text-muted)] w-24">{f.due_date}</span>
                    {f.completed_at && <Badge variant="success">DONE</Badge>}
                    {!f.completed_at && f.due_date < ymd(new Date()) && <Badge variant="danger">OVERDUE</Badge>}
                    <button onClick={() => deleteFu.mutate(f.id)} className="ml-auto text-[var(--text-muted)] hover:text-[var(--danger)] text-xs">×</button>
                  </div>
                  <div className={`text-sm mt-1 ${f.completed_at ? "text-[var(--text-muted)] line-through" : "text-[var(--text-dim)]"}`}>
                    {f.instructions || "—"}
                  </div>
                  {f.link_urls.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {f.link_urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="mono text-[11px] text-[var(--accent)] block truncate">{u}</a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <AddFollowUp prospectId={id} assignedTo={p.assigned_to ?? user?.id ?? null} allianceId={current?.alliance_id ?? null} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, link }: { label: string; value?: string | number | null; link?: string | null }) {
  return (
    <div className="bg-[var(--surface)] p-3">
      <div className="label mb-1">{label}</div>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="mono text-sm text-[var(--accent)] truncate block">{value ?? "—"}</a>
      ) : (
        <div className="mono text-sm text-[var(--text)] truncate">{value ?? "—"}</div>
      )}
    </div>
  );
}

function EditPanel({ title, value, onChange, onSave }: { title: string; value: string; onChange: (v: string) => void; onSave: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Panel>
      <PanelHeader>
        <span>{title}</span>
        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]">CANCEL</button>
            <button onClick={() => { onSave(); setEditing(false); }} className="text-[var(--accent)]">SAVE</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-[var(--text-muted)] hover:text-[var(--text)]">EDIT</button>
        )}
      </PanelHeader>
      <div className="p-3">
        {editing ? (
          <Textarea rows={6} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <div className="mono text-sm text-[var(--text-dim)] whitespace-pre-wrap min-h-[40px]">{value || "—"}</div>
        )}
      </div>
    </Panel>
  );
}

function ApplySequence({ sequences, onApply }: { sequences: { id: string; name: string }[]; onApply: (id: string) => void }) {
  const [sel, setSel] = useState("");
  if (sequences.length === 0)
    return <div className="mono text-xs text-[var(--text-muted)]">No sequences. Create one in Settings.</div>;
  return (
    <div className="space-y-2">
      <Label>APPLY TEMPLATE</Label>
      <Select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— SELECT SEQUENCE —</option>
        {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Button variant="primary" size="sm" className="w-full" disabled={!sel} onClick={() => onApply(sel)}>APPLY</Button>
    </div>
  );
}

function AddFollowUp({ prospectId, assignedTo, allianceId }: { prospectId: string; assignedTo: string | null; allianceId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(ymd(new Date()));
  const [instr, setInstr] = useState("");
  const [links, setLinks] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      if (!allianceId) throw new Error("No active alliance.");
      const { error } = await supabase.from("follow_ups").insert({
        alliance_id: allianceId,
        prospect_id: prospectId, due_date: due, instructions: instr,
        link_urls: links.split("\n").map((l) => l.trim()).filter(Boolean),
        assigned_to: assignedTo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow_ups"] });
      setOpen(false); setInstr(""); setLinks("");
    },
  });
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full mono text-[11px] text-[var(--accent)] hover:bg-[var(--surface-2)] px-3 py-2 text-left">
        + ADD FOLLOW-UP
      </button>
    );
  }
  return (
    <div className="p-3 border-t border-[var(--border)] space-y-2">
      <div>
        <Label>DUE DATE</Label>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div>
        <Label>INSTRUCTIONS</Label>
        <Textarea rows={3} value={instr} onChange={(e) => setInstr(e.target.value)} />
      </div>
      <div>
        <Label>LINKS (one per line)</Label>
        <Textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>CANCEL</Button>
        <Button size="sm" variant="primary" onClick={() => add.mutate()} disabled={add.isPending}>ADD</Button>
      </div>
    </div>
  );
}
