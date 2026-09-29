import type { Check } from "../api/types";

/**
 * Compact status-page style bar strip: one bar per recent check.
 * Green = up, red = down, grey = no data.
 */
export function UptimeStrip({
  checks,
  max = 30,
}: {
  checks: Check[] | undefined;
  max?: number;
}) {
  const recent = (checks || []).slice(0, max).reverse();
  const bars: Check[] = [...recent];
  while (bars.length < Math.min(max, 20)) {
    bars.unshift({} as Check);
  }

  return (
    <div
      className="flex h-8 items-stretch gap-[2px]"
      role="img"
      aria-label={`Last ${recent.length} checks`}
      title={recent.length ? `Last ${recent.length} checks` : "No checks yet"}
    >
      {bars.map((check, index) => {
        const status = check.status;
        const color =
          status === "up"
            ? "bg-emerald-500"
            : status === "down"
              ? "bg-red-500"
              : "bg-slate-800";
        const tooltip =
          status === "up" || status === "down"
            ? `${new Date(check.checked_at).toLocaleString()} — ${status.toUpperCase()}${
                check.http_status ? ` (HTTP ${check.http_status})` : ""
              }`
            : "no data";
        return (
          <div
            key={check.id ?? `empty-${index}`}
            title={tooltip}
            className={`min-w-[4px] flex-1 rounded-sm ${color}`}
          />
        );
      })}
    </div>
  );
}
