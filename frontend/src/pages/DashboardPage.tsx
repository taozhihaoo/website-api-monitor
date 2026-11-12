import { Link } from "react-router-dom";

import { useChecks, useDashboard, useIncidents, useMonitors } from "../api/hooks";
import type { Monitor } from "../api/types";
import { ErrorBanner, EmptyState, Spinner, StatCard } from "../components/Feedback";
import {
  ActivityIcon,
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  RadarIcon,
  ShieldIcon,
  SignalIcon,
} from "../components/Icons";
import { StatusBadge } from "../components/StatusBadge";
import { UptimeStrip } from "../components/UptimeStrip";
import { useI18n } from "../i18n/I18nContext";
import { formatMs, formatPercent, formatRelative } from "../utils/format";

export function DashboardPage() {
  const { t, locale } = useI18n();
  const summary = useDashboard();
  const monitors = useMonitors();
  const recentIncidents = useIncidents();

  if (summary.isLoading || monitors.isLoading) {
    return <Spinner label={t("feedback.loadingDashboard")} />;
  }

  if (summary.isError) {
    return (
      <ErrorBanner
        message={summary.error.message}
        onRetry={() => summary.refetch()}
      />
    );
  }

  const stats = summary.data;
  const monitorList = monitors.data || [];
  const healthy = (stats?.down ?? 0) === 0 && (stats?.active_incidents ?? 0) === 0;

  return (
    <div className="space-y-7">
      <div className="sw-section-heading">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/80">
            <SignalIcon size={14} />
            {t("app.live")}
          </div>
          <h1 className="sw-page-title">{t("dashboard.title")}</h1>
          <p className="sw-page-sub">{t("dashboard.subtitle")}</p>
        </div>
        <Link to="/monitors" className="sw-btn sw-btn-primary">
          <PlusIcon size={16} />
          {t("action.newMonitor")}
        </Link>
      </div>

      <div className="sw-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("dashboard.statMonitors")} value={stats?.total_monitors ?? 0} icon={<RadarIcon size={13} />} />
        <StatCard label={t("dashboard.statUp")} value={stats?.up ?? 0} tone="up" icon={<CheckIcon size={13} />} />
        <StatCard label={t("dashboard.statDown")} value={stats?.down ?? 0} tone="down" icon={<AlertIcon size={13} />} />
        <StatCard label={t("dashboard.statPaused")} value={stats?.paused ?? 0} icon={<ActivityIcon size={13} />} />
        <StatCard
          label={t("dashboard.statUptime24h")}
          value={formatPercent(stats?.uptime_24h)}
          icon={<SignalIcon size={13} />}
          tone={stats?.uptime_24h !== null && stats?.uptime_24h !== undefined && stats.uptime_24h < 99 ? "warning" : "up"}
        />
        <StatCard
          label={t("dashboard.statActiveIncidents")}
          value={stats?.active_incidents ?? 0}
          icon={<ShieldIcon size={13} />}
          tone={(stats?.active_incidents ?? 0) > 0 ? "warning" : "default"}
        />
      </div>

      <div className="flex items-center gap-2 text-[12px] text-slate-400">
        <span className={healthy ? "text-emerald-400" : "text-amber-400"}>
          {healthy ? <CheckIcon size={15} /> : <AlertIcon size={15} />}
        </span>
        <span className={healthy ? "text-emerald-300/90" : "text-amber-300/90"}>
          {healthy ? t("app.systemHealthy") : t("app.systemIssues")}
        </span>
      </div>

      <section className="sw-card overflow-hidden">
        <div className="sw-card-head">
          <h2 className="sw-card-title">
            <RadarIcon size={15} />
            {t("dashboard.monitorsSection")}
          </h2>
          <Link to="/monitors" className="sw-link">
            {t("action.manage")} <ArrowRightIcon size={14} />
          </Link>
        </div>

        {monitors.isError ? (
          <div className="px-5">
            <ErrorBanner message={(monitors.error as Error).message} onRetry={() => monitors.refetch()} />
          </div>
        ) : monitorList.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={t("feedback.noMonitors")}
              hint={t("feedback.noMonitorsHint")}
              action={
                <Link to="/monitors" className="sw-btn sw-btn-primary">
                  {t("action.createAMonitor")}
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="sw-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t("dashboard.colMonitor")}</th>
                  <th>{t("dashboard.colStatus")}</th>
                  <th>{t("dashboard.colLatency")}</th>
                  <th>{t("dashboard.colUptime24h")}</th>
                  <th className="hidden md:table-cell">{t("dashboard.colLast30Checks")}</th>
                  <th>{t("dashboard.colLastCheck")}</th>
                </tr>
              </thead>
              <tbody>
                {monitorList.map((monitor) => (
                  <MonitorRow key={monitor.id} monitor={monitor} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sw-card overflow-hidden">
        <div className="sw-card-head">
          <h2 className="sw-card-title">
            <AlertIcon size={15} />
            {t("dashboard.recentIncidents")}
          </h2>
          <Link to="/incidents" className="sw-link">
            {t("action.allIncidents")} <ArrowRightIcon size={14} />
          </Link>
        </div>
        {recentIncidents.isError ? (
          <div className="px-5">
            <ErrorBanner
              message={(recentIncidents.error as Error).message}
              onRetry={() => recentIncidents.refetch()}
            />
          </div>
        ) : !recentIncidents.data || recentIncidents.data.items.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-slate-500">{t("feedback.noIncidentsRecorded")}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {recentIncidents.data.items.slice(0, 5).map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-[13px] transition hover:bg-white/[0.025]">
                <StatusBadge status={incident.is_resolved ? "up" : "down"} />
                <Link
                  to={`/monitors/${incident.monitor_id}`}
                  className="font-medium text-slate-100 hover:text-indigo-300"
                >
                  {incident.monitor_name || `Monitor #${incident.monitor_id}`}
                </Link>
                <span className="truncate text-slate-500">{incident.cause || t("feedback.unknownCause")}</span>
                <span className="ml-auto text-[11.5px] text-slate-500">
                  {formatRelative(incident.started_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MonitorRow({ monitor }: { monitor: Monitor }) {
  const { locale } = useI18n();
  const checks = useChecks(monitor.id, 24, 30);
  const status = !monitor.enabled ? "paused" : (monitor.last_status ?? "pending");
  return (
    <tr>
      <td className="max-w-[260px]">
        <Link
          to={`/monitors/${monitor.id}`}
          className="font-semibold text-slate-100 transition hover:text-indigo-300"
        >
          {monitor.name}
        </Link>
        <div className="mt-0.5 truncate text-[11.5px] text-slate-500">{monitor.target_url}</div>
      </td>
      <td>
        <StatusBadge status={status} />
      </td>
      <td className="sw-num">{formatMs(monitor.last_latency_ms)}</td>
      <td className="sw-num">{formatPercent(monitor.uptime_24h)}</td>
      <td className="hidden w-56 md:table-cell">
        <UptimeStrip checks={checks.data?.items} />
      </td>
      <td className="text-[11.5px] text-slate-500">{formatRelative(monitor.last_checked_at, locale)}</td>
    </tr>
  );
}
