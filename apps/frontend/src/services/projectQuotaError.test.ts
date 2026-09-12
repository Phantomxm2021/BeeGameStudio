import { afterEach, describe, expect, it } from 'vitest'
import i18n, { supportedI18nLanguages } from '../i18n'
import { projectQuotaErrorMessage } from './projectQuotaError'

afterEach(async () => { await i18n.changeLanguage('en') })

describe('project quota error translations', () => {
  it.each(supportedI18nLanguages)('renders counts and recovery instructions in %s', async language => {
    await i18n.changeLanguage(language)
    const message = projectQuotaErrorMessage({ code: 'PROJECT_QUOTA_EXCEEDED', projectCount: 100, limit: 100 })
    const own = i18n.getResource(language, 'landing', 'intake.errors.projectQuotaExceeded')
    expect(typeof own).toBe('string')
    expect(message).toBe(own.replace('{{projectCount}}', '100').replace('{{limit}}', '100'))
    expect(message).not.toContain('{{')
    expect(message).not.toContain('Project quota exceeded')
    if (language !== 'en') expect(own).not.toBe(i18n.getResource('en', 'landing', 'intake.errors.projectQuotaExceeded'))
  })

  it('supports old servers and uses localized fallback for missing or invalid counts', async () => {
    await i18n.changeLanguage('zh')
    expect(projectQuotaErrorMessage({ error: 'Project quota exceeded', projectCount: 100, limit: 100 })).toContain('当前 100 个，上限 100 个')
    for (const count of [undefined, -1, NaN, '100', '<script>', 1.5]) {
      expect(projectQuotaErrorMessage({ code: 'PROJECT_QUOTA_EXCEEDED', projectCount: count, limit: 100 }))
        .toBe(i18n.t('intake.errors.projectQuotaExceededUnknown', { ns: 'landing' }))
    }
  })

  it('does not reinterpret rate limits, credit errors or arbitrary server failures', () => {
    for (const body of [null, 'Project quota exceeded', {}, { code: 'CREDIT_EXHAUSTED' }, { error: 'Too many requests' }]) {
      expect(projectQuotaErrorMessage(body)).toBeNull()
    }
  })
})
