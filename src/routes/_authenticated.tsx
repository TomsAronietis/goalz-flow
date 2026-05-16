import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      if (!session) nav({ to: "/login" });
      else setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (!data.session) nav({ to: "/login" });
      else setReady(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [nav]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center mono text-xs text-[var(--text-muted)]">
        LOADING…
      </div>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
