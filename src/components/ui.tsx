"use client";

import { BookOpen, ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { Example } from "@/lib/examples";

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-sky-600 text-white shadow-sm hover:bg-sky-500 hover:shadow-md hover:shadow-sky-500/25 active:bg-sky-700",
  secondary: "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 active:bg-zinc-700",
  ghost: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 active:bg-zinc-700",
  danger: "border border-rose-900/70 bg-rose-950/40 text-rose-300 hover:border-rose-700 hover:bg-rose-900/50 active:bg-rose-900/70",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  loading?: boolean;
  size?: "sm" | "md";
  // Hide the text on narrow screens and keep just the icon.
  iconOnlyOnSmall?: boolean;
}

export function Button({ variant = "secondary", icon: Icon, loading, size = "md", iconOnlyOnSmall, className, children, disabled, ...rest }: ButtonProps) {
  const Glyph = loading ? Loader2 : Icon;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
        "active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {Glyph && <Glyph size={size === "sm" ? 13 : 15} className={cn("shrink-0", loading && "animate-spin")} aria-hidden />}
      {children != null && <span className={cn("items-center gap-1", iconOnlyOnSmall && Glyph ? "hidden sm:inline-flex" : "inline-flex")}>{children}</span>}
    </button>
  );
}

export function SelectBox({ icon: Icon, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { icon?: LucideIcon; children: ReactNode }) {
  return (
    <label className={cn("group relative inline-flex items-center", className)}>
      {Icon && <Icon size={14} className="pointer-events-none absolute left-2 text-zinc-500 transition-colors group-hover:text-zinc-300" aria-hidden />}
      <select
        {...rest}
        className={cn(
          "h-8 max-w-full cursor-pointer appearance-none rounded-md border border-zinc-700 bg-zinc-900 pr-7 text-xs text-zinc-200 transition-colors",
          "hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:cursor-not-allowed disabled:opacity-50",
          Icon ? "pl-7" : "pl-2.5",
        )}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 text-zinc-500 transition-colors group-hover:text-zinc-300" aria-hidden />
    </label>
  );
}

// Dropdown of grouped, ready-to-run code samples.
export function ExamplesMenu({ examples, onPick }: { examples: Example[]; onPick: (ex: Example) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const categories = [...new Set(examples.map((e) => e.category))];

  return (
    <div ref={root} className="relative">
      <Button icon={BookOpen} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" iconOnlyOnSmall>
        Examples
        <ChevronDown size={14} className={cn("transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-[65vh] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl shadow-black/60">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{cat}</div>
              {examples.filter((e) => e.category === cat).map((ex) => (
                <button key={ex.title} role="menuitem" onClick={() => { onPick(ex); setOpen(false); }}
                  className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-sky-600/20 hover:text-white focus-visible:bg-sky-600/20 focus-visible:outline-none active:bg-sky-600/30">
                  {ex.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
