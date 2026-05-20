
-- ============================================================================
-- 1. New types & tables
-- ============================================================================
CREATE TYPE public.alliance_role AS ENUM ('owner', 'member');

CREATE TABLE public.alliances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.alliance_members (
  alliance_id uuid NOT NULL REFERENCES public.alliances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.alliance_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alliance_id, user_id)
);

CREATE TABLE public.alliance_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id uuid NOT NULL REFERENCES public.alliances(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  role public.alliance_role NOT NULL DEFAULT 'member',
  invited_by uuid,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alliance_id, email)
);

CREATE INDEX idx_alliance_members_user ON public.alliance_members(user_id);
CREATE INDEX idx_alliance_invites_token ON public.alliance_invites(token);

-- ============================================================================
-- 2. Add alliance_id to existing tables + backfill
-- ============================================================================
ALTER TABLE public.prospects    ADD COLUMN alliance_id uuid REFERENCES public.alliances(id) ON DELETE CASCADE;
ALTER TABLE public.sequences    ADD COLUMN alliance_id uuid REFERENCES public.alliances(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups   ADD COLUMN alliance_id uuid REFERENCES public.alliances(id) ON DELETE CASCADE;
ALTER TABLE public.messages_log ADD COLUMN alliance_id uuid REFERENCES public.alliances(id) ON DELETE CASCADE;

DO $$
DECLARE
  v_alliance_id uuid;
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.user_roles WHERE role = 'owner' LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  END IF;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.alliances (name, created_by) VALUES ('Default Alliance', v_owner) RETURNING id INTO v_alliance_id;

    INSERT INTO public.alliance_members (alliance_id, user_id, role)
    SELECT v_alliance_id, ur.user_id,
      CASE WHEN ur.role::text = 'owner' THEN 'owner'::public.alliance_role ELSE 'member'::public.alliance_role END
    FROM public.user_roles ur
    ON CONFLICT DO NOTHING;

    INSERT INTO public.alliance_members (alliance_id, user_id, role)
    SELECT v_alliance_id, p.id, 'member'::public.alliance_role
    FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.alliance_members am WHERE am.user_id = p.id)
    ON CONFLICT DO NOTHING;

    UPDATE public.prospects    SET alliance_id = v_alliance_id WHERE alliance_id IS NULL;
    UPDATE public.sequences    SET alliance_id = v_alliance_id WHERE alliance_id IS NULL;
    UPDATE public.follow_ups   SET alliance_id = v_alliance_id WHERE alliance_id IS NULL;
    UPDATE public.messages_log SET alliance_id = v_alliance_id WHERE alliance_id IS NULL;
  END IF;
END $$;

-- Allow inserts only when alliance is provided (only enforce NOT NULL if any rows exist now)
ALTER TABLE public.prospects    ALTER COLUMN alliance_id SET NOT NULL;
ALTER TABLE public.sequences    ALTER COLUMN alliance_id SET NOT NULL;
ALTER TABLE public.follow_ups   ALTER COLUMN alliance_id SET NOT NULL;
ALTER TABLE public.messages_log ALTER COLUMN alliance_id SET NOT NULL;

