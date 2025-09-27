import React, { createContext, useContext, useMemo, useState } from "react";
import { clsx } from "clsx";

export function Button(
  {
    className,
    variant = "primary",
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "danger";
    loading?: boolean;
  }
) {
  const base =
    "inline-flex items-center justify-center rounded-xl2 px-4 py-2 text-sm font-medium transition shadow-soft hover:shadow focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    ghost: "bg-white text-brand-700 border border-slate-200 hover:bg-brand-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  } as const;
  return (
    <button className={clsx(base, styles[variant], className)} {...props}>
      {loading && (
        <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
      )}
      {props.children}
    </button>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-xl2 bg-white shadow-soft border border-slate-100", className)}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-xl2 border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-400",
        props.className
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
      {children}
    </label>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-slate-600">
      <div className="h-12 w-12 rounded-2xl bg-brand-50 grid place-items-center text-brand-700">★</div>
      <div className="text-lg font-semibold">{title}</div>
      {hint && <p className="max-w-prose text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

// simple toast system
export type Toast = { id: number; title: string; kind?: "success" | "error" | "info" };
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be inside <Toaster>");
  return ctx;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const api = useMemo(
    () => ({
      push: (t: Omit<Toast, "id">) => {
        const id = Date.now() + Math.random();
        setList((s) => [...s, { id, ...t }]);
        setTimeout(() => setList((s) => s.filter((x) => x.id !== id)), 3500);
      },
    }),
    []
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {list.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "flex items-start gap-2 rounded-xl2 border p-3 shadow-soft text-sm",
              t.kind === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : t.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-800"
            )}
          >
            <span aria-hidden className="mt-0.5 inline-block h-4 w-4 rounded-full bg-current opacity-70" />
            <div className="flex-1">{t.title}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
