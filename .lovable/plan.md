## Webgoalz Outreach — Phase 1 (manual) with future IG API path

Dark terminal CRM for IG luxury-real-estate outreach. **All sending stays manual** (Meta API forbids cold DMs anyway). Phase 1 ships manual tracking + follow-up engine. Phase 3 layers Meta IG Messaging API on top for the responded/call-booked columns only.

---

### Design system
- BG `#0a0a0a`, surface `#111`, border `#1f1f1f`, text `#fff`, muted `#737373`, accent `#2563eb`.
- `Inter` UI, `JetBrains Mono` for all data (handles, counts, dates).
- No radius, no gradients, no shadows, 1px borders, uppercase tracked labels.

### Backend (Lovable Cloud)
Tables:
- `prospects` — ig_handle, ig_url, website_url, first_name, location, follower_count, bio, intel_brief, website_gaps, dm_copy, notes, status (researched/dm_sent/responded/call_booked/closed), assigned_to, created_by, last_contacted_at, applied_sequence_id, sequence_started_at, created_at, updated_at.
- `sequences` (name, description) + `sequence_steps` (sequence_id, day_offset, instructions, link_urls[], order_index).
- `follow_ups` — prospect_id, sequence_step_id (nullable for ad-hoc), due_date, instructions, link_urls[], assigned_to, completed_at, completed_by.
- `messages_log` — prospect_id, sent_at, summary. Trigger bumps `prospects.last_contacted_at`.
- `profiles` (id, email, display_name) + `user_roles` (owner/member) + `allowed_emails` + `settings` (key/value).

RLS: allowlisted authed users read/write all data; only owners manage members and allowlist. `has_role()` SECURITY DEFINER. Trigger on `auth.users` insert blocks non-allowlisted emails; first user auto-promoted to owner.

### Auth
Magic-link `signInWithOtp`. `/login`, `_authenticated` guard. Top nav: `WEBGOALZ // OUTREACH` · Pipeline · Tasks · Settings · sign-out.

### Routes
- `pipeline` — 5-col Kanban, dnd-kit + status dropdown, Add Prospect modal (all fields). Cards: mono handle/name/location/followers, relative date ≤30d then exact, overdue task badge, assignee initials.
- `tasks` — Today inbox: overdue + today + upcoming, filter by assignee (default = me), click → prospect.
- `prospects/$id` — header strip, editable intel/gaps/DM-copy/notes, assignee + status dropdowns, **"Log DM sent"** button (writes messages_log → bumps last_contacted_at), follow-up list (add/complete/delete), **Sequence panel on the right** showing applied sequence, progress (`3 / 5 completed`), next step instructions + due date, full timeline of past + upcoming steps.
- `settings` — strategy prompt textarea, Members (owner-only invite/remove), Sequences CRUD + step editor, Instagram panel (stub explaining Phase 3 requirements + "Coming soon" disabled buttons).

### Follow-up engine
- Apply sequence to prospect → creates N follow_ups with due_date = today + step.day_offset, copies instructions + link_urls, default assignee = prospect's assignee.
- Ad-hoc tasks: add inline on prospect (due date + instructions + link URLs + assignee).
- Default assignee = creator; editable anywhere.
- Attachments = link URLs only (Loom, Drive, image URL). No file uploads.

### Last-contact tracking
"Log DM sent" inserts messages_log row → trigger updates last_contacted_at. Card + profile show `Last contact: 3d ago` in mono.

### Instagram panel (Phase 1 stub, Phase 3 fills in)
A Settings → Instagram section that:
- Explains Meta's hard limits (Business/Creator + FB Page + app review + 24h reply window + no cold DMs).
- Shows disabled "Connect Meta account" and "Sync now" buttons with "Phase 3" badge.
- Stores config shell in `settings.instagram_integration = { enabled: false }`.
- Includes `src/lib/instagram.functions.ts` with stubbed `syncInstagramThreads` throwing "Not implemented" — wiring point for Phase 3.

### Phase split — explicit
- **Phase 1 (this build):** everything above, fully manual.
- **Phase 2 (later prompt):** Jina Reader + DuckDuckGo + Claude API for auto intel briefs, website audits, DM copy.
- **Phase 3 (later prompt, you start Meta app review in parallel):** Meta IG Messaging API for the *responded*/*call_booked* columns only — OAuth connect, webhook receiver, live thread view, send reply within 24h window. Cold opener + non-responder follow-ups remain manual forever (Meta restriction).

### Tech additions
`@tanstack/react-query`, `@dnd-kit/core` + `@dnd-kit/sortable`, `date-fns`, `zod`.

### Out of scope Phase 1
AI features, real IG API, file uploads, full message thread sync.

### Build order
1. Enable Lovable Cloud + migration (tables, RLS, triggers, allowlist gate, profile auto-insert).
2. Design tokens in `src/styles.css`, fonts.
3. Auth (`login`, `_authenticated`, nav).
4. Pipeline + Add Prospect modal + DnD + status.
5. Prospect profile + follow-ups + Log-DM + sequence side panel.
6. Tasks/Today inbox.
7. Settings (strategy, members, sequences CRUD, IG stub).
8. Verify: signup gated, RLS works, DnD persists, sequence apply creates timeline, overdue badge fires, assignee defaults to creator, last-contact updates.