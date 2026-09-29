import { useState } from "react";
import { Link } from "react-router-dom";

import { useIncidents } from "../api/hooks";
import { EmptyState, ErrorBanner, Spinner } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateTime, formatDuration } from "../utils/format";

export function IncidentsPage() {
  const [showResolved, setShowResolved] = useState(true);
  const incidents = useIncidents(showResolved ? undefined : false);

  if (incidents.isLoading) {
    return <Spinner label="Loading incidents…" />;
  }
  if (incidents.isError) {
    return (
      <ErrorBanner message={incidents.error.message} onRetry={() => incidents.refetch()} />
    );
  }

  const items = incidents.data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Incidents</h1>
          <p className="text-sm text-slate-500">
            An incident opens when a monitor goes down and closes when it recovers.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
          />
          Show resolved
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No incidents"
          hint={
            showResolved
              ? "Nothing has gone down yet — that's good news."
              : "No ongoing incidents right now."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">Monitor</th>
                <th className="px-4 py-2.5 font-medium">Cause</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 font-medium">Duration</th>
                <th className="px-4 py-2.5 font-medium">Failed checks</th>
              </tr>
            </thead>
            <tbody>
              {items.map((incident) => (
                <tr key={incident.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <StatusBadge status={incident.is_resolved ? "up" : "down"} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/monitors/${incident.monitor_id}`}
                      className="font-medium text-slate-100 hover:text-blue-400"
                    >
                      {incident.monitor_name || `Monitor #${incident.monitor_id}`}
                    </Link>
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-slate-400">
                    {incident.cause || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDateTime(incident.started_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {incident.is_resolved
                      ? formatDuration(incident.duration_seconds)
                      : "ongoing"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-300">
                    {incident.failure_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
