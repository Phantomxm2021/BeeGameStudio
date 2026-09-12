import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { authenticatedFetch } from '../../../services/apiClient'
import type { Language } from '../AgentsConfig'

const path = '/api/dev/projects/purge'
type Plan = { projectCount: number; projects: Array<{ id: string; name: string }> }

export function DevProjectPurgePanel({ lang, onDeleted }: { lang: Language; onDeleted: () => Promise<void> }) {
  const { t } = useTranslation('landing')
  const text = (key: string, values: Record<string, unknown> = {}) =>
    String(t('intake.devProjectPurge.' + key, { lng: lang, ...values }))
  const [enabled, setEnabled] = useState(false)
  const [plan, setPlan] = useState<Plan>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let cancelled = false
    void authenticatedFetch(path).then(response => {
      if (!cancelled) setEnabled(response.ok)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (!enabled) return null

  const prepare = async () => {
    setPending(true); setMessage(''); setPlan(undefined)
    try {
      const response = await authenticatedFetch(path)
      if (!response.ok) throw new Error()
      setPlan(await response.json())
    } catch { setMessage(text('failed')) }
    finally { setPending(false) }
  }
  const execute = async () => {
    if (!plan || pending) return
    setPending(true); setMessage('')
    try {
      const response = await authenticatedFetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE_ALL_MY_PROJECTS', projectIds: plan.projects.map(project => project.id) }),
      })
      const result = await response.json()
      if (!response.ok) {
        setMessage(text(result.code === 'PROJECT_PURGE_LIST_CHANGED' ? 'changed' : 'failed'))
      } else {
        setMessage(text('result', { deleted: result.deleted, failed: result.failed }))
      }
      setPlan(undefined)
      await onDeleted()
    } catch {
      // The request may have reached the server. Refresh before any retry.
      setPlan(undefined); setMessage(text('failed'))
      await onDeleted().catch(() => {})
    } finally { setPending(false) }
  }
  return <div className="relative z-10 mt-4 shrink-0 rounded-xl border border-red-400/30 p-3 text-red-100">
    <button type="button" disabled={pending} onClick={() => void prepare()} className="type-footnote disabled:opacity-50">{text('button')}</button>
    {plan ? <div className="mt-2 space-y-2">
      <p className="type-footnote">{text('confirm', { count: plan.projectCount })}</p>
      <button type="button" disabled={pending || plan.projectCount === 0} onClick={() => void execute()} className="rounded-lg bg-red-600 px-3 py-2 disabled:opacity-50">{text('delete')}</button>
      <button type="button" disabled={pending} onClick={() => setPlan(undefined)} className="ml-3">{text('cancel')}</button>
    </div> : null}
    {pending ? <p role="status" className="type-footnote mt-2">{text('pending')}</p> : null}
    {message ? <p role="status" className="type-footnote mt-2">{message}</p> : null}
  </div>
}
