import { useTranslation } from 'react-i18next'

export function useResourceLibraryText() {
  const { i18n } = useTranslation('resourceLibrary')
  const isZh = i18n.resolvedLanguage?.startsWith('zh') || i18n.language.startsWith('zh')
  return (key: string, zh: string, en: string) => {
    const value = i18n.t(key, { defaultValue: isZh ? zh : en })
    return value === key ? (isZh ? zh : en) : value
  }
}
