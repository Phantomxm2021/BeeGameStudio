import { useTranslation } from 'react-i18next'
import type { Language } from '../components/Demiurge/AgentsConfig'

export type CommonText = Record<string, string>
export type BeeGameText = Record<string, any>

export function normalizeI18nLanguage(lang: Language): Language {
  return lang === 'zh' ||
    lang === 'zh-TW' ||
    lang === 'en' ||
    lang === 'ja' ||
    lang === 'ko' ||
    lang === 'fr' ||
    lang === 'de' ||
    lang === 'es' ||
    lang === 'it' ||
    lang === 'pt'
    ? lang
    : 'en'
}

export function useCommonText(lang: Language): CommonText {
  const { i18n } = useTranslation('common')
  const fallback = i18n.getResourceBundle('en', 'common') as CommonText
  const current = i18n.getResourceBundle(normalizeI18nLanguage(lang), 'common') as CommonText
  return deepMergeI18nText(fallback, current) as CommonText
}

export function useBeeGameText(lang: Language): BeeGameText {
  const { i18n } = useTranslation('beegame')
  const fallback = i18n.getResourceBundle('en', 'beegame') as BeeGameText
  const current = i18n.getResourceBundle(normalizeI18nLanguage(lang), 'beegame') as BeeGameText
  return deepMergeI18nText(fallback, current) as BeeGameText
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deepMergeI18nText<T extends Record<string, unknown>>(fallback: T, current: T): T {
  const merged: Record<string, unknown> = { ...fallback }
  for (const [key, value] of Object.entries(current || {})) {
    const fallbackValue = merged[key]
    merged[key] = isPlainObject(fallbackValue) && isPlainObject(value)
      ? deepMergeI18nText(fallbackValue, value)
      : value
  }
  return merged as T
}
