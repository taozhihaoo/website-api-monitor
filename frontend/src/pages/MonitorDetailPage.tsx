import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  useCheckNow,
  useChecks,
  useDeleteMonitor,
  useMonitor,
  useMonitorIncidents,
  useSetMonitorEnabled,
  useSslInfo,
  useUptime,
} from "../api/hooks";
import { ErrorBanner, Spinner, StatCard } from "../components/Feedback";
import { LatencyChart } from "../components/LatencyChart";
import { StatusBadge } from "../components/StatusBadge";
import { UptimeStrip } from "../components/UptimeStrip";
import {
  formatDateTime,
  formatDuration,
  formatInterval,
  formatMs,
  formatPercent,
  formatRelative,
} from "../utils/format";

const WINDOWS = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function MonitorDetailPage() {
  const { id } = useParams();
  const monitorId = id ? Number(id) : undefined;
  const navigate = useNavigate();

  const monitor = useMonitor(monitorId);
  const [window_, setWindow_] = useState("24h");
  const checks = useChecks(monitorId, 24, 100);
  const uptime = useUptime(monitorId, window_);
  const incidents = useMonitorIncidents(monitorId);
  const ssl = useSslInfo(monitorId);
  const checkNow = useCheckNow();
  const setEnabled = useSetMonitorEnabled();
  const deleteMonitor = useDeleteMonitor();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (monitor.isLoading) {
    return <Spinner label="Loading monitor…" />;
  }
  if (monitor.isError) {
    return (
      <ErrorBanner message={monitor.error.message} onRetry={() => monitor.refetch()} />
    );
  }
  if (!monitor.data) {
    return <ErrorBanner message="Monitor not found." />;
  }

  const m = monitor.data;
  const status = !m.enabled ? "paused" : (m.last_status ?? "pending");
  const latency = m.latency_stats;

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteMonitor.mutate(m.id, {
      onSuccess: () => navigate("/monitors"),
      onError: (error) => setActionError(error.message),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{m.name}</h1>
            <StatusBadge status={status} />
          </div>
          <a
            href={m.target_url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm text-blue-400 hover:text-blue-300"
          >
            {m.target_url}
          </a>
          <p className="mt-1 text-xs text-slate-500">
            {m.type} · every {formatInterval(m.interval_seconds)} · timeout {m.timeout_seconds}s
            · last checked {formatRelative(m.last_checked_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            disabled={checkNow.isPending}
            onClick={() =>
              checkNow.mutate(m.id, { onError: (error) => setActionError(error.message) })
            }
            className="rounded-md bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {checkNow.isPending ? "Checking…" : "Check now"}
          </button>
          <button
            type="button"
            onClick={() =>
              setEnabled.mutate(
                { id: m.id, enabled: !m.enabled },
                { onError: (error) => setActionError(error.message) },
              )
            }
            className="rounded-md border border-slate-700 px-3 py-1.5 font-medium text-slate-300 transition hover:bg-slate-800"
          >
            {m.enabled ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className={`rounded-md border px-3 py-1.5 font-medium transition ${
              confirmDelete
                ? "border-red-500 bg-red-600 text-white"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {confirmDelete ? "Confirm delete?" : "Delete"}
          </button>
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Current latency" value={formatMs(m.last_latency_ms)} tone="accent" />
        <StatCard label="Avg latency" value={latency ? formatMs(latency.avg_ms) : "—"} />
        <StatCard label="Min latency" value={latency ? formatMs(latency.min_ms) : "—"} />
        <StatCard label="Max latency" value={latency ? formatMs(latency.max_ms) : "—"} />
        <StatCard
          label={`Uptime ${window_}`}
          value={formatPercent(uptime.data?.uptime_percentage)}
          tone={
            uptime.data?.uptime_percentage !== null &&
            uptime.data?.uptime_percentage !== undefined &&
            uptime.data.uptime_percentage < 99
              ? "down"
              : "up"
          }
          sub={uptime.data ? `${uptime.data.total_checks} checks` : undefined}
        />
        <StatCard
          label="SSL"
          value={
            ssl.data && ssl.data.days_remaining !== null
              ? `${ssl.data.days_remaining}d`
              : ssl.data?.ssl_status === "not_applicable"
                ? "n/a"
                : "—"
          }
          tone={
            ssl.data?.ssl_status === "expired"
              ? "down"
              : ssl.data?.ssl_status === "expiring_soon"
                ? "warning"
                : ssl.data?.ssl_status === "valid"
                  ? "up"
                  : "default"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Response time
          </h2>
          {checks.isError ? (
            <ErrorBanner
              message={(checks.error as Error).message}
              onRetry={() => checks.refetch()}
            />
          ) : (
            <LatencyChart checks={checks.data?.items} />
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Recent checks
          </h2>
          <UptimeStrip checks={checks.data?.items} max={40} />
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Expected status</dt>
              <dd className="tabular-nums text-slate-300">HTTP {m.expected_status}</dd>
            </div>
            {m.keyword && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Keyword ({m.keyword_mode})</dt>
                <dd className="truncate text-slate-300">“{m.keyword}”</dd>
              </div>
            )}
            {m.json_path && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">JSON path</dt>
                <dd className="truncate text-slate-300">
                  {m.json_path}
                  {m.json_expected_value ? ` = ${m.json_expected_value}` : ""}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Next check</dt>
              <dd className="text-slate-300">{formatRelative(m.next_check_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-300">{formatDateTime(m.created_at)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Check history
          </h2>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setWindow_(w.value)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  window_ === w.value
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        {uptime.data && (
          <p className="px-4 pt-3 text-xs text-slate-500">
            {window_} uptime:{" "}
            <span className="font-semibold text-slate-300">
              {formatPercent(uptime.data.uptime_percentage)}
            </span>{" "}
            ({uptime.data.up_checks}/{uptime.data.total_checks} checks)
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">HTTP</th>
                <th className="px-4 py-2 font-medium">Latency</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(checks.data?.items || []).map((check) => (
                <tr key={check.id} className="border-t border-slate-800/60">
                  <td className="px-4 py-2 text-slate-400">{formatDateTime(check.checked_at)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={check.status} />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-300">
                    {check.http_status ?? "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-300">
                    {formatMs(check.latency_ms)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {check.error_message ||
                      [
                        check.keyword_result ? `keyword: ${check.keyword_result}` : null,
                        check.json_result ? `json: ${check.json_result}` : null,
                        check.ssl_status !== "not_applicable" ? `ssl: ${check.ssl_status}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") ||
                      "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {checks.data && checks.data.items.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-500">
              No checks in this window yet.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <h2 className="border-b border-slate-800 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Incidents
        </h2>
        {incidents.isError ? (
          <div className="px-4">
            <ErrorBanner
              message={(incidents.error as Error).message}
              onRetry={() => incidents.refetch()}
            />
          </div>
        ) : !incidents.data || incidents.data.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No incidents for this monitor. 🎉</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {incidents.data.items.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <StatusBadge status={incident.is_resolved ? "up" : "down"} />
                <span className="text-slate-300">{incident.cause || "unknown cause"}</span>
                <span className="text-xs text-slate-500">
                  {formatDateTime(incident.started_at)}
                  {incident.duration_seconds !== null
                    ? ` · lasted ${formatDuration(incident.duration_seconds)}`
                    : " · ongoing"}
                  {` · ${incident.failure_count} failed check${incident.failure_count === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-600">
        SSL badge:{" "}
        {ssl.data
          ? `${ssl.data.ssl_status}${
              ssl.data.expires_at ? ` — expires ${formatDateTime(ssl.data.expires_at)}` : ""
            }`
          : "not monitored for this target"}{" "}
        · <Link to="/monitors" className="text-blue-500 hover:text-blue-400">back to monitors</Link>
      </p>
    </div>
  );
}
