import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    async function bootstrap(userId: string) {
      // Accept invite token if present in URL
      const params = new URLSearchParams(window.location.search);
      const token = params.get("invite");
      if (token) {
        try {
          await supabase.rpc("accept_alliance_invite", { _token: token });
        } catch {
          // ignore — invalid/expired token; user will see onboarding
        }
        qc.invalidateQueries({ queryKey: ["my_alliances"] });
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", url.toString());
      }

      const { data } = await supabase
        .from("alliance_members")
        .select("alliance_id")
        .eq("user_id", userId)
        .limit(1);
      if (!alive) return;

      const hasAlliance = !!data && data.length > 0;
      if (!hasAlliance && loc.pathname !== "/onboarding") {
        nav({ to: "/onboarding" });
      } else if (hasAlliance && loc.pathname === "/onboarding") {
        nav({ to: "/pipeline" });
      }
      setReady(true);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      if (!session) {
        nav({ to: "/login" });
        return;
      }
      bootstrap(session.user.id);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (!data.session) nav({ to: "/login" });
      else bootstrap(data.session.user.id);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [nav, loc.pathname, qc]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center mono text-xs text-[var(--text-muted)]">
        LOADING…
      </div>
    );
  }

  // Onboarding renders without the AppShell chrome
  if (loc.pathname === "/onboarding") {
    return <Outlet />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
