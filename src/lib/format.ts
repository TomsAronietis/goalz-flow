import { differenceInDays, format, formatDistanceToNowStrict } from "date-fns";

/** Relative if ≤30d, otherwise exact YYYY-MM-DD. */
export function smartDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.abs(differenceInDays(new Date(), d));
  if (days > 30) return format(d, "yyyy-MM-dd");
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export function ymd(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "yyyy-MM-dd");
}

export function parseIgHandle(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const part = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return part.replace(/^@/, "");
  } catch {
    return url.replace(/^@/, "").split("/")[0] ?? "";
  }
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "—";
  const at = src.indexOf("@");
  const base = at > 0 ? src.slice(0, at) : src;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
