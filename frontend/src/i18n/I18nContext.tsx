import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { translate } from "./messages";
import type { Locale, MessageKey } from "./messages";

const STORAGE_KEY = "sitewatch_locale";
export const DEFAULT_LOCALE: Locale = "en";

type Variables = Record<string, string | number>;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, variables?: Variables) => string;
}

function readInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// English fallback when no provider is mounted: keeps unit-test render helpers
// and standalone components working without an explicit wrapper.
const englishDefault: I18nValue = {
  locale: "en",
  setLocale: () => undefined,
  t: (key, variables) => translate("en", key, variables),
};

const I18nContext = createContext<I18nValue>(englishDefault);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Private browsing / storage disabled — the in-memory locale still works.
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, variables) => translate(locale, key, variables),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
