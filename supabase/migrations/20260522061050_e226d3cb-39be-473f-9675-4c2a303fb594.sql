
CREATE OR REPLACE FUNCTION public.create_alliance(_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Alliance name is required';
  END IF;

  INSERT INTO public.alliances (name, created_by)
  VALUES (btrim(_name), v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.alliance_members (alliance_id, user_id, role)
  VALUES (v_id, v_uid, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.create_alliance(text) TO authenticated;
