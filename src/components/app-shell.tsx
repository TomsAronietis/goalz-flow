import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { signOut, useSession } from "@/hooks/use-auth";
import { cn } from "@/lib/cn";

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useSession();

  const links = [
    { to: "/pipeline", label: "PIPELINE" },
    { to: "/tasks", label: "TASKS" },
    { to: "/settings", label: "SETTINGS" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-30">
        <div className="flex items-center h-12 px-4 gap-6">
          <Link to="/pipeline" className="mono text-xs font-semibold tracking-wider">
            WEBGOALZ <span className="text-[var(--text-muted)]">//</span> OUTREACH
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((l) => {
              const active = loc.pathname.startsWith(l.to);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={cn(
                    "mono text-[11px] tracking-wider px-2.5 py-1 border",
                    active
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--text-dim)] hover:text-[var(--text)]",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="mono text-[11px] text-[var(--text-muted)] hidden sm:inline">
              {user?.email}
            </span>
            <button
              onClick={async () => {
                await signOut();
                nav({ to: "/login" });
              }}
              className="mono text-[11px] tracking-wider text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
            >
              SIGN OUT
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
