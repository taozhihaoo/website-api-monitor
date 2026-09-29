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
import { formatInterval, formatMs, formatPercent, formatRelative } from "../utils/format";

export function MonitorsPage() {
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
    return <Spinner label="Loading monitors…" />;
  }
  if (monitors.isError) {
    return (
      <ErrorBanner message={monitors.error.message} onRetry={() => monitors.refetch()} />
    );
  }

  const list = monitors.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Monitors</h1>
          <p className="text-sm text-slate-500">{list.length} configured</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          + New monitor
        </button>
      </div>

      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}

      {list.length === 0 ? (
        <EmptyState
          title="No monitors yet"
          hint="Monitors run on a schedule: HTTP status, keyword presence, JSON health checks and SSL certificate expiry."
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Create your first monitor
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Latency</th>
                <th className="px-4 py-2.5 font-medium">Uptime 24h</th>
                <th className="px-4 py-2.5 font-medium">Interval</th>
                <th className="px-4 py-2.5 font-medium">Last check</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((monitor) => {
                const status = !monitor.enabled ? "paused" : (monitor.last_status ?? "pending");
                return (
                  <tr key={monitor.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                    <td className="max-w-[240px] px-4 py-3">
                      <Link
                        to={`/monitors/${monitor.id}`}
                        className="font-medium text-slate-100 hover:text-blue-400"
                      >
                        {monitor.name}
                      </Link>
                      <div className="truncate text-xs text-slate-500">
                        {monitor.target_url}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">
                      {formatMs(monitor.last_latency_ms)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">
                      {formatPercent(monitor.uptime_24h)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {formatInterval(monitor.interval_seconds)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatRelative(monitor.last_checked_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                        <button
                          type="button"
                          disabled={checkNow.isPending}
                          onClick={() =>
                            checkNow.mutate(monitor.id, {
                              onError: (error) => setActionError(error.message),
                            })
                          }
                          className="rounded border border-slate-700 px-2 py-1 font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                        >
                          Check now
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEnabled.mutate(
                              { id: monitor.id, enabled: !monitor.enabled },
                              { onError: (error) => setActionError(error.message) },
                            )
                          }
                          className="rounded border border-slate-700 px-2 py-1 font-medium text-slate-300 transition hover:bg-slate-800"
                        >
                          {monitor.enabled ? "Pause" : "Resume"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(monitor)}
                          className="rounded border border-slate-700 px-2 py-1 font-medium text-slate-300 transition hover:bg-slate-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(monitor)}
                          className={`rounded border px-2 py-1 font-medium transition ${
                            deletingId === monitor.id
                              ? "border-red-500 bg-red-600 text-white"
                              : "border-slate-700 text-slate-300 hover:bg-slate-800"
                          }`}
                        >
                          {deletingId === monitor.id ? "Confirm delete?" : "Delete"}
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

      {editing && <EditWrapper monitor={editing} onDone={() => setEditing(null)} onError={(message) => setActionError(message)} />}
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
