import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useCheckNow,
  useCreateMonitor,
  useDeleteMonitor,
  useMonitors,
  useSetMonitorEnabled,
  useUpdateMonitor,
} from "../api/hooks";
import type { Monitor, MonitorInput } from "../api/types";
import { MonitorFormModal } from "../components/MonitorFormModal";
import { EmptyState, ErrorBanner, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import {
  CheckIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RadarIcon,
  RefreshIcon,
  TrashIcon,
} from "../components/Icons";
import { useI18n } from "../i18n/I18nContext";
import { formatInterval, formatMs, formatPercent, formatRelative } from "../utils/format";

export function MonitorsPage() {
  const { t, locale } = useI18n();
  const monitors = useMonitors();
  const createMonitor = useCreateMonitor();
  const deleteMonitor = useDeleteMonitor();
  const setEnabled = useSetMonitorEnabled();
  const checkNow = useCheckNow();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleCreate = (input: MonitorInput) => {
    createMonitor.mutate(input, {
      onSuccess: () => {
        setCreating(false);
        setActionError(null);
      },
      onError: (error) => setActionError(error.message),
    });
  };

  const handleDelete = (monitor: Monitor) => {
    if (deletingId !== monitor.id) {
      setDeletingId(monitor.id);
      return;
    }
    deleteMonitor.mutate(monitor.id, {
      onError: (error) => setActionError(error.message),
      onSettled: () => setDeletingId(null),
    });
  };

  if (monitors.isLoading) {
    return <Spinner label={t("feedback.loadingMonitors")} />;
  }
  if (monitors.isError) {
    return (
      <ErrorBanner message={monitors.error.message} onRetry={() => monitors.refetch()} />
    );
  }

  const list = monitors.data || [];

  return (
    <div className="space-y-6">
      <div className="sw-section-heading">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/80">
            <RadarIcon size={14} />
            {t("nav.sectionManage")}
          </div>
          <h1 className="sw-page-title">{t("monitors.title")}</h1>
          <p className="sw-page-sub">{t("monitors.subtitle", { count: list.length })}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="sw-btn sw-btn-primary"
        >
          <PlusIcon size={16} />
          {t("action.newMonitor")}
        </button>
      </div>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

      {list.length === 0 ? (
        <EmptyState
          title={t("feedback.noMonitors")}
          hint={t("feedback.noMonitorsHintLong")}
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="sw-btn sw-btn-primary"
            >
              <PlusIcon size={15} />
              {t("action.createFirst")}
            </button>
          }
        />
      ) : (
        <div className="sw-card overflow-x-auto">
          <table className="sw-table min-w-[880px]">
            <thead>
              <tr>
                <th>{t("monitors.colName")}</th>
                <th>{t("dashboard.colStatus")}</th>
                <th>{t("dashboard.colLatency")}</th>
                <th>{t("dashboard.colUptime24h")}</th>
                <th>{t("monitors.colInterval")}</th>
                <th>{t("dashboard.colLastCheck")}</th>
                <th className="!text-right">{t("monitors.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((monitor) => {
                const status = !monitor.enabled ? "paused" : (monitor.last_status ?? "pending");
                return (
                  <tr key={monitor.id}>
                    <td className="max-w-[240px]">
                      <Link
                        to={`/monitors/${monitor.id}`}
                        className="font-semibold text-slate-100 transition hover:text-indigo-300"
                      >
                        {monitor.name}
                      </Link>
                      <div className="mt-0.5 truncate text-[11.5px] text-slate-400">
                        {monitor.target_url}
                      </div>
                    </td>
                    <td><StatusBadge status={status} /></td>
                    <td className="sw-num">{formatMs(monitor.last_latency_ms)}</td>
                    <td className="sw-num">{formatPercent(monitor.uptime_24h)}</td>
                    <td className="text-slate-400">{formatInterval(monitor.interval_seconds, locale)}</td>
                    <td className="text-[11.5px] text-slate-400">
                      {formatRelative(monitor.last_checked_at, locale)}
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={checkNow.isPending && checkNow.variables === monitor.id}
                          onClick={() =>
                            checkNow.mutate(monitor.id, {
                              onError: (error) => setActionError(error.message),
                            })
                          }
                          className="sw-btn sw-btn-ghost sw-btn-sm"
                        >
                          <RefreshIcon size={13} />
                          {t("action.checkNow")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEnabled.mutate(
                              { id: monitor.id, enabled: !monitor.enabled },
                              { onError: (error) => setActionError(error.message) },
                            )
                          }
                          className="sw-btn sw-btn-ghost sw-btn-sm"
                        >
                          {monitor.enabled ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                          {monitor.enabled ? t("action.pause") : t("action.resume")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(monitor)}
                          className="sw-btn sw-btn-ghost sw-btn-sm"
                        >
                          <PencilIcon size={13} />
                          {t("action.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(monitor)}
                          className={`sw-btn sw-btn-sm ${
                            deletingId === monitor.id ? "sw-btn-danger" : "sw-btn-ghost"
                          }`}
                        >
                          <TrashIcon size={13} />
                          {deletingId === monitor.id ? t("action.confirmDelete") : t("action.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
        <CheckIcon size={13} className="text-emerald-500/70" />
        {t("app.updated")}
      </div>

      {creating && (
        <MonitorFormModal
          submitting={createMonitor.isPending}
          serverError={createMonitor.error?.message || null}
          onSubmit={handleCreate}
          onClose={() => {
            setCreating(false);
            createMonitor.reset();
          }}
        />
      )}

      {editing && (
        <EditWrapper
          monitor={editing}
          onDone={() => setEditing(null)}
          onError={(message) => setActionError(message)}
        />
      )}
    </div>
  );
}

function EditWrapper({
  monitor,
  onDone,
  onError,
}: {
  monitor: Monitor;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const update = useUpdateMonitor(monitor.id);
  return (
    <MonitorFormModal
      monitor={monitor}
      submitting={update.isPending}
      serverError={update.error?.message || null}
      onSubmit={(input) =>
        update.mutate(input, {
          onSuccess: onDone,
          onError: (error) => onError(error.message),
        })
      }
      onClose={onDone}
    />
  );
}
