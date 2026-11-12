import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

type BadgeStyle = { color: string; labelKey: MessageKey };

const STYLES: Record<string, BadgeStyle> = {
  up: { color: "var(--up)", labelKey: "status.up" },
  down: { color: "var(--down)", labelKey: "status.down" },
  paused: { color: "var(--paused)", labelKey: "status.paused" },
  pending: { color: "#60a5fa", labelKey: "status.pending" },
  valid: { color: "var(--up)", labelKey: "status.sslOk" },
  expiring_soon: { color: "var(--warn)", labelKey: "status.sslExpiring" },
  expired: { color: "var(--down)", labelKey: "status.sslExpired" },
  unknown: { color: "var(--paused)", labelKey: "status.sslUnknown" },
  not_applicable: { color: "#52627d", labelKey: "status.sslNa" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const style = STYLES[status || "pending"] || STYLES.pending;
  return (
    <span
      className="sw-badge"
      style={{ color: style.color, borderColor: "color-mix(in srgb, currentColor 28%, transparent)" }}
    >
      <span className="sw-dot" aria-hidden="true" />
      {t(style.labelKey)}
    </span>
  );
}
