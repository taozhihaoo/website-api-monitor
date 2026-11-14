import type { Check } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime } from "../utils/format";

/**
 * Compact status-page style bar strip: one bar per recent check.
 * Green = up, red = down, grey = no data.
 */
export function UptimeStrip({
  checks,
  max = 20,
}: {
  checks: Check[] | undefined;
  max?: number;
}) {
  const { locale, t } = useI18n();
  const recent = (checks || []).slice(0, max).reverse();
  const bars: Check[] = [...recent];
  // `max` now means exactly what it says: the strip always renders max bars.
  while (bars.length < max) {
    bars.unshift({} as Check);
  }
  const up = recent.filter((c) => c.status === "up").length;
  const down = recent.filter((c) => c.status === "down").length;
  const description = recent.length
    ? t("format.lastChecksDetail", { total: recent.length, up, down })
    : t("format.noChecksYet");

  return (
    <div
      className="flex h-9 items-stretch gap-[3px]"
      role="img"
      aria-label={description}
      title={description}
    >
      {bars.map((check, index) => {
        const status = check.status;
        const color =
          status === "up"
            ? "bg-emerald-500 sw-bar-up"
            : status === "down"
              ? "bg-red-500 sw-bar-down"
              : "bg-slate-800 sw-bar-empty";
        const tooltip =
          status === "up" || status === "down"
            ? `${formatDateTime(check.checked_at, locale)} — ${t(status === "up" ? "status.up" : "status.down")}${
                check.http_status ? ` (${t("format.httpPrefix", { code: check.http_status })})` : ""
              }`
            : t("format.noData");
        return (
          <div
            key={check.id ?? `empty-${index}`}
            title={tooltip}
            className={`sw-uptime-bar ${color}`}
          />
        );
      })}
    </div>
  );
}
