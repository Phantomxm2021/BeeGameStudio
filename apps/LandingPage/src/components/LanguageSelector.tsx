import { localeLabels } from "../i18n/messages";
import { useLocale } from "../i18n/LocaleProvider";
import { supportedLocales, type Locale } from "../i18n/types";

export function LanguageSelector() {
  const { locale, setLocale, messages } = useLocale();

  return (
    <label className="language-selector" data-locale={locale}>
      <span className="sr-only">{messages.nav.language}</span>
      <span className="language-current" aria-hidden="true">{localeLabels[locale]}</span>
      <select
        aria-label={messages.nav.language}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {supportedLocales.map((option) => (
          <option key={option} value={option}>
            {localeLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
