import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useTestWebhook, useUpdateWebhook } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/Feedback";
import { formatDateTime } from "../utils/format";

export function SettingsPage() {
  const { user } = useAuth();
  const updateWebhook = useUpdateWebhook();
  const testWebhook = useTestWebhook();
  const [webhookUrl, setWebhookUrl] = useState(user?.webhook_url ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWebhookUrl(user?.webhook_url ?? "");
  }, [user?.webhook_url]);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const trimmed = webhookUrl.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setError("Webhook URL must start with http:// or https://.");
      return;
    }
    updateWebhook.mutate(trimmed || null, {
      onSuccess: () => setSaved(true),
      onError: (err) => setError(err.message),
    });
  };

  const handleTest = () => {
    setError(null);
    testWebhook.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === "sent") {
          setSaved(false);
        } else {
          setError(result.detail || "Test delivery failed.");
        }
      },
      onError: (err) => setError(err.message),
    });
  };

  const field =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Account and notification preferences</p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Account
        </h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Email</dt>
            <dd className="text-slate-200">{user?.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Member since</dt>
            <dd className="text-slate-200">{formatDateTime(user?.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Notifications — webhook
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          SiteWatch POSTs a JSON payload to this URL when a monitor goes down, recovers,
          or its SSL certificate enters the warning window. Alerts are deduplicated: one
          notification per state change, not per check.
        </p>
        {error && <ErrorBanner message={error} onRetry={() => setError(null)} />}
        {saved && (
          <div role="status" className="mb-3 rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            Webhook saved.
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-3">
          <label htmlFor="webhook" className="block text-xs font-medium uppercase tracking-wide text-slate-400">
            Webhook URL
          </label>
          <input
            id="webhook"
            type="url"
            className={field}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.example.com/sitewatch"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateWebhook.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              {updateWebhook.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testWebhook.isPending || !user?.webhook_url}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {testWebhook.isPending ? "Sending…" : "Send test"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Notifications — email
        </h2>
        <p className="text-xs text-slate-500">
          Email alerts use server-side SMTP settings provided via environment variables
          (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM, SMTP_TO).
          Email notifications are disabled unless the server administrator configures
          SMTP. This instance:{" "}
          <span className="font-medium text-slate-300">
            {user ? "configured via environment" : "—"}
          </span>
          .
        </p>
      </section>
    </div>
  );
}
