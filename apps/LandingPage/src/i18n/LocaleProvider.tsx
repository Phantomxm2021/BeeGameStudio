import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { detectLocale, LOCALE_STORAGE_KEY } from "./locale";
import { messages } from "./messages";
import type { Locale } from "./types";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: (typeof messages)[Locale];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSavedLocale(): string | null {
  try {
    return getStorage()?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function getBrowserLocales(): readonly string[] {
  if (typeof window === "undefined" || typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

function saveLocale(locale: Locale) {
  try {
    getStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}

function syncDocumentMetadata(locale: Locale) {
  if (typeof document === "undefined") return;

  const nextMessages = messages[locale];
  document.documentElement.lang = locale;
  document.title = nextMessages.meta.title;

  function setMeta(attribute: "name" | "property", key: string, content: string) {
    let meta = document.head.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute(attribute, key);
      document.head.append(meta);
    }
    meta.content = content;
  }

  setMeta("name", "description", nextMessages.meta.description);
  setMeta("property", "og:title", nextMessages.meta.ogTitle);
  setMeta("property", "og:description", nextMessages.meta.ogDescription);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() =>
    detectLocale(readSavedLocale(), getBrowserLocales()),
  );

  useEffect(() => {
    syncDocumentMetadata(locale);
    saveLocale(locale);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, messages: messages[locale] }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
