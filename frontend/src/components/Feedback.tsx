import type { ReactNode } from "react";

import { useI18n } from "../i18n/I18nContext";
import { AlertIcon, RadarIcon, RefreshIcon } from "./Icons";

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 py-20 text-slate-400"
    >
      <span className="sw-spinner" />
      <span className="text-sm tracking-wide">{label || t("feedback.loading")}</span>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className="sw-alert my-4">
      <span className="flex items-start gap-3">
        <AlertIcon size={17} className="mt-0.5 shrink-0 text-rose-300" />
        <span>
          <strong className="font-semibold text-rose-200">{t("feedback.somethingWrong")}</strong>{" "}
          {message}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="sw-btn sw-btn-ghost sw-btn-sm">
            <RefreshIcon size={14} />
            {t("action.retry")}
          </button>
        )}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="sw-btn sw-btn-ghost sw-btn-sm">
            {t("action.dismiss")}
          </button>
        )}
      </span>
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
    <div className="sw-empty">
      <div className="sw-empty-icon">
        <RadarIcon size={28} />
      </div>
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      {hint && <p className="max-w-md text-[13px] leading-relaxed text-slate-400">{hint}</p>}
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "default" | "up" | "down" | "warning" | "accent";
  icon?: ReactNode;
}) {
  return (
    <div className={`sw-stat ${tone}`}>
      <div className="sw-stat-top">
        <div className="sw-stat-label">{label}</div>
        {icon && <div className="sw-stat-icon">{icon}</div>}
      </div>
      <div className="sw-stat-value">{value}</div>
      {sub && <div className="sw-stat-sub">{sub}</div>}
      <div className="sw-stat-track" aria-hidden="true"><span /></div>
    </div>
  );
}
