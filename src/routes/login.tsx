import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button, Input, Label, Panel } from "@/components/term";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { session, loading } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) nav({ to: "/pipeline" });
  }, [loading, session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/pipeline` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Panel className="w-full max-w-md p-6">
        <div className="mono text-xs tracking-wider text-[var(--text-muted)] mb-1">
          WEBGOALZ // OUTREACH
        </div>
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          We'll send a one-time magic link to your email. Access is invite-only.
        </p>

        {sent ? (
          <div className="mono text-sm text-[var(--text-dim)] border border-[var(--border-strong)] p-3">
            <span className="text-[var(--accent)]">✓</span> Magic link sent to{" "}
            <span className="text-[var(--text)]">{email}</span>. Check your inbox.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>EMAIL</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                autoFocus
              />
            </div>
            {err && (
              <div className="mono text-xs text-[var(--danger)] border border-[var(--danger)] p-2">
                {err}
              </div>
            )}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? "SENDING…" : "SEND MAGIC LINK"}
            </Button>
          </form>
        )}
      </Panel>
    </div>
  );
}
