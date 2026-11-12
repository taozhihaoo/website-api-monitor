import { useState } from "react";
import { Link } from "react-router-dom";

import { useIncidents } from "../api/hooks";
import { EmptyState, ErrorBanner, Spinner } from "../components/Feedback";
import { AlertIcon } from "../components/Icons";
import { StatusBadge } from "../components/StatusBadge";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime, formatDuration } from "../utils/format";

export function IncidentsPage() {
  const { t, locale } = useI18n();
  const [showResolved, setShowResolved] = useState(true);
  const incidents = useIncidents(showResolved ? undefined : false);

  if (incidents.isLoading) {
    return <Spinner label={t("feedback.loadingIncidents")} />;
  }
  if (incidents.isError) {
    return (
      <ErrorBanner message={incidents.error.message} onRetry={() => incidents.refetch()} />
    );
  }

  const items = incidents.data?.items || [];

  return (
    <div className="space-y-6">
      <div className="sw-section-heading">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/80">
            <AlertIcon size={14} />
            {t("nav.sectionManage")}
          </div>
          <h1 className="sw-page-title">{t("incidents.title")}</h1>
          <p className="sw-page-sub">{t("incidents.subtitle")}</p>
        </div>
        <label className="sw-chip cursor-pointer !px-3 !py-2 text-[12.5px] !text-slate-300">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          {t("incidents.showResolved")}
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={t("feedback.noIncidents")}
          hint={
            showResolved
              ? t("feedback.noIncidentsAll")
              : t("feedback.noIncidentsActive")
          }
        />
      ) : (
        <div className="sw-card overflow-x-auto">
          <table className="sw-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t("incidents.colState")}</th>
                <th>{t("incidents.colMonitor")}</th>
                <th>{t("incidents.colCause")}</th>
                <th>{t("incidents.colStarted")}</th>
                <th>{t("incidents.colDuration")}</th>
                <th>{t("incidents.colFailedChecks")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((incident) => (
                <tr key={incident.id}>
                  <td><StatusBadge status={incident.is_resolved ? "up" : "down"} /></td>
                  <td>
                    <Link
                      to={`/monitors/${incident.monitor_id}`}
                      className="font-semibold text-slate-100 transition hover:text-indigo-300"
                    >
                      {incident.monitor_name || `Monitor #${incident.monitor_id}`}
                    </Link>
                  </td>
                  <td className="max-w-[280px] truncate text-slate-400">
                    {incident.cause || "—"}
                  </td>
                  <td className="text-[11.5px] text-slate-500">
                    {formatDateTime(incident.started_at, locale)}
                  </td>
                  <td className="text-slate-300">
                    {incident.is_resolved
                      ? formatDuration(incident.duration_seconds, locale)
                      : t("incidents.ongoing")}
                  </td>
                  <td className="sw-num">{incident.failure_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
