
-- ============ Enums ============
CREATE TYPE public.app_role AS ENUM ('owner', 'member');
CREATE TYPE public.prospect_status AS ENUM ('researched','dm_sent','responded','call_booked','closed');

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

-- ============ allowed_emails ============
CREATE TABLE public.allowed_emails (
  email text PRIMARY KEY,
  role public.app_role NOT NULL DEFAULT 'member',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- ============ settings ============
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- ============ sequences ============
CREATE TABLE public.sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  day_offset int NOT NULL DEFAULT 0,
  order_index int NOT NULL DEFAULT 0,
  instructions text NOT NULL DEFAULT '',
  link_urls text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;

-- ============ prospects ============
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_handle text NOT NULL,
  ig_url text NOT NULL,
  website_url text,
  first_name text,
  location text,
  follower_count int,
  bio text,
  intel_brief text DEFAULT '',
  website_gaps text DEFAULT '',
  dm_copy text DEFAULT '',
  notes text DEFAULT '',
  status public.prospect_status NOT NULL DEFAULT 'researched',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_sequence_id uuid REFERENCES public.sequences(id) ON DELETE SET NULL,
  sequence_started_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
CREATE INDEX prospects_status_idx ON public.prospects(status);
CREATE INDEX prospects_assigned_to_idx ON public.prospects(assigned_to);

-- ============ follow_ups ============
CREATE TABLE public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  sequence_step_id uuid REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  instructions text NOT NULL DEFAULT '',
  link_urls text[] NOT NULL DEFAULT '{}'::text[],
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
CREATE INDEX follow_ups_prospect_idx ON public.follow_ups(prospect_id);
CREATE INDEX follow_ups_due_idx ON public.follow_ups(due_date) WHERE completed_at IS NULL;
CREATE INDEX follow_ups_assigned_idx ON public.follow_ups(assigned_to);

-- ============ messages_log ============
CREATE TABLE public.messages_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.messages_log ENABLE ROW LEVEL SECURITY;

-- ============ Trigger: updated_at ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER prospects_updated_at BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Trigger: messages_log bumps last_contacted_at ============
CREATE OR REPLACE FUNCTION public.bump_last_contacted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.prospects SET last_contacted_at = NEW.sent_at WHERE id = NEW.prospect_id;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_log_bump AFTER INSERT ON public.messages_log
  FOR EACH ROW EXECUTE FUNCTION public.bump_last_contacted();

-- ============ Trigger: on new auth user — allowlist gate + profile + role ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(NEW.email);
  v_role public.app_role;
  v_any_user boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.user_roles) INTO v_any_user;

  IF NOT v_any_user THEN
    -- First user becomes owner; ensure they're on the allowlist.
    v_role := 'owner';
    INSERT INTO public.allowed_emails(email, role) VALUES (v_email, 'owner')
      ON CONFLICT (email) DO UPDATE SET role = 'owner';
  ELSE
    SELECT role INTO v_role FROM public.allowed_emails WHERE email = v_email;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Email % is not on the invite allowlist.', v_email USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.profiles(id, email, display_name)
    VALUES (NEW.id, v_email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(v_email,'@',1)))
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, v_role)
    ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ RLS Policies ============
-- profiles: any signed-in member can read; users can update their own.
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- user_roles: members can read; owners manage.
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY user_roles_owner_all ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));

-- allowed_emails: owners only.
CREATE POLICY allowed_emails_owner_all ON public.allowed_emails FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));

-- settings: members read; members write (shared).
CREATE POLICY settings_select ON public.settings FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY settings_write ON public.settings FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));

-- prospects: members full access.
CREATE POLICY prospects_all ON public.prospects FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));

-- sequences + steps: members full access.
CREATE POLICY sequences_all ON public.sequences FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));
CREATE POLICY sequence_steps_all ON public.sequence_steps FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));

-- follow_ups + messages_log: members full access.
CREATE POLICY follow_ups_all ON public.follow_ups FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));
CREATE POLICY messages_log_all ON public.messages_log FOR ALL TO authenticated
  USING (public.is_member(auth.uid())) WITH CHECK (public.is_member(auth.uid()));
