import { Link } from "react-router-dom";

import { useChecks, useDashboard, useIncidents, useMonitors } from "../api/hooks";
import type { Monitor } from "../api/types";
import { ErrorBanner, EmptyState, Spinner, StatCard } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { UptimeStrip } from "../components/UptimeStrip";
import {
  formatMs,
  formatPercent,
  formatRelative,
} from "../utils/format";

export function DashboardPage() {
  const summary = useDashboard();
  const monitors = useMonitors();
  const recentIncidents = useIncidents();

  if (summary.isLoading || monitors.isLoading) {
    return <Spinner label="Loading dashboard…" />;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of all your monitors</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Monitors" value={stats?.total_monitors ?? 0} />
        <StatCard label="Up" value={stats?.up ?? 0} tone="up" />
        <StatCard label="Down" value={stats?.down ?? 0} tone="down" />
        <StatCard label="Paused" value={stats?.paused ?? 0} />
        <StatCard
          label="24h uptime"
          value={formatPercent(stats?.uptime_24h)}
          tone={stats?.uptime_24h !== null && stats?.uptime_24h !== undefined && stats.uptime_24h < 99 ? "warning" : "up"}
        />
        <StatCard
          label="Active incidents"
          value={stats?.active_incidents ?? 0}
          tone={(stats?.active_incidents ?? 0) > 0 ? "warning" : "default"}
        />
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Monitors
          </h2>
          <Link to="/monitors" className="text-sm font-medium text-blue-400 hover:text-blue-300">
            Manage →
          </Link>
        </div>

        {monitors.isError ? (
          <div className="px-4">
            <ErrorBanner message={(monitors.error as Error).message} onRetry={() => monitors.refetch()} />
          </div>
        ) : monitorList.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No monitors yet"
              hint="Create your first monitor to start tracking uptime, latency and SSL."
              action={
                <Link
                  to="/monitors"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  Create a monitor
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-medium">Monitor</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">Uptime 24h</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Last 30 checks</th>
                  <th className="px-4 py-2 font-medium">Last check</th>
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

      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Recent incidents
          </h2>
          <Link to="/incidents" className="text-sm font-medium text-blue-400 hover:text-blue-300">
            All incidents →
          </Link>
        </div>
        {recentIncidents.isError ? (
          <div className="px-4">
            <ErrorBanner
              message={(recentIncidents.error as Error).message}
              onRetry={() => recentIncidents.refetch()}
            />
          </div>
        ) : !recentIncidents.data || recentIncidents.data.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No incidents recorded. 🎉</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {recentIncidents.data.items.slice(0, 5).map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <StatusBadge status={incident.is_resolved ? "up" : "down"} />
                <Link
                  to={`/monitors/${incident.monitor_id}`}
                  className="font-medium text-slate-200 hover:text-blue-400"
                >
                  {incident.monitor_name || `Monitor #${incident.monitor_id}`}
                </Link>
                <span className="text-slate-500">{incident.cause || "unknown cause"}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {formatRelative(incident.started_at)}
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
  const checks = useChecks(monitor.id, 24, 30);
  const status = !monitor.enabled ? "paused" : (monitor.last_status ?? "pending");
  return (
    <tr className="border-t border-slate-800/60 hover:bg-slate-800/30">
      <td className="max-w-[260px] px-4 py-3">
        <Link
          to={`/monitors/${monitor.id}`}
          className="font-medium text-slate-100 hover:text-blue-400"
        >
          {monitor.name}
        </Link>
        <div className="truncate text-xs text-slate-500">{monitor.target_url}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={status} />
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-300">{formatMs(monitor.last_latency_ms)}</td>
      <td className="px-4 py-3 tabular-nums text-slate-300">{formatPercent(monitor.uptime_24h)}</td>
      <td className="hidden w-56 px-4 py-3 md:table-cell">
        <UptimeStrip checks={checks.data?.items} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">{formatRelative(monitor.last_checked_at)}</td>
    </tr>
  );
}
