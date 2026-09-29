import { useState } from "react";
import type { FormEvent } from "react";

import type { Monitor, MonitorInput, MonitorType } from "../api/types";

const INTERVAL_OPTIONS = [
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
];

interface FormState {
  name: string;
  type: MonitorType;
  target_url: string;
  interval_seconds: number;
  custom_interval: string;
  timeout_seconds: number;
  expected_status: number;
  keyword: string;
  keyword_mode: "contains" | "not_contains";
  json_path: string;
  json_expected_value: string;
  ssl_check_enabled: boolean;
  ssl_warning_days: number;
}

function toFormState(monitor?: Monitor | null): FormState {
  const known = INTERVAL_OPTIONS.some((o) => o.value === (monitor?.interval_seconds ?? 300));
  return {
    name: monitor?.name ?? "",
    type: monitor?.type ?? "http",
    target_url: monitor?.target_url ?? "",
    interval_seconds: monitor?.interval_seconds ?? 300,
    custom_interval: monitor && !known ? String(monitor.interval_seconds) : "",
    timeout_seconds: monitor?.timeout_seconds ?? 10,
    expected_status: monitor?.expected_status ?? 200,
    keyword: monitor?.keyword ?? "",
    keyword_mode: monitor?.keyword_mode ?? "contains",
    json_path: monitor?.json_path ?? "",
    json_expected_value: monitor?.json_expected_value ?? "",
    ssl_check_enabled: monitor?.ssl_check_enabled ?? false,
    ssl_warning_days: monitor?.ssl_warning_days ?? 30,
  };
}

export function validateMonitorForm(state: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!state.name.trim()) errors.name = "Name is required.";
  const url = state.target_url.trim();
  if (!url) {
    errors.target_url = "URL is required.";
  } else if (!/^https?:\/\//i.test(url)) {
    errors.target_url = "URL must start with http:// or https://.";
  } else if (state.type === "ssl" && !/^https:\/\//i.test(url)) {
    errors.target_url = "SSL monitors require an https:// URL.";
  } else if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|169\.254\.)/i.test(url)) {
    errors.target_url = "Private/loopback addresses are not allowed.";
  }
  const interval = state.custom_interval
    ? Number(state.custom_interval)
    : state.interval_seconds;
  if (!Number.isFinite(interval) || interval < 60 || interval > 86400) {
    errors.interval_seconds = "Interval must be between 60 and 86400 seconds.";
  }
  if (state.timeout_seconds < 1 || state.timeout_seconds > 30) {
    errors.timeout_seconds = "Timeout must be between 1 and 30 seconds.";
  }
  if (state.expected_status < 100 || state.expected_status > 599) {
    errors.expected_status = "Expected status must be an HTTP status code (100–599).";
  }
  if (state.type === "keyword" && !state.keyword.trim()) {
    errors.keyword = "Keyword is required for keyword monitors.";
  }
  if (state.type === "api_json" && !state.json_path.trim()) {
    errors.json_path = "JSON path is required for API JSON monitors.";
  }
  if (state.ssl_warning_days < 1 || state.ssl_warning_days > 365) {
    errors.ssl_warning_days = "Warning threshold must be 1–365 days.";
  }
  return errors;
}

