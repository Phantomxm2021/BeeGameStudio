import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ResourceCurationQueue,
  ResourceProcessingJob,
  ResourceSemanticCurationStartOptions,
} from '../../services/resourceLibraryApi'

export type ResourceCurationApi = {
  getCurationQueue(packId: string): Promise<ResourceCurationQueue>
  startSemanticCuration?(packId: string, options?: ResourceSemanticCurationStartOptions): Promise<ResourceProcessingJob>
  getLatestSemanticCurationJob?(packId: string): Promise<ResourceProcessingJob | undefined>
  getSemanticCurationJob?(packId: string, jobId: string): Promise<ResourceProcessingJob>
  retrySemanticCuration?(packId: string, jobId: string): Promise<ResourceProcessingJob>
}

export function CurationWorkbench({ packId, api, onClose }: { packId: string; api: ResourceCurationApi; onClose?: () => void }) {
  const { t } = useTranslation('resourceLibrary')
  const [queue, setQueue] = useState<ResourceCurationQueue>()
  const [loading, setLoading] = useState(true)
  const [semanticJob, setSemanticJob] = useState<ResourceProcessingJob>()
  const [semanticStarting, setSemanticStarting] = useState(false)
  const [activeTab, setActiveTab] = useState<'curation' | 'ai'>('curation')
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const next = await api.getCurationQueue(packId)
      setQueue(next)
      if (api.getLatestSemanticCurationJob) setSemanticJob(await api.getLatestSemanticCurationJob(packId))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [packId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!semanticJob || !['queued', 'running'].includes(semanticJob.status) || !api.getSemanticCurationJob) return
    let active = true
    const timer = setTimeout(() => {
      void api.getSemanticCurationJob!(packId, semanticJob.id).then(async next => {
        if (!active) return
        setSemanticJob(next)
        if (next.status !== 'queued' && next.status !== 'running') {
          const refreshedQueue = await api.getCurationQueue(packId)
          if (active) setQueue(refreshedQueue)
        }
      }).catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 800)
    return () => { active = false; clearTimeout(timer) }
  }, [api, packId, semanticJob])

  useEffect(() => {
    if (!semanticJob || !['queued', 'running'].includes(semanticJob.status)) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [semanticJob])

  const startSemanticCuration = async (mode: 'missing' | 'all' = 'missing') => {
    if (!api.startSemanticCuration) return
    setSemanticStarting(true)
    try {
      setSemanticJob(await api.startSemanticCuration(packId, mode === 'all' ? { mode } : undefined))
      setActiveTab('ai')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSemanticStarting(false)
    }
  }

  const canStartFullSemanticCuration = Boolean(api.startSemanticCuration && (!semanticJob || !['queued', 'running'].includes(semanticJob.status)))
  const canStartSemanticCuration = Boolean(api.startSemanticCuration)
  const canRetrySemanticCuration = Boolean(semanticJob?.status === 'failed' && api.retrySemanticCuration)

  const retrySemanticCuration = async () => {
    if (!semanticJob || !api.retrySemanticCuration) return
    setSemanticStarting(true)
    try {
      setSemanticJob(await api.retrySemanticCuration(packId, semanticJob.id))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSemanticStarting(false)
    }
  }

  return <div role="dialog" aria-modal="true" aria-label={t('curation.title')} className="fixed inset-0 z-[230] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
    <section className="flex max-h-[82vh] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#17181d] shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 p-5">
        <div><p className="type-caption-1 text-[#c6a367]">{t('library')}</p><h2 className="type-title-2 mt-1 text-zinc-50">{t('curation.title')}</h2><p className="type-caption-2 mt-1 text-zinc-500">{t('curation.description')}</p></div>
        <button type="button" aria-label={t('curation.close')} onClick={onClose} className="glass-icon-button h-8 w-8">×</button>
      </header>
      <div role="tablist" aria-label={t('curation.viewLabel')} className="flex shrink-0 border-b border-white/10 px-5">
        <TabButton active={activeTab === 'curation'} onClick={() => setActiveTab('curation')} controls="resource-curation-panel">{t('curation.tab')}</TabButton>
        <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} controls="resource-ai-panel">{t('curation.aiTab')}</TabButton>
      </div>
      {loading ? <p className="p-6 type-caption-2 text-zinc-500">{t('curation.loading')}</p> : error ? <p role="alert" className="m-5 rounded-xl bg-red-400/10 p-3 type-caption-2 text-red-200">{error}</p> : activeTab === 'curation' ? <div id="resource-curation-panel" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {!queue?.items.length ? <p className="rounded-xl border border-emerald-200/15 bg-emerald-300/10 p-4 type-caption-2 text-emerald-100">{t('curation.empty')}</p> : <>
          <div className="mb-3 flex items-center justify-between gap-3"><span className="type-caption-1 text-zinc-200">{t('curation.pending')}</span><span className="type-caption-2 text-zinc-500">{t('curation.count', { count: queue.items.length })}</span></div>
          <div className="space-y-2">{queue.items.map(item => <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="truncate type-caption-1 text-zinc-100">{item.name}</p><p className="mt-1 truncate type-caption-2 text-zinc-500">{item.path}</p></div>)}</div>
        </>}
        {canStartSemanticCuration ? <button type="button" disabled={semanticStarting} onClick={() => void startSemanticCuration()} className="secondary-pill mt-4 type-button px-3 py-2 disabled:opacity-50">{semanticStarting ? t('curation.starting') : t('curation.start')}</button> : null}
      </div> : <div id="resource-ai-panel" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {semanticJob ? <SemanticProcessingPanel job={semanticJob} queue={queue} now={now} canRetry={canRetrySemanticCuration} canReanalyze={canStartFullSemanticCuration} retrying={semanticStarting} onRetry={() => void retrySemanticCuration()} onReanalyze={() => void startSemanticCuration('all')} /> : <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 p-6 text-center"><p className="type-caption-1 text-zinc-200">{t('curation.notStarted')}</p><div className="mt-4 flex flex-wrap justify-center gap-2">{canStartSemanticCuration ? <button type="button" disabled={semanticStarting} onClick={() => void startSemanticCuration()} className="secondary-pill type-button px-3 py-2 disabled:opacity-50">{semanticStarting ? t('curation.starting') : t('curation.start')}</button> : null}{canStartFullSemanticCuration ? <button type="button" disabled={semanticStarting} onClick={() => void startSemanticCuration('all')} className="secondary-pill type-button px-3 py-2 disabled:opacity-50">{t('curation.reanalyzeAll')}</button> : null}</div></div>}
      </div>}
    </section>
  </div>
}

