import i18n from '../i18n'

/** Localize only the project-count limit, never unrelated HTTP 429 errors. */
export function projectQuotaErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as Record<string, unknown>
  if (payload.code !== 'PROJECT_QUOTA_EXCEEDED' && payload.error !== 'Project quota exceeded') return null
  const validCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const detailed = validCount(payload.projectCount) && validCount(payload.limit) && payload.limit > 0
  return String(i18n.t(detailed ? 'intake.errors.projectQuotaExceeded' : 'intake.errors.projectQuotaExceededUnknown', {
    ns: 'landing', projectCount: payload.projectCount, limit: payload.limit,
  }))
}
