import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type BtnVariant = "primary" | "ghost" | "danger" | "outline";
type BtnSize = "sm" | "md";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }
>(({ variant = "outline", size = "md", className, ...p }, ref) => {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none border";
  const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3 text-sm" }[size];
  const variants = {
    primary: "bg-[var(--accent)] border-[var(--accent)] text-white hover:bg-[var(--accent-dim)]",
    outline:
      "bg-transparent border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--surface-2)]",
    ghost: "bg-transparent border-transparent text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]",
    danger: "bg-transparent border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white",
  }[variant];
  return <button ref={ref} className={cn(base, sizes, variants, className)} {...p} />;
});
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input
      ref={ref}
      className={cn(
        "mono w-full h-9 px-2.5 border border-[var(--border-strong)] bg-[var(--surface-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]",
        className,
      )}
      {...p}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "mono w-full px-2.5 py-2 border border-[var(--border-strong)] bg-[var(--surface-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] resize-y",
        className,
      )}
      {...p}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...p }, ref) => (
    <select
      ref={ref}
      className={cn(
        "mono w-full h-9 px-2.5 border border-[var(--border-strong)] bg-[var(--surface-2)] text-sm text-[var(--text)] focus:border-[var(--accent)]",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("label mb-1.5", className)}>{children}</div>;
}

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "accent" | "danger" | "success" | "warning" | "muted";
  className?: string;
}) {
  const variants = {
    default: "border-[var(--border-strong)] text-[var(--text-dim)]",
    accent: "border-[var(--accent)] text-[var(--accent)]",
    danger: "border-[var(--danger)] text-[var(--danger)]",
    success: "border-[var(--success)] text-[var(--success)]",
    warning: "border-[var(--warning)] text-[var(--warning)]",
    muted: "border-[var(--border)] text-[var(--text-muted)]",
  }[variant];
  return (
    <span
      className={cn(
        "mono inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider border",
        variants,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border border-[var(--border)] bg-[var(--surface)]", className)}>{children}</div>
  );
}

export function PanelHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "label flex items-center justify-between border-b border-[var(--border)] px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 py-16 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full border border-[var(--border-strong)] bg-[var(--surface)]",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="label text-[var(--text)]">{title}</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
