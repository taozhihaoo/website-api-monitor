// Formatting helpers shared across pages.
// All functions default to English so existing callers (and unit tests) keep
// their exact output; pass a locale to render Chinese UI text.

import { translate } from "../i18n/messages";
import type { Locale } from "../i18n/messages";

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) {
    return "—";
  }
  return `${parseFloat(pct.toFixed(2))}%`;
}

export function formatDateTime(
  iso: string | null | undefined,
  locale: Locale = "en",
): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(
  iso: string | null | undefined,
  locale: Locale = "en",
): string {
  if (!iso) {
    return translate(locale, "format.never");
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return translate(locale, "format.never");
  }
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) {
    return translate(locale, "format.secondsAgo", { count: seconds });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return translate(locale, "format.minutesAgo", { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return translate(locale, "format.hoursAgo", { count: hours });
  }
  return translate(locale, "format.daysAgo", { count: Math.round(hours / 24) });
}

export function formatDuration(
  seconds: number | null | undefined,
  locale: Locale = "en",
): string {
  if (seconds === null || seconds === undefined) {
    return "—";
  }
  if (seconds < 60) {
    return translate(locale, "format.seconds", { count: seconds });
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest
      ? translate(locale, "format.minutesSeconds", { minutes, seconds: rest })
      : translate(locale, "format.minutes", { minutes });
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes
    ? translate(locale, "format.hoursMinutes", { hours, minutes: restMinutes })
    : translate(locale, "format.hours", { hours });
}

export function formatInterval(seconds: number, locale: Locale = "en"): string {
  if (seconds % 3600 === 0) {
    return translate(locale, "format.hourShort", { count: seconds / 3600 });
  }
  if (seconds % 60 === 0) {
    return translate(locale, "format.minuteShort", { count: seconds / 60 });
  }
  return translate(locale, "format.secondShort", { count: seconds });
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  return Math.floor((then - Date.now()) / 86_400_000);
}
