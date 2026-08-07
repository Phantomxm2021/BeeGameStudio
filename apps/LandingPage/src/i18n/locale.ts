import type { Locale } from "./types";

export const LOCALE_STORAGE_KEY = "bee-game-studio-locale";

export function normalizeLocale(value: string | null): Locale | null {
  if (!value) return null;

  const normalized = value.trim();
  const language = normalized.match(/^(zh|en|ja|ko)(?:-|$)/i)?.[1].toLowerCase();
  if (language === "zh") return "zh-CN";
  if (language === "en") return "en";
  if (language === "ja") return "ja";
  if (language === "ko") return "ko";
  return null;
}

export function detectLocale(
  saved: string | null,
  browserLocales: readonly string[],
): Locale {
  const savedLocale = normalizeLocale(saved);
  if (savedLocale) return savedLocale;

  for (const locale of browserLocales) {
    const supported = normalizeLocale(locale);
    if (supported) return supported;
  }

  return "en";
}
