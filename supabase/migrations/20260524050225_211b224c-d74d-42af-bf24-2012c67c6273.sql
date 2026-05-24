-- 1. Fix privilege escalation: remove self-insert into alliance_members.
-- All inserts now go through SECURITY DEFINER RPCs (create_alliance,
-- accept_alliance_invite, handle_new_user) which validate invites.
DROP POLICY IF EXISTS alliance_members_self_insert ON public.alliance_members;

-- 2. Hide invite tokens from SELECT via column-level privileges.
-- Owners can still read everything except the secret token; the token is
-- returned to the inviter at creation time through the RPC/UI flow.
REVOKE SELECT ON public.alliance_invites FROM anon, authenticated;
GRANT SELECT (id, alliance_id, email, role, invited_by, accepted_at, expires_at, created_at)
  ON public.alliance_invites TO authenticated;
-- Owners still need INSERT/UPDATE/DELETE for the existing owner_all policy.
GRANT INSERT, UPDATE, DELETE ON public.alliance_invites TO authenticated;

-- 3. Lock down SECURITY DEFINER function execution.
-- Trigger functions are only invoked by triggers — no client should call them.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_last_contacted() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;

-- Client-callable RPCs: keep authenticated, drop anon.
REVOKE EXECUTE ON FUNCTION public.create_alliance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_alliance(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_alliance_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_alliance_invite(text) TO authenticated;

-- RLS helpers must remain executable by authenticated (they're used inside
-- policy expressions) but should not be callable by anon.
REVOKE EXECUTE ON FUNCTION public.has_alliance_role(uuid, uuid, alliance_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_alliance_role(uuid, uuid, alliance_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_alliance_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_alliance_member(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.user_alliance_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_alliance_ids(uuid) TO authenticated;