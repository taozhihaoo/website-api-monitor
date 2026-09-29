import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !email.includes("@")) {
      next.email = "Enter a valid email address.";
    }
    if (password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) {
      onSubmit(email.trim(), password);
    }
  };

  const field =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500";
  const err = "mt-1 text-xs text-red-400";

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {serverError && (
        <div role="alert" className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {serverError}
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
          Email
        </label>
        <input
          id="email"
          type="email"
          className={field}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
        {errors.email && <p className={err}>{errors.email}</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
          Password
        </label>
        <input
          id="password"
          type="password"
          className={field}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {errors.password && <p className={err}>{errors.password}</p>}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

export function LoginPage() {
  const { login } = useAuth();
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
          ? "Invalid email or password."
          : error instanceof Error
            ? error.message
            : "Login failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl" aria-hidden="true">👁️</div>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">SiteWatch</h1>
          <p className="mt-1 text-sm text-slate-500">Website &amp; API monitoring</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <AuthForm
            mode="login"
            onSubmit={handleSubmit}
            submitting={submitting}
            serverError={serverError}
          />
          <p className="mt-4 text-center text-sm text-slate-400">
            No account?{" "}
            <Link to="/register" className="font-medium text-blue-400 hover:text-blue-300">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
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
          ? "An account with this email already exists."
          : error instanceof Error
            ? error.message
            : "Registration failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl" aria-hidden="true">👁️</div>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">Create your account</h1>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <AuthForm
            mode="register"
            onSubmit={handleSubmit}
            submitting={submitting}
            serverError={serverError}
          />
          <p className="mt-4 text-center text-sm text-slate-400">
            Already registered?{" "}
            <Link to="/login" className="font-medium text-blue-400 hover:text-blue-300">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