-- ============================================================================
-- 3. Rebuild settings table (per-alliance)
-- ============================================================================
CREATE TABLE public.settings_new (
  alliance_id uuid NOT NULL REFERENCES public.alliances(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (alliance_id, key)
);

INSERT INTO public.settings_new (alliance_id, key, value, updated_at, updated_by)
SELECT a.id, s.key, s.value, s.updated_at, s.updated_by
FROM public.settings s
CROSS JOIN LATERAL (SELECT id FROM public.alliances LIMIT 1) a;

DROP TABLE public.settings CASCADE;
ALTER TABLE public.settings_new RENAME TO settings;

-- ============================================================================
-- 4. Drop old allowlist / user_roles
-- ============================================================================
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.is_member(uuid) CASCADE;
DROP TABLE IF EXISTS public.allowed_emails CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;

-- ============================================================================
-- 5. New helper functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_alliance_member(_alliance_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.alliance_members WHERE alliance_id = _alliance_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_alliance_role(_alliance_id uuid, _user_id uuid, _role public.alliance_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.alliance_members WHERE alliance_id = _alliance_id AND user_id = _user_id AND role = _role)
$$;

-- Returns alliance_ids the user belongs to (for membership-checking in RLS without recursion)
CREATE OR REPLACE FUNCTION public.user_alliance_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT alliance_id FROM public.alliance_members WHERE user_id = _user_id
$$;

-- ============================================================================
-- 6. Replace handle_new_user — no allowlist, accept invite token if present
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(NEW.email);
  v_token text := NEW.raw_user_meta_data->>'invite_token';
  v_invite record;
BEGIN
  INSERT INTO public.profiles(id, email, display_name)
    VALUES (NEW.id, v_email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(v_email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;

  IF v_token IS NOT NULL AND length(v_token) > 0 THEN
    SELECT * INTO v_invite FROM public.alliance_invites
      WHERE token = v_token AND accepted_at IS NULL AND expires_at > now() AND lower(email) = v_email
      LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.alliance_members (alliance_id, user_id, role)
        VALUES (v_invite.alliance_id, NEW.id, v_invite.role)
        ON CONFLICT DO NOTHING;
      UPDATE public.alliance_invites SET accepted_at = now() WHERE id = v_invite.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================================
-- 7. accept_alliance_invite RPC (for already-signed-in users with token)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_alliance_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite record;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT * INTO v_invite FROM public.alliance_invites
    WHERE token = _token AND accepted_at IS NULL AND expires_at > now() AND lower(email) = lower(v_email)
    LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite invalid, expired, or for a different email'; END IF;
  INSERT INTO public.alliance_members (alliance_id, user_id, role)
    VALUES (v_invite.alliance_id, auth.uid(), v_invite.role)
    ON CONFLICT DO NOTHING;
  UPDATE public.alliance_invites SET accepted_at = now() WHERE id = v_invite.id;
  RETURN v_invite.alliance_id;
END $$;
GRANT EXECUTE ON FUNCTION public.accept_alliance_invite(text) TO authenticated;

-- ============================================================================
-- 8. RLS on new tables
-- ============================================================================
ALTER TABLE public.alliances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alliance_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alliance_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings         ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliances_select ON public.alliances FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_alliance_ids(auth.uid())));
CREATE POLICY alliances_insert ON public.alliances FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY alliances_update_owner ON public.alliances FOR UPDATE TO authenticated
  USING (public.has_alliance_role(id, auth.uid(), 'owner'))
  WITH CHECK (public.has_alliance_role(id, auth.uid(), 'owner'));
CREATE POLICY alliances_delete_owner ON public.alliances FOR DELETE TO authenticated
  USING (public.has_alliance_role(id, auth.uid(), 'owner'));

CREATE POLICY alliance_members_select ON public.alliance_members FOR SELECT TO authenticated
  USING (alliance_id IN (SELECT public.user_alliance_ids(auth.uid())));
-- Owners can do anything (invite-accept inserts go through SECURITY DEFINER funcs)
CREATE POLICY alliance_members_owner_write ON public.alliance_members FOR ALL TO authenticated
  USING (public.has_alliance_role(alliance_id, auth.uid(), 'owner'))
  WITH CHECK (public.has_alliance_role(alliance_id, auth.uid(), 'owner'));
-- A user can insert themselves as the founding owner of a new alliance they just created
CREATE POLICY alliance_members_self_insert ON public.alliance_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
-- A member can leave (delete their own row)
CREATE POLICY alliance_members_self_delete ON public.alliance_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY alliance_invites_owner_all ON public.alliance_invites FOR ALL TO authenticated
  USING (public.has_alliance_role(alliance_id, auth.uid(), 'owner'))
  WITH CHECK (public.has_alliance_role(alliance_id, auth.uid(), 'owner'));

CREATE POLICY settings_member_all ON public.settings FOR ALL TO authenticated
  USING (public.is_alliance_member(alliance_id, auth.uid()))
  WITH CHECK (public.is_alliance_member(alliance_id, auth.uid()));

-- ============================================================================
-- 9. Rewrite RLS on existing data tables (replace is_member(uid) policies)
-- ============================================================================
DROP POLICY IF EXISTS prospects_all      ON public.prospects;
DROP POLICY IF EXISTS sequences_all      ON public.sequences;
DROP POLICY IF EXISTS sequence_steps_all ON public.sequence_steps;
DROP POLICY IF EXISTS follow_ups_all     ON public.follow_ups;
DROP POLICY IF EXISTS messages_log_all   ON public.messages_log;
DROP POLICY IF EXISTS profiles_select    ON public.profiles;

CREATE POLICY prospects_all ON public.prospects FOR ALL TO authenticated
  USING (public.is_alliance_member(alliance_id, auth.uid()))
  WITH CHECK (public.is_alliance_member(alliance_id, auth.uid()));

CREATE POLICY sequences_all ON public.sequences FOR ALL TO authenticated
  USING (public.is_alliance_member(alliance_id, auth.uid()))
  WITH CHECK (public.is_alliance_member(alliance_id, auth.uid()));

CREATE POLICY sequence_steps_all ON public.sequence_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sequences s WHERE s.id = sequence_id AND public.is_alliance_member(s.alliance_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sequences s WHERE s.id = sequence_id AND public.is_alliance_member(s.alliance_id, auth.uid())));

CREATE POLICY follow_ups_all ON public.follow_ups FOR ALL TO authenticated
  USING (public.is_alliance_member(alliance_id, auth.uid()))
  WITH CHECK (public.is_alliance_member(alliance_id, auth.uid()));

CREATE POLICY messages_log_all ON public.messages_log FOR ALL TO authenticated
  USING (public.is_alliance_member(alliance_id, auth.uid()))
  WITH CHECK (public.is_alliance_member(alliance_id, auth.uid()));

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT am.user_id FROM public.alliance_members am
      WHERE am.alliance_id IN (SELECT public.user_alliance_ids(auth.uid()))
    )
  );
