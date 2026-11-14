import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { Monitor, MonitorInput, MonitorType } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { translate } from "../i18n/messages";
import type { MessageKey } from "../i18n/messages";
import { RadarIcon, ShieldIcon } from "./Icons";

type TFunction = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

const englishT: TFunction = (key, vars) => translate("en", key, vars);

const INTERVAL_VALUES = [60, 300, 600, 1800, 3600] as const;
type IntervalKey = "form.interval1m" | "form.interval5m" | "form.interval10m" | "form.interval30m" | "form.interval1h";
const INTERVAL_OPTIONS: { value: number; labelKey: IntervalKey }[] = [
  { value: 60, labelKey: "form.interval1m" },
  { value: 300, labelKey: "form.interval5m" },
  { value: 600, labelKey: "form.interval10m" },
  { value: 1800, labelKey: "form.interval30m" },
  { value: 3600, labelKey: "form.interval1h" },
];

export interface FormState {
  name: string;
  type: MonitorType;
  target_url: string;
  interval_seconds: number;
  custom_interval: string;
  /** Explicit custom mode — the old code inferred it from `custom_interval`,
   * which made selecting "Custom…" impossible to use (it set value to 0 and
   * hid the input until a failed submit). */
  customMode: boolean;
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
  const interval = monitor?.interval_seconds ?? 300;
  const known = INTERVAL_VALUES.includes(interval as (typeof INTERVAL_VALUES)[number]);
  return {
    name: monitor?.name ?? "",
    type: monitor?.type ?? "http",
    target_url: monitor?.target_url ?? "",
    interval_seconds: interval,
    custom_interval: monitor && !known ? String(interval) : "",
    customMode: Boolean(monitor && !known),
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

/**
 * Client-side counterpart of the backend SSRF guard. Parses the hostname
 * instead of prefix-matching the raw URL: `10.example.com` is a public domain
 * (must be allowed) while `172.20.1.1` is RFC1918 (must be rejected).
 * The backend still performs the authoritative check on every request.
 */
export function isPrivateTarget(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
    if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
    let candidate = hostname;
    const mapped = hostname.match(/^::ffff:(.+)$/i);
    if (mapped) {
      const tail = mapped[1];
      if (tail.includes(".")) {
        candidate = tail;
      } else {
        // WHATWG URLs normalise IPv4-mapped IPv6 to hex groups, e.g.
        // [::ffff:10.0.0.1] -> "::ffff:a00:1".
        const groups = tail.split(":").map((group) => parseInt(group, 16));
        const [high, low] = groups.slice(-2);
        candidate = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
      }
    }
    const parts = candidate.split(".");
    if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
      const [a, b] = parts.map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        (a === 169 && b === 254) || // link-local / cloud metadata
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      ) {
        return true;
      }
    }
    return /^f[cd][0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname);
  } catch {
    return false;
  }
}

