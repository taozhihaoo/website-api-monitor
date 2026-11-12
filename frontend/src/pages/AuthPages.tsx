import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { LanguageSwitch } from "../components/LanguageSwitch";
import {
  ActivityIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  RadarIcon,
} from "../components/Icons";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

function AuthForm({
  mode,
  onSubmit,
  submitting,
  serverError,
}: {
  mode: "login" | "register";
  onSubmit: (email: string, password: string) => void;
  submitting: boolean;
  serverError: string | null;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !email.includes("@")) {
      next.email = t("auth.invalidEmail");
    }
    if (password.length < 8) {
      next.password = t("auth.passwordShort");
    }
    setErrors(next);
    if (Object.keys(next).length === 0) {
      onSubmit(email.trim(), password);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {serverError && <div role="alert" className="sw-alert !my-0 text-[12.5px]">{serverError}</div>}
      <div>
        <label htmlFor="email" className="sw-label">
          {t("auth.email")}
        </label>
        <input
          id="email"
          type="email"
          className="sw-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.emailPlaceholder")}
          autoComplete="email"
        />
        {errors.email && <p className="sw-field-error">{errors.email}</p>}
      </div>
      <div>
        <label htmlFor="password" className="sw-label">
          {t("auth.password")}
        </label>
        <input
          id="password"
          type="password"
          className="sw-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.passwordPlaceholder")}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {errors.password && <p className="sw-field-error">{errors.password}</p>}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="sw-btn sw-btn-primary w-full !py-3"
      >
        {submitting
          ? t("action.pleaseWait")
          : mode === "login"
            ? t("auth.login")
            : t("auth.createAccount")}
      </button>
    </form>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="sw-auth-shell">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute left-[8%] top-[12%] h-[420px] w-[420px] rounded-full bg-indigo-600/10 blur-[110px]" />
        <div className="absolute bottom-[6%] right-[8%] h-[360px] w-[360px] rounded-full bg-cyan-500/10 blur-[110px]" />
      </div>
      <div className="absolute right-5 top-5 z-10 sm:right-8 sm:top-7">
        <LanguageSwitch />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-[1280px] grid-cols-1 items-center gap-10 px-5 py-12 lg:grid-cols-2 lg:gap-16 lg:px-12">
        <div className="hidden lg:block">
          <div className="mb-10 flex items-center gap-3">
            <div className="sw-brand-mark">
              <RadarIcon size={21} />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-50">{t("app.name")}</div>
              <div className="text-[11px] text-slate-500">{t("app.tagline")}</div>
            </div>
          </div>

          <h2 className="max-w-[460px] text-[42px] font-bold leading-[1.12] tracking-[-0.04em] text-slate-50">
            {t("auth.heroTitle")}
          </h2>
          <p className="mt-5 max-w-[440px] text-[14px] leading-relaxed text-slate-400">
            {t("auth.heroDesc")}
          </p>

          <div className="mt-9 space-y-3">
            {([
              { icon: ActivityIcon, key: "auth.feature1" },
              { icon: ClockIcon, key: "auth.feature2" },
              { icon: BellIcon, key: "auth.feature3" },
            ] as { icon: typeof ActivityIcon; key: MessageKey }[]).map(({ icon: Icon, key }) => (
              <div key={key} className="flex items-center gap-3 text-[13px] text-slate-300">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-indigo-400/20 bg-indigo-500/10 text-indigo-300">
                  <Icon size={15} />
                </span>
                {t(key)}
                <CheckIcon size={14} className="ml-auto text-emerald-400/70" />
              </div>
            ))}
          </div>

          <div className="relative mt-12 hidden h-[180px] items-center justify-center xl:flex">
            <div className="sw-radar !h-[330px] !w-[330px] scale-75">
              <div className="sw-radar-sweep" />
              <div className="sw-radar-ping !left-[26%] !top-[34%]" />
              <div className="sw-radar-ping !left-[68%] !top-[62%] !bg-rose-400" />
              <div className="sw-radar-ping !left-[58%] !top-[22%] !bg-cyan-300" />
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (email: string, password: string) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (error) {
      setServerError(
        error instanceof ApiError && error.status === 401
          ? t("auth.invalidCredentials")
          : error instanceof Error
            ? error.message
            : t("auth.loginFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="sw-auth-card p-7 sm:p-9">
        <div className="mb-7 lg:hidden">
          <div className="sw-brand-mark mb-4">
            <RadarIcon size={21} />
          </div>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-slate-50">
          {t("auth.loginTitle")}
        </h1>
        <p className="mt-1.5 text-[13px] text-slate-400">{t("app.tagline")}</p>
        <div className="my-7 h-px bg-white/10" />
        <AuthForm
          mode="login"
          onSubmit={handleSubmit}
          submitting={submitting}
          serverError={serverError}
        />
        <p className="mt-6 text-center text-[12.5px] text-slate-400">
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="font-semibold text-indigo-300 hover:text-indigo-200">
            {t("auth.register")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (email: string, password: string) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await register(email, password);
      navigate("/");
    } catch (error) {
      setServerError(
        error instanceof ApiError && error.code === "email_taken"
          ? t("auth.emailTaken")
          : error instanceof Error
            ? error.message
            : t("auth.registerFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="sw-auth-card p-7 sm:p-9">
        <h1 className="text-[24px] font-bold tracking-tight text-slate-50">
          {t("auth.registerTitle")}
        </h1>
        <p className="mt-1.5 text-[13px] text-slate-400">{t("app.tagline")}</p>
        <div className="my-7 h-px bg-white/10" />
        <AuthForm
          mode="register"
          onSubmit={handleSubmit}
          submitting={submitting}
          serverError={serverError}
        />
        <p className="mt-6 text-center text-[12.5px] text-slate-400">
          {t("auth.alreadyRegistered")}{" "}
          <Link to="/login" className="font-semibold text-indigo-300 hover:text-indigo-200">
            {t("auth.login")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
