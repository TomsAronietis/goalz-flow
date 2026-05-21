DROP POLICY IF EXISTS alliances_select ON public.alliances;
CREATE POLICY alliances_select ON public.alliances
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR id IN (SELECT public.user_alliance_ids(auth.uid()))
  );