export function validateMonitorForm(
  state: FormState,
  t: TFunction = englishT,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!state.name.trim()) errors.name = t("form.errorName");
  const url = state.target_url.trim();
  if (!url) {
    errors.target_url = t("form.errorUrlRequired");
  } else if (!/^https?:\/\//i.test(url)) {
    errors.target_url = t("form.errorUrlScheme");
  } else if (state.type === "ssl" && !/^https:\/\//i.test(url)) {
    errors.target_url = t("form.errorUrlSsl");
  } else if (isPrivateTarget(url)) {
    errors.target_url = t("form.errorUrlPrivate");
  }
  const interval = state.customMode
    ? Number(state.custom_interval)
    : state.interval_seconds;
  if (!Number.isInteger(interval) || interval < 60 || interval > 86400) {
    errors.interval_seconds = t("form.errorInterval");
  }
  if (!Number.isInteger(state.timeout_seconds) || state.timeout_seconds < 1 || state.timeout_seconds > 30) {
    errors.timeout_seconds = t("form.errorTimeout");
  }
  if (!Number.isInteger(state.expected_status) || state.expected_status < 100 || state.expected_status > 599) {
    errors.expected_status = t("form.errorExpectedStatus");
  }
  if (state.type === "keyword" && !state.keyword.trim()) {
    errors.keyword = t("form.errorKeyword");
  }
  if (state.type === "api_json" && !state.json_path.trim()) {
    errors.json_path = t("form.errorJsonPath");
  }
  // Only validate the threshold while its input is actually visible. An
  // invisible error used to block submission with no way to see or fix it.
  const sslVisible = state.type !== "ssl" && /^https:\/\//i.test(url) && state.ssl_check_enabled;
  if (sslVisible && (!Number.isInteger(state.ssl_warning_days) || state.ssl_warning_days < 1 || state.ssl_warning_days > 365)) {
    errors.ssl_warning_days = t("form.errorSslWarning");
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
  const { t } = useI18n();
  const [state, setState] = useState<FormState>(() => toFormState(monitor));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isHttps = /^https:\/\//i.test(state.target_url.trim());
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // aria-modal="true" promises assistive tech that focus stays inside the
  // dialog. Deliver on that: initial focus, Tab cycling, Escape and scroll
  // lock, plus focus restoration on close. The effect runs once (a ref keeps
  // the latest onClose) so typing does not re-focus the first field.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("#monitor-name")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => {
      const next: FormState = { ...prev, [key]: value };
      // Switching type or scheme used to leave hidden field values in state,
      // which were then submitted (e.g. an SSL sidecar on an http:// target).
      if (key === "type") {
        const type = value as MonitorType;
        if (type !== "keyword") next.keyword = "";
        if (type !== "api_json") {
          next.json_path = "";
          next.json_expected_value = "";
        }
      }
      if (key === "target_url" && !/^https:\/\//i.test((value as string).trim())) {
        next.ssl_check_enabled = false;
      }
      return next;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateMonitorForm(state, t);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }
    const interval = state.customMode
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
      ssl_check_enabled: isHttps ? state.ssl_check_enabled : false,
      ssl_warning_days: state.ssl_warning_days,
    };
    onSubmit(input);
  };

  const field = "sw-input";
  const label = "sw-label";
  const errorText = "sw-field-error";
  const describedBy = (name: string) => (errors[name] ? `err-${name}` : undefined);
  const invalid = (name: string) => (errors[name] ? true : undefined);
  const errorFor = (name: string) =>
    errors[name] ? (
      <p id={`err-${name}`} className={errorText}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <div
      ref={dialogRef}
      className="sw-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={monitor ? t("form.editTitle", { name: monitor.name }) : t("form.newTitle")}
    >
      <form onSubmit={handleSubmit} noValidate className="sw-modal">
        <div className="sw-modal-head">
          <div className="flex items-start gap-3.5">
            <div className="sw-brand-mark !h-10 !w-10 shrink-0">
              <RadarIcon size={19} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-slate-50">
                {monitor ? t("form.editTitle", { name: monitor.name }) : t("form.newTitle")}
              </h2>
              <p className="mt-1 text-[12px] text-slate-400">{t("form.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sw-btn sw-btn-ghost sw-btn-icon !text-slate-300"
            aria-label={t("action.close")}
          >
            ✕
          </button>
        </div>

        <div className="sw-modal-body">
          {serverError && <div role="alert" className="sw-alert !my-0 mb-5 text-[12.5px]">{serverError}</div>}

          <div className="sw-form-section">
            <span className="sw-chip !text-indigo-300">01</span>
            <span className="sw-form-section-label">{t("form.basicSection")}</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="monitor-name">{t("form.name")}</label>
              <input
                id="monitor-name"
                className={field}
                value={state.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("form.namePlaceholder")}
                aria-invalid={invalid("name")}
                aria-describedby={describedBy("name")}
              />
              {errorFor("name")}
            </div>
            <div>
              <label className={label} htmlFor="monitor-type">{t("form.type")}</label>
              <select
                id="monitor-type"
                className={field}
                value={state.type}
                onChange={(e) => update("type", e.target.value as MonitorType)}
              >
                <option value="http">{t("form.typeHttp")}</option>
                <option value="keyword">{t("form.typeKeyword")}</option>
                <option value="api_json">{t("form.typeJson")}</option>
                <option value="ssl">{t("form.typeSsl")}</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="monitor-url">{t("form.url")}</label>
              <input
                id="monitor-url"
                className={field}
                value={state.target_url}
                onChange={(e) => update("target_url", e.target.value)}
                placeholder={t("form.urlPlaceholder")}
                aria-invalid={invalid("target_url")}
                aria-describedby={describedBy("target_url")}
              />
              {errorFor("target_url")}
            </div>
          </div>

          <div className="sw-form-section">
            <span className="sw-chip !text-indigo-300">02</span>
            <span className="sw-form-section-label">{t("form.scheduleSection")}</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="monitor-interval">{t("form.interval")}</label>
              <select
                id="monitor-interval"
                className={field}
                value={state.customMode ? "" : state.interval_seconds}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setState((prev) => ({
                      ...prev,
                      customMode: true,
                      custom_interval: String(prev.interval_seconds || 300),
                    }));
                  } else {
                    setState((prev) => ({
                      ...prev,
                      customMode: false,
                      custom_interval: "",
                      interval_seconds: Number(e.target.value),
                    }));
                  }
                }}
              >
                {INTERVAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t("form.intervalEvery", { label: t(option.labelKey) })}
                  </option>
                ))}
                <option value="">{t("form.custom")}</option>
              </select>
              {state.customMode && (
                <input
                  aria-label={t("form.customAria")}
                  className={`${field} mt-2`}
                  type="number"
                  min={60}
                  max={86400}
                  step={1}
                  value={state.custom_interval}
                  onChange={(e) => update("custom_interval", e.target.value)}
                  placeholder={t("form.customPlaceholder")}
                />
              )}
              {errorFor("interval_seconds")}
            </div>
            <div>
              <label className={label} htmlFor="monitor-timeout">{t("form.timeout")}</label>
              <input
                id="monitor-timeout"
                className={field}
                type="number"
                min={1}
                max={30}
                step={1}
                value={state.timeout_seconds}
                onChange={(e) => update("timeout_seconds", Number(e.target.value))}
                aria-invalid={invalid("timeout_seconds")}
                aria-describedby={describedBy("timeout_seconds")}
              />
              {errorFor("timeout_seconds")}
            </div>
            <div>
              <label className={label} htmlFor="monitor-status">{t("form.expectedStatus")}</label>
              <input
                id="monitor-status"
                className={field}
                type="number"
                min={100}
                max={599}
                step={1}
                value={state.expected_status}
                onChange={(e) => update("expected_status", Number(e.target.value))}
                aria-invalid={invalid("expected_status")}
                aria-describedby={describedBy("expected_status")}
              />
              {errorFor("expected_status")}
            </div>

            {state.type === "keyword" && (
              <>
                <div>
                  <label className={label} htmlFor="monitor-keyword">{t("form.keyword")}</label>
                  <input
                    id="monitor-keyword"
                    className={field}
                    value={state.keyword}
                    onChange={(e) => update("keyword", e.target.value)}
                    placeholder={t("form.keywordPlaceholder")}
                    aria-invalid={invalid("keyword")}
                    aria-describedby={describedBy("keyword")}
                  />
                  {errorFor("keyword")}
                </div>
                <div>
                  <label className={label} htmlFor="monitor-keyword-mode">{t("form.rule")}</label>
                  <select
                    id="monitor-keyword-mode"
                    className={field}
                    value={state.keyword_mode}
                    onChange={(e) =>
                      update("keyword_mode", e.target.value as "contains" | "not_contains")
                    }
                  >
                    <option value="contains">{t("form.ruleContains")}</option>
                    <option value="not_contains">{t("form.ruleNotContains")}</option>
                  </select>
                </div>
              </>
            )}

            {state.type === "api_json" && (
              <>
                <div>
                  <label className={label} htmlFor="monitor-json-path">{t("form.jsonPath")}</label>
                  <input
                    id="monitor-json-path"
                    className={field}
                    value={state.json_path}
                    onChange={(e) => update("json_path", e.target.value)}
                    placeholder={t("form.jsonPathPlaceholder")}
                    aria-invalid={invalid("json_path")}
                    aria-describedby={describedBy("json_path")}
                  />
                  {errorFor("json_path")}
                </div>
                <div>
                  <label className={label} htmlFor="monitor-json-expected">{t("form.jsonExpected")}</label>
                  <input
                    id="monitor-json-expected"
                    className={field}
                    value={state.json_expected_value}
                    onChange={(e) => update("json_expected_value", e.target.value)}
                    placeholder={t("form.jsonExpectedPlaceholder")}
                  />
                </div>
              </>
            )}

            {state.type !== "ssl" && isHttps && (
              <div className="sm:col-span-2">
                <label className="sw-toggle-row">
                  <ShieldIcon size={17} className="shrink-0 text-emerald-400" />
                  <span className="flex-1">{t("form.sslSidecar")}</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-500"
                    checked={state.ssl_check_enabled}
                    onChange={(e) => update("ssl_check_enabled", e.target.checked)}
                  />
                </label>
                {state.ssl_check_enabled && (
                  <div className="mt-3">
                    <label className={label} htmlFor="monitor-ssl-warning">{t("form.sslWarn")}</label>
                    <input
                      id="monitor-ssl-warning"
                      className={`${field} max-w-[200px]`}
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      value={state.ssl_warning_days}
                      onChange={(e) => update("ssl_warning_days", Number(e.target.value))}
                      aria-invalid={invalid("ssl_warning_days")}
                      aria-describedby={describedBy("ssl_warning_days")}
                    />
                    {errorFor("ssl_warning_days")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="sw-modal-foot">
          <button type="button" onClick={onClose} className="sw-btn sw-btn-ghost">
            {t("action.cancel")}
          </button>
          <button type="submit" disabled={submitting} className="sw-btn sw-btn-primary">
            {submitting ? t("action.saving") : monitor ? t("action.saveChanges") : t("action.createMonitor")}
          </button>
        </div>
      </form>
    </div>
  );
}
