/**
 * Instagram Messaging API integration — PHASE 3 STUB.
 *
 * Phase 1 ships fully manual. This file is the wiring point where Phase 3 will:
 * - Complete Meta OAuth (Business/Creator IG account linked to a Facebook Page).
 * - Subscribe to webhooks for the `messages` field on the IG account.
 * - Sync threads + send replies (within Meta's 24h customer-initiated window).
 *
 * Cold opener DMs and follow-ups to non-responders MUST stay manual — Meta's
 * Messaging API does not allow unsolicited messages to users who haven't
 * messaged you first. This is by design from Meta and cannot be worked around.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const syncInstagramThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ prospectId: z.string().uuid().optional() }))
  .handler(async () => {
    throw new Error(
      "Instagram sync is not implemented yet. This is wired in Phase 3 after Meta app review.",
    );
  });

export const sendInstagramReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ prospectId: z.string().uuid(), message: z.string().min(1) }))
  .handler(async () => {
    throw new Error(
      "Instagram send is not implemented yet. Requires Meta IG Messaging API + Page connection.",
    );
  });