function TabButton({ active, onClick, controls, children }: { active: boolean; onClick: () => void; controls: string; children: string }) {
  return <button type="button" role="tab" aria-selected={active} aria-controls={controls} onClick={onClick} className={`border-b-2 px-4 py-3 type-button transition ${active ? 'border-sky-300 text-sky-100' : 'border-transparent text-zinc-500 hover:text-zinc-200'}`}>{children}</button>
}

function SemanticProcessingPanel({ job, queue, now, canRetry, canReanalyze, retrying, onRetry, onReanalyze }: { job: ResourceProcessingJob; queue?: ResourceCurationQueue; now: number; canRetry: boolean; canReanalyze: boolean; retrying: boolean; onRetry: () => void; onReanalyze: () => void }) {
  const { t } = useTranslation('resourceLibrary')
  const processed = job.completedItems + job.failedItems
  const stage = t(processingStageKey(job.status))
  const statusText = job.status === 'running' ? `${stage} · ${t('curation.processing')}` : stage
  const failures = job.failures ?? []
  const names = new Map((queue?.items ?? []).map(item => [item.id, item.name]))
  const analysisLabel = job.retryOfJobId ? t('curation.retryOf') : job.analysisMode === 'all' ? t('curation.fullAnalysis') : t('curation.uncategorizedAnalysis')
  const listStatus = failures.length ? t('curation.failedCount', { count: failures.length }) : job.status === 'completed' ? t('curation.allComplete') : t('curation.processingResources')
  return <div className="space-y-5">
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><div><span className="type-caption-1 text-zinc-200">{analysisLabel}</span><span className="ml-3 type-caption-1 text-zinc-400">{t('curation.processed', { processed, total: job.totalItems })}</span></div><span role="status" className={`type-caption-2 ${job.status === 'failed' ? 'text-red-300' : job.status === 'completed' ? 'text-emerald-300' : 'text-sky-300'}`}>{t('curation.stage', { value: statusText })}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><UsageValue label={t('curation.input')} value={job.usage?.inputTokens ?? 0} /><UsageValue label={t('curation.cachedInput')} value={job.usage?.cacheReadTokens ?? 0} /><UsageValue label={t('curation.output')} value={job.usage?.outputTokens ?? 0} /><UsageValue label={t('curation.totalTokens')} value={job.usage?.totalTokens ?? 0} /><UsageValue label={t('curation.credit')} value={formatCredits(job.usage?.creditsMicro ?? 0)} /></div>
      <div className="mt-4 border-t border-white/10 pt-3 type-caption-2 text-zinc-500">{t('curation.runtime', { value: formatRuntime(job.createdAt, job.status === 'queued' || job.status === 'running' ? now : Date.parse(job.updatedAt)) })}</div>
    </div>
    <div><div className="mb-3 flex items-center justify-between gap-3"><span className="type-caption-1 text-zinc-200">{t('curation.processingList')}</span><span className="type-caption-2 text-zinc-500">{listStatus}</span></div>{failures.length ? <div className="space-y-2">{failures.map(failure => <div key={`${failure.elementId}:${failure.error}`} className="flex items-start gap-3 rounded-xl border border-red-200/20 bg-red-300/10 p-3"><span role="img" aria-label={t('curation.failureAria')} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-red-300/60 text-red-200">×</span><div className="min-w-0"><p className="type-caption-1 text-red-100">{names.get(failure.elementId) ?? failure.elementId}</p><p className="mt-1 break-words type-caption-2 text-red-200/80">{failure.error}</p></div></div>)}</div> : <p className="rounded-xl border border-white/10 p-4 type-caption-2 text-zinc-500">{job.status === 'completed' ? t('curation.noFailures') : t('curation.processingResources')}</p>}</div>
    {canRetry || canReanalyze ? <div className="flex justify-end gap-2">{canReanalyze ? <button type="button" disabled={retrying} onClick={onReanalyze} className="secondary-pill type-button px-3 py-2 disabled:opacity-50">{t('curation.reanalyzeAll')}</button> : null}{canRetry ? <button type="button" disabled={retrying} onClick={onRetry} className="secondary-pill type-button px-3 py-2 disabled:opacity-50">{retrying ? t('curation.retrying') : t('curation.retryFailed')}</button> : null}</div> : null}
  </div>
}
function UsageValue({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="type-caption-2 text-zinc-500">{label}</div><div className="mt-1 text-base font-semibold text-zinc-100">{typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value}</div></div>
}

function processingStageKey(status: ResourceProcessingJob['status']): string {
  if (status === 'queued') return 'curation.queued'
  if (status === 'running') return 'curation.semantic'
  if (status === 'completed') return 'curation.completed'
  if (status === 'failed') return 'curation.failed'
  return 'curation.stopped'
}

function formatRuntime(createdAt: string, endAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((endAt - Date.parse(createdAt)) / 1000))
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

function formatCredits(creditsMicro: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(creditsMicro / 1_000_000)
}
