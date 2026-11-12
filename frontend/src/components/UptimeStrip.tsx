import type { Check } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime } from "../utils/format";

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
  const { locale, t } = useI18n();
  const recent = (checks || []).slice(0, max).reverse();
  const bars: Check[] = [...recent];
  while (bars.length < Math.min(max, 20)) {
    bars.unshift({} as Check);
  }

  return (
    <div
      className="flex h-9 items-stretch gap-[3px]"
      role="img"
      aria-label={
        recent.length
          ? t("format.lastChecks", { count: recent.length })
          : t("format.noChecksYet")
      }
      title={
        recent.length
          ? t("format.lastChecks", { count: recent.length })
          : t("format.noChecksYet")
      }
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
