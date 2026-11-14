import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useTestWebhook, useUpdateWebhook } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/Feedback";
import { BellIcon, CheckIcon, ShieldIcon } from "../components/Icons";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime } from "../utils/format";

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { t, locale } = useI18n();
  const updateWebhook = useUpdateWebhook();
  const testWebhook = useTestWebhook();
  const [webhookUrl, setWebhookUrl] = useState(user?.webhook_url ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // refreshUser() is fire-and-forget; without this guard a late /auth/me
  // response overwrites whatever the user started typing after clicking Save.
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) {
      setWebhookUrl(user?.webhook_url ?? "");
    }
  }, [user?.webhook_url]);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const trimmed = webhookUrl.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setError(t("settings.invalidWebhook"));
      return;
    }
    updateWebhook.mutate(trimmed || null, {
      onSuccess: () => {
        setSaved(true);
        dirty.current = false;
        // Without this the header/Settings kept the pre-save user object and
        // "Send test" stayed disabled until a full page reload.
        void refreshUser();
      },
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
          setError(result.detail || t("settings.testFailed"));
        }
      },
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/80">
          <ShieldIcon size={14} />
          {t("nav.sectionManage")}
        </div>
        <h1 className="sw-page-title">{t("settings.title")}</h1>
        <p className="sw-page-sub">{t("settings.subtitle")}</p>
      </div>

      <section className="sw-card p-5">
        <h2 className="sw-card-title mb-4">
          <ShieldIcon size={15} />
          {t("settings.account")}
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wider text-slate-400">{t("settings.email")}</dt>
            <dd className="mt-1 truncate font-medium text-slate-100">{user?.email}</dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wider text-slate-400">{t("settings.memberSince")}</dt>
            <dd className="mt-1 font-medium text-slate-100">{formatDateTime(user?.created_at, locale)}</dd>
          </div>
        </dl>
      </section>

      <section className="sw-card p-5">
        <h2 className="sw-card-title mb-2">
          <BellIcon size={15} />
          {t("settings.webhookTitle")}
        </h2>
        <p className="mb-5 max-w-2xl text-[12.5px] leading-relaxed text-slate-400">
          {t("settings.webhookDesc")}
        </p>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {saved && (
          <div role="status" className="sw-success mb-4 flex items-center gap-2">
            <CheckIcon size={15} />
            {t("settings.webhookSaved")}
          </div>
        )}
        <form onSubmit={handleSave} noValidate className="space-y-3">
          <label htmlFor="webhook" className="sw-label">{t("settings.webhookUrl")}</label>
          <input
            id="webhook"
            type="url"
            className="sw-input"
            value={webhookUrl}
            onChange={(e) => {
              dirty.current = true;
              setSaved(false);
              setWebhookUrl(e.target.value);
            }}
            placeholder={t("settings.webhookPlaceholder")}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={updateWebhook.isPending}
              className="sw-btn sw-btn-primary"
            >
              {updateWebhook.isPending ? t("action.saving") : t("action.save")}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testWebhook.isPending || !user?.webhook_url}
              className="sw-btn sw-btn-ghost"
            >
              {testWebhook.isPending ? t("action.sending") : t("action.sendTest")}
            </button>
          </div>
        </form>
      </section>

      <section className="sw-card p-5">
        <h2 className="sw-card-title mb-2">
          <BellIcon size={15} />
          {t("settings.emailTitle")}
        </h2>
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-slate-400">
          {t("settings.emailDesc")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="sw-chip">
            {t("settings.emailState")}
            <span className={user?.smtp_enabled ? "font-semibold text-emerald-300" : "font-semibold text-slate-400"}>
              {user?.smtp_enabled ? t("settings.emailEnabled") : t("settings.emailDisabled")}
            </span>
          </span>
        </div>
      </section>
    </div>
  );
}
