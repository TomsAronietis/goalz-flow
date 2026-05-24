create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  name text not null,
  order_index int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (alliance_id, name)
);

alter table public.pipeline_stages enable row level security;

create policy pipeline_stages_all on public.pipeline_stages for all to authenticated
  using (public.is_alliance_member(auth.uid(), alliance_id))
  with check (public.is_alliance_member(auth.uid(), alliance_id));

alter table public.prospects add column if not exists stage_id uuid references public.pipeline_stages(id) on delete set null;
create index if not exists prospects_stage_id_idx on public.prospects(stage_id);

insert into public.pipeline_stages (alliance_id, name, order_index)
select a.id, s.name, s.order_index
from public.alliances a
cross join (values
  ('Researched', 0),
  ('DM Sent', 1),
  ('Responded', 2),
  ('Call Booked', 3),
  ('Closed', 4)
) as s(name, order_index)
on conflict (alliance_id, name) do nothing;

update public.prospects p
set stage_id = ps.id
from public.pipeline_stages ps
where ps.alliance_id = p.alliance_id
  and p.stage_id is null
  and lower(replace(ps.name, ' ', '_')) = p.status::text;
