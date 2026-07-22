import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it from './locales/it.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import pt from './locales/pt.json'
import zh from './locales/zh.json'
import zhTW from './locales/zh-TW.json'

export const supportedI18nLanguages = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt'] as const

const resources = {
  en,
  zh,
  'zh-TW': zhTW,
  ja,
  ko,
  fr,
  de,
  es,
  it,
  pt,
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: ['landing', 'settings', 'common', 'beegame'],
    defaultNS: 'landing',
    fallbackLng: 'en',
    supportedLngs: supportedI18nLanguages,
    interpolation: {
      escapeValue: false,
    },
    showSupportNotice: false,
    returnObjects: true,
  })

export default i18n
