import { useI18n } from "../i18n/I18nContext";

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="sw-lang" role="group" aria-label={t("lang.label")}>
      <button
        type="button"
        aria-label="English"
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : ""}
        onClick={() => setLocale("en")}
      >
        {t("lang.en")}
      </button>
      <button
        type="button"
        aria-label="简体中文"
        aria-pressed={locale === "zh"}
        className={locale === "zh" ? "active" : ""}
        onClick={() => setLocale("zh")}
      >
        {t("lang.zh")}
      </button>
    </div>
  );
}
