import { useTranslation } from 'react-i18next'
import type { Language } from '../components/Demiurge/AgentsConfig'

export type CommonText = Record<string, string>
export type BeeGameText = Record<string, string>

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
  return i18n.getResourceBundle(normalizeI18nLanguage(lang), 'common') as CommonText
}

export function useBeeGameText(lang: Language): BeeGameText {
  const { i18n } = useTranslation('beegame')
  return i18n.getResourceBundle(normalizeI18nLanguage(lang), 'beegame') as BeeGameText
}
