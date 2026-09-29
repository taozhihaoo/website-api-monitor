import type { ReactNode } from "react";

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 py-16 text-slate-400"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
      <span className="text-sm">{label || "Loading…"}</span>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="my-4 flex flex-col items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        <strong className="font-semibold text-red-300">Something went wrong.</strong>{" "}
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-red-800 bg-red-900/50 px-3 py-1.5 font-medium text-red-100 transition hover:bg-red-800"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-14 text-center">
      <div className="text-4xl">📡</div>
      <h3 className="text-lg font-semibold text-slate-200">{title}</h3>
      {hint && <p className="max-w-md text-sm text-slate-400">{hint}</p>}
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "default" | "up" | "down" | "warning" | "accent";
}) {
  const toneClasses: Record<string, string> = {
    default: "text-slate-100",
    up: "text-emerald-400",
    down: "text-red-400",
    warning: "text-amber-400",
    accent: "text-blue-400",
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClasses[tone]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
