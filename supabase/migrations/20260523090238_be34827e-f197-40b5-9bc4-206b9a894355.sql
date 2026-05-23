ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS niche text,
  ADD COLUMN IF NOT EXISTS brokerage text,
  ADD COLUMN IF NOT EXISTS awards text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS press_mentions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;