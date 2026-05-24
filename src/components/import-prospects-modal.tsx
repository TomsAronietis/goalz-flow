import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { useCurrentAlliance } from "@/hooks/use-alliance";
import { Button, Label, Modal, Select } from "@/components/term";
import { parseIgHandle } from "@/lib/format";

type Row = Record<string, string>;

const FIELDS = [
  { key: "ig_url", label: "Instagram URL / handle *", required: true },
  { key: "first_name", label: "First name" },
  { key: "website_url", label: "Website" },
  { key: "location", label: "Location" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "niche", label: "Niche" },
  { key: "brokerage", label: "Brokerage" },
  { key: "bio", label: "Bio" },
  { key: "follower_count", label: "Follower count" },
];

export function ImportProspectsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { current } = useCurrentAlliance();
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setRows([]); setColumns([]); setMapping({}); setFileName(""); setErr(null); setSummary(null);
  }

  function autoMap(cols: string[]) {
    const m: Record<string, string> = {};
    for (const f of FIELDS) {
      const match = cols.find((c) => {
        const n = c.toLowerCase().replace(/[\s_-]/g, "");
        if (f.key === "ig_url") return n.includes("instagram") || n === "ig" || n === "handle" || n === "ighandle";
        if (f.key === "first_name") return n.includes("firstname") || n === "name" || n === "first";
        if (f.key === "website_url") return n.includes("website") || n.includes("site") || n === "url";
        if (f.key === "follower_count") return n.includes("follower");
        return n === f.key.replace(/_/g, "");
      });
      if (match) m[f.key] = match;
    }
    setMapping(m);
  }

  function handleFile(file: File) {
    setErr(null);
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const data = res.data as Row[];
          const cols = res.meta.fields ?? [];
          setRows(data); setColumns(cols); autoMap(cols);
        },
        error: (e) => setErr(e.message),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: "binary" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
          const cols = data.length ? Object.keys(data[0]) : [];
          setRows(data); setColumns(cols); autoMap(cols);
        } catch (er) {
          setErr((er as Error).message);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      setErr("Unsupported file type. Use CSV or XLSX.");
    }
  }

  const [summary, setSummary] = useState<{ inserted: number; updated: number; skipped: number } | null>(null);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No active alliance.");
      const igCol = mapping.ig_url;
      if (!igCol) throw new Error("Map the Instagram URL/handle column.");

      // 1. Build normalized rows, deduplicating within the file by handle (last one wins).
      const byHandle = new Map<string, Record<string, unknown>>();
      let skipped = 0;
      for (const r of rows) {
        const raw = (r[igCol] ?? "").toString().trim();
        if (!raw) { skipped++; continue; }
        const handle = (parseIgHandle(raw) || raw.replace(/^@/, "").trim()).toLowerCase();
        if (!handle) { skipped++; continue; }
        const ig_url = raw.startsWith("http") ? raw : `https://instagram.com/${handle}`;
        const row: Record<string, unknown> = { ig_handle: handle, ig_url };
        for (const f of FIELDS) {
          if (f.key === "ig_url") continue;
          const src = mapping[f.key];
          if (!src) continue;
          const v = (r[src] ?? "").toString().trim();
          if (!v) continue;
          if (f.key === "follower_count") {
            const n = parseInt(v.replace(/[^\d]/g, ""), 10);
            if (!Number.isNaN(n)) row.follower_count = n;
          } else {
            row[f.key] = v;
          }
        }
        // Merge with any earlier row for the same handle (later row's values win on conflict).
        byHandle.set(handle, { ...(byHandle.get(handle) ?? {}), ...row });
      }
      if (byHandle.size === 0) throw new Error("No valid rows to import.");

      // 2. Look up existing prospects in this alliance by handle.
      const handles = Array.from(byHandle.keys());
      const { data: existing, error: selErr } = await supabase
        .from("prospects")
        .select("*")
        .eq("alliance_id", current.alliance_id)
        .in("ig_handle", handles);
      if (selErr) throw selErr;
      const existingByHandle = new Map((existing ?? []).map((p) => [p.ig_handle.toLowerCase(), p]));

      // 3. Split into inserts (new) and updates (existing — only fill empty fields).
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: string; patch: Record<string, unknown> }[] = [];
      for (const [handle, row] of byHandle) {
        const ex = existingByHandle.get(handle);
        if (!ex) {
          inserts.push({
            ...row,
            alliance_id: current.alliance_id,
            created_by: user?.id ?? null,
            assigned_to: user?.id ?? null,
          });
          continue;
        }
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k === "ig_handle" || k === "ig_url") continue;
          const cur = (ex as Record<string, unknown>)[k];
          // Only fill empty fields — never clobber existing/enriched data.
          if (cur === null || cur === undefined || cur === "") {
            patch[k] = v;
          }
        }
        if (Object.keys(patch).length > 0) {
          updates.push({ id: ex.id, patch });
        }
      }

      if (inserts.length > 0) {
        const { error } = await supabase.from("prospects").insert(inserts as never);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from("prospects").update(u.patch as never).eq("id", u.id);
        if (error) throw error;
      }

      return { inserted: inserts.length, updated: updates.length, skipped };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      setSummary(res);
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="IMPORT PROSPECTS">
      <div className="space-y-4">
        {summary ? (
          <div className="space-y-2">
            <div className="mono text-sm text-[var(--accent)]">✓ IMPORT COMPLETE</div>
            <div className="mono text-xs text-[var(--text-dim)] space-y-0.5">
              <div>+ {summary.inserted} new prospect{summary.inserted === 1 ? "" : "s"} inserted</div>
              <div>↻ {summary.updated} existing prospect{summary.updated === 1 ? "" : "s"} updated (empty fields only)</div>
              {summary.skipped > 0 && <div className="text-[var(--text-muted)]">— {summary.skipped} row{summary.skipped === 1 ? "" : "s"} skipped (no IG handle)</div>}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div>
            <Label>CSV OR EXCEL FILE</Label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="block w-full mono text-xs text-[var(--text)] file:mr-3 file:py-1.5 file:px-3 file:border file:border-[var(--border-strong)] file:bg-[var(--surface-2)] file:text-[var(--text)] file:mono file:text-xs file:cursor-pointer"
            />
            <div className="mono text-[11px] text-[var(--text-muted)] mt-2">
              Required: a column with the Instagram URL or @handle.
              Existing prospects with the same handle in this alliance will be updated (empty fields only), not duplicated.
            </div>
          </div>
        ) : (
          <>
            <div className="mono text-xs text-[var(--text-muted)]">
              {fileName} · {rows.length} rows · map columns:
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                  <Label className="mb-0">{f.label}</Label>
                  <Select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  >
                    <option value="">— skip —</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            <div className="border border-[var(--border)] p-2 max-h-32 overflow-auto">
              <div className="label mb-1">PREVIEW (first 3)</div>
              {rows.slice(0, 3).map((r, i) => (
                <div key={i} className="mono text-[10px] text-[var(--text-dim)] truncate">
                  {mapping.ig_url ? r[mapping.ig_url] : "—"}
                  {mapping.first_name ? ` · ${r[mapping.first_name]}` : ""}
                </div>
              ))}
            </div>
          </>
        )}
        {err && <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          {summary ? (
            <Button variant="primary" onClick={() => { reset(); onClose(); }}>DONE</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>CANCEL</Button>
              {rows.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() => importMut.mutate()}
                  disabled={importMut.isPending || !mapping.ig_url}
                >
                  {importMut.isPending ? "IMPORTING…" : `IMPORT ${rows.length}`}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
