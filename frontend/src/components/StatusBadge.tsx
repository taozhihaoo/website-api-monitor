const STYLES: Record<string, { dot: string; text: string; label: string }> = {
  up: { dot: "bg-emerald-500", text: "text-emerald-400", label: "UP" },
  down: { dot: "bg-red-500", text: "text-red-400", label: "DOWN" },
  paused: { dot: "bg-slate-500", text: "text-slate-400", label: "PAUSED" },
  pending: { dot: "bg-blue-500", text: "text-blue-400", label: "PENDING" },
  valid: { dot: "bg-emerald-500", text: "text-emerald-400", label: "SSL OK" },
  expiring_soon: { dot: "bg-amber-500", text: "text-amber-400", label: "SSL EXPIRING" },
  expired: { dot: "bg-red-500", text: "text-red-400", label: "SSL EXPIRED" },
  unknown: { dot: "bg-slate-600", text: "text-slate-400", label: "SSL ?" },
  not_applicable: { dot: "bg-slate-700", text: "text-slate-500", label: "SSL N/A" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = status || "pending";
  const style = STYLES[key] || STYLES.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold tracking-wide ${style.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
