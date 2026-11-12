import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  WINDOW_HOURS,
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
import {
  ActivityIcon,
  ArrowRightIcon,
  ClockIcon,
  ExternalIcon,
  PauseIcon,
  PlayIcon,
  RadarIcon,
  RefreshIcon,
  ShieldIcon,
  SignalIcon,
  TrashIcon,
} from "../components/Icons";
import { StatusBadge } from "../components/StatusBadge";
import { UptimeStrip } from "../components/UptimeStrip";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import {
  formatDateTime,
  formatDuration,
  formatInterval,
  formatMs,
  formatPercent,
  formatRelative,
} from "../utils/format";

const WINDOWS = [
  { value: "1h", labelKey: "detail.window1h" },
  { value: "24h", labelKey: "detail.window24h" },
  { value: "7d", labelKey: "detail.window7d" },
  { value: "30d", labelKey: "detail.window30d" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

const WINDOW_LABEL_KEY: Record<string, MessageKey> = Object.fromEntries(
  WINDOWS.map((w) => [w.value, w.labelKey]),
);

export function MonitorDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const monitorId = id ? Number(id) : undefined;
  const navigate = useNavigate();

  const monitor = useMonitor(monitorId);
  const [window_, setWindow_] = useState<string>("24h");
  // The history table must follow the selected window. Previously it always
  // requested 24h while the uptime card showed 7d/30d — inconsistent data.
  const checks = useChecks(monitorId, WINDOW_HOURS[window_] ?? 24, 100);
  const uptime = useUptime(monitorId, window_);
  const incidents = useMonitorIncidents(monitorId);
  const ssl = useSslInfo(monitorId);
  const checkNow = useCheckNow();
  const setEnabled = useSetMonitorEnabled();
  const deleteMonitor = useDeleteMonitor();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (monitor.isLoading) {
    return <Spinner label={t("feedback.loadingMonitor")} />;
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
      <div className="sw-section-heading">
        <div className="min-w-0">
          <Link to="/monitors" className="sw-link mb-3 !text-[11.5px]">
            ← {t("action.backToMonitors")}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="sw-page-title">{m.name}</h1>
            <StatusBadge status={status} />
          </div>
          <a
            href={m.target_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex max-w-full items-center gap-1.5 break-all text-[12.5px] text-indigo-300 transition hover:text-indigo-200"
          >
            {m.target_url}
            <ExternalIcon size={13} className="shrink-0" />
          </a>
          <p className="mt-2 text-[11.5px] text-slate-500">
            {t("detail.meta", {
              type: m.type,
              interval: formatInterval(m.interval_seconds, locale),
              timeout: m.timeout_seconds,
              last: formatRelative(m.last_checked_at, locale),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={checkNow.isPending}
            onClick={() =>
              checkNow.mutate(m.id, { onError: (error) => setActionError(error.message) })
            }
            className="sw-btn sw-btn-primary"
          >
            <RefreshIcon size={15} />
            {checkNow.isPending ? t("action.checking") : t("action.checkNow")}
          </button>
          <button
            type="button"
            onClick={() =>
              setEnabled.mutate(
                { id: m.id, enabled: !m.enabled },
                { onError: (error) => setActionError(error.message) },
              )
            }
            className="sw-btn sw-btn-ghost"
          >
            {m.enabled ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
            {m.enabled ? t("action.pause") : t("action.resume")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className={`sw-btn ${confirmDelete ? "sw-btn-danger" : "sw-btn-ghost"}`}
          >
            <TrashIcon size={15} />
            {confirmDelete ? t("action.confirmDelete") : t("action.delete")}
          </button>
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}

      <div className="sw-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("detail.currentLatency")} value={formatMs(m.last_latency_ms)} tone="accent" icon={<SignalIcon size={13} />} />
        <StatCard label={t("detail.avgLatency")} value={latency ? formatMs(latency.avg_ms) : "—"} icon={<ActivityIcon size={13} />} />
        <StatCard label={t("detail.minLatency")} value={latency ? formatMs(latency.min_ms) : "—"} />
        <StatCard label={t("detail.maxLatency")} value={latency ? formatMs(latency.max_ms) : "—"} />
        <StatCard
          label={t("detail.uptime", { window: t(WINDOW_LABEL_KEY[window_] ?? "detail.window24h") })}
          value={formatPercent(uptime.data?.uptime_percentage)}
          tone={
            uptime.data?.uptime_percentage !== null &&
            uptime.data?.uptime_percentage !== undefined &&
            uptime.data.uptime_percentage < 99
              ? "down"
              : "up"
          }
          sub={uptime.data ? t("detail.checks", { count: uptime.data.total_checks }) : undefined}
        />
        <StatCard
          label={t("detail.ssl")}
          value={
            ssl.data && ssl.data.days_remaining !== null
              ? `${ssl.data.days_remaining}d`
              : ssl.data?.ssl_status === "not_applicable"
                ? "n/a"
                : "—"
          }
          icon={<ShieldIcon size={13} />}
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
        <section className="sw-card p-5 lg:col-span-2">
          <h2 className="sw-card-title mb-4">
            <ActivityIcon size={15} />
            {t("detail.responseTime")}
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

        <section className="sw-card p-5">
          <h2 className="sw-card-title mb-4">
            <RadarIcon size={15} />
            {t("detail.recentChecks")}
          </h2>
          <UptimeStrip checks={checks.data?.items} max={40} />
          <dl className="mt-5 space-y-2 text-[12.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{t("detail.expectedStatus")}</dt>
              <dd className="tabular-nums text-slate-200">{t("format.httpPrefix", { code: m.expected_status })}</dd>
            </div>
            {m.keyword && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{t("detail.keyword", { mode: m.keyword_mode })}</dt>
                <dd className="truncate text-slate-200">“{m.keyword}”</dd>
              </div>
            )}
            {m.json_path && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{t("detail.jsonPath")}</dt>
                <dd className="truncate text-slate-200">
                  {m.json_path}
                  {m.json_expected_value ? ` = ${m.json_expected_value}` : ""}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{t("detail.nextCheck")}</dt>
              <dd className="text-slate-200">{formatRelative(m.next_check_at, locale)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{t("detail.created")}</dt>
              <dd className="text-slate-200">{formatDateTime(m.created_at, locale)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="sw-card overflow-hidden">
        <div className="sw-card-head">
          <h2 className="sw-card-title">
            <ClockIcon size={15} />
            {t("detail.checkHistory")}
          </h2>
          <div className="sw-lang !p-[2px]">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setWindow_(w.value)}
                className={window_ === w.value ? "active" : ""}
              >
                {t(w.labelKey)}
              </button>
            ))}
          </div>
        </div>
        {uptime.data && (
          <p className="px-5 pt-4 text-[11.5px] text-slate-500">
            {t("detail.uptimeSummary", { window: t(WINDOW_LABEL_KEY[window_] ?? "detail.window24h") })}{" "}
            <span className="font-semibold text-slate-200">
              {formatPercent(uptime.data.uptime_percentage)}
            </span>{" "}
            ({uptime.data.up_checks}/{uptime.data.total_checks} {t("detail.checksUnit")})
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="sw-table min-w-[640px]">
            <thead>
              <tr>
                <th>{t("detail.colTime")}</th>
                <th>{t("dashboard.colStatus")}</th>
                <th>{t("detail.colHttp")}</th>
                <th>{t("dashboard.colLatency")}</th>
                <th>{t("detail.colDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {(checks.data?.items || []).map((check) => (
                <tr key={check.id}>
                  <td className="text-slate-400">{formatDateTime(check.checked_at, locale)}</td>
                  <td><StatusBadge status={check.status} /></td>
                  <td className="sw-num">{check.http_status ?? "—"}</td>
                  <td className="sw-num">{formatMs(check.latency_ms)}</td>
                  <td className="text-[11.5px] text-slate-500">
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
          {checks.data?.items && checks.data.items.length === 0 && (
            <p className="px-5 py-8 text-[13px] text-slate-500">{t("feedback.noChecks")}</p>
          )}
        </div>
      </section>

      <section className="sw-card overflow-hidden">
        <div className="sw-card-head">
          <h2 className="sw-card-title">
            <ShieldIcon size={15} />
            {t("detail.incidents")}
          </h2>
        </div>
        {incidents.isError ? (
          <div className="px-5">
            <ErrorBanner
              message={(incidents.error as Error).message}
              onRetry={() => incidents.refetch()}
            />
          </div>
        ) : !incidents.data || incidents.data.items.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-slate-500">{t("feedback.noIncidentsForMonitor")}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {incidents.data.items.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-[13px]">
                <StatusBadge status={incident.is_resolved ? "up" : "down"} />
                <span className="text-slate-300">{incident.cause || t("feedback.unknownCause")}</span>
                <span className="text-[11.5px] text-slate-500">
                  {formatDateTime(incident.started_at, locale)}
                  {incident.duration_seconds !== null
                    ? ` · ${t("detail.lasted", { duration: formatDuration(incident.duration_seconds, locale) })}`
                    : ` · ${t("detail.ongoing")}`}
                  {` · ${t(incident.failure_count === 1 ? "detail.failedCheck" : "detail.failedChecks", { count: incident.failure_count })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600">
        {t("detail.sslBadge")}{" "}
        {ssl.data
          ? `${ssl.data.ssl_status}${
              ssl.data.expires_at
                ? t("detail.expires", { date: formatDateTime(ssl.data.expires_at, locale) })
                : ""
            }`
          : t("detail.notMonitored")}{" "}
        · <Link to="/monitors" className="sw-link !text-[11.5px]">{t("action.backToMonitors")} <ArrowRightIcon size={12} /></Link>
      </p>
    </div>
  );
}