export function MonitorFormModal({
  monitor,
  submitting,
  serverError,
  onSubmit,
  onClose,
}: {
  monitor?: Monitor | null;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (input: MonitorInput) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<FormState>(() => toFormState(monitor));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isHttps = /^https:\/\//i.test(state.target_url.trim());

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateMonitorForm(state);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }
    const interval = state.custom_interval
      ? Number(state.custom_interval)
      : state.interval_seconds;
    const input: MonitorInput = {
      name: state.name.trim(),
      type: state.type,
      target_url: state.target_url.trim(),
      interval_seconds: interval,
      timeout_seconds: state.timeout_seconds,
      expected_status: state.expected_status,
      keyword: state.type === "keyword" || state.keyword ? state.keyword.trim() || null : null,
      keyword_mode: state.keyword_mode,
      json_path: state.type === "api_json" ? state.json_path.trim() : null,
      json_expected_value:
        state.type === "api_json" && state.json_expected_value.trim()
          ? state.json_expected_value.trim()
          : null,
      ssl_check_enabled: state.ssl_check_enabled,
      ssl_warning_days: state.ssl_warning_days,
    };
    onSubmit(input);
  };

  const field =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400";
  const errorText = "mt-1 text-xs text-red-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={monitor ? "Edit monitor" : "New monitor"}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 className="mb-4 text-lg font-bold text-slate-100">
          {monitor ? `Edit monitor — ${monitor.name}` : "New monitor"}
        </h2>

        {serverError && (
          <div role="alert" className="mb-4 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="monitor-name">Name</label>
            <input
              id="monitor-name"
              className={field}
              value={state.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Marketing site"
            />
            {errors.name && <p className={errorText}>{errors.name}</p>}
          </div>
          <div>
            <label className={label} htmlFor="monitor-type">Type</label>
            <select
              id="monitor-type"
              className={field}
              value={state.type}
              onChange={(e) => update("type", e.target.value as MonitorType)}
            >
              <option value="http">HTTP status</option>
              <option value="keyword">Keyword</option>
              <option value="api_json">API JSON health</option>
              <option value="ssl">SSL certificate only</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="monitor-url">URL</label>
            <input
              id="monitor-url"
              className={field}
              value={state.target_url}
              onChange={(e) => update("target_url", e.target.value)}
              placeholder="https://example.com"
            />
            {errors.target_url && <p className={errorText}>{errors.target_url}</p>}
          </div>

          <div>
            <label className={label} htmlFor="monitor-interval">Check interval</label>
            <select
              id="monitor-interval"
              className={field}
              value={state.custom_interval ? "" : state.interval_seconds}
              onChange={(e) => {
                update("custom_interval", "");
                update("interval_seconds", Number(e.target.value));
              }}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Every {option.label}
                </option>
              ))}
              <option value="">Custom…</option>
            </select>
            {state.custom_interval !== "" || errors.interval_seconds ? (
              <input
                aria-label="Custom interval in seconds"
                className={`${field} mt-2`}
                type="number"
                min={60}
                max={86400}
                value={state.custom_interval}
                onChange={(e) => update("custom_interval", e.target.value)}
                placeholder="Seconds (60–86400)"
              />
            ) : null}
            {errors.interval_seconds && <p className={errorText}>{errors.interval_seconds}</p>}
          </div>
          <div>
            <label className={label} htmlFor="monitor-timeout">Timeout (seconds)</label>
            <input
              id="monitor-timeout"
              className={field}
              type="number"
              min={1}
              max={30}
              value={state.timeout_seconds}
              onChange={(e) => update("timeout_seconds", Number(e.target.value))}
            />
            {errors.timeout_seconds && <p className={errorText}>{errors.timeout_seconds}</p>}
          </div>

          <div>
            <label className={label} htmlFor="monitor-status">Expected status</label>
            <input
              id="monitor-status"
              className={field}
              type="number"
              min={100}
              max={599}
              value={state.expected_status}
              onChange={(e) => update("expected_status", Number(e.target.value))}
            />
            {errors.expected_status && <p className={errorText}>{errors.expected_status}</p>}
          </div>

          {state.type === "keyword" && (
            <>
              <div>
                <label className={label} htmlFor="monitor-keyword">Keyword</label>
                <input
                  id="monitor-keyword"
                  className={field}
                  value={state.keyword}
                  onChange={(e) => update("keyword", e.target.value)}
                  placeholder="Example Domain"
                />
                {errors.keyword && <p className={errorText}>{errors.keyword}</p>}
              </div>
              <div>
                <label className={label} htmlFor="monitor-keyword-mode">Rule</label>
                <select
                  id="monitor-keyword-mode"
                  className={field}
                  value={state.keyword_mode}
                  onChange={(e) =>
                    update("keyword_mode", e.target.value as "contains" | "not_contains")
                  }
                >
                  <option value="contains">Body contains keyword</option>
                  <option value="not_contains">Body does NOT contain keyword</option>
                </select>
              </div>
            </>
          )}

          {state.type === "api_json" && (
            <>
              <div>
                <label className={label} htmlFor="monitor-json-path">JSON path</label>
                <input
                  id="monitor-json-path"
                  className={field}
                  value={state.json_path}
                  onChange={(e) => update("json_path", e.target.value)}
                  placeholder="completed  ·  data.items.0.status"
                />
                {errors.json_path && <p className={errorText}>{errors.json_path}</p>}
              </div>
              <div>
                <label className={label} htmlFor="monitor-json-expected">Expected value (optional)</label>
                <input
                  id="monitor-json-expected"
                  className={field}
                  value={state.json_expected_value}
                  onChange={(e) => update("json_expected_value", e.target.value)}
                  placeholder='false  ·  "ok"  ·  200'
                />
              </div>
            </>
          )}

          {state.type !== "ssl" && isHttps && (
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                  checked={state.ssl_check_enabled}
                  onChange={(e) => update("ssl_check_enabled", e.target.checked)}
                />
                Also monitor SSL certificate expiry
              </label>
              {state.ssl_check_enabled && (
                <div className="mt-2">
                  <label className={label} htmlFor="monitor-ssl-warning">Warn when expiring within (days)</label>
                  <input
                    id="monitor-ssl-warning"
                    className={`${field} max-w-[180px]`}
                    type="number"
                    min={1}
                    max={365}
                    value={state.ssl_warning_days}
                    onChange={(e) => update("ssl_warning_days", Number(e.target.value))}
                  />
                  {errors.ssl_warning_days && <p className={errorText}>{errors.ssl_warning_days}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Saving…" : monitor ? "Save changes" : "Create monitor"}
          </button>
        </div>
      </form>
    </div>
  );
}
