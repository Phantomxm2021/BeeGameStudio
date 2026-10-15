import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Button } from '../beui/project-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs'
import { useToastContext } from '../../contexts/ToastContext'
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

export function CurationWorkbench({ packId, api, open = true, onClose, onClosed }: { packId: string; api: ResourceCurationApi; open?: boolean; onClose?: () => void; onClosed?: () => void }) {
  const { t } = useTranslation('resourceLibrary')
  const { showError } = useToastContext()
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

  useEffect(() => { if (open) void load() }, [packId, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !semanticJob || !['queued', 'running'].includes(semanticJob.status) || !api.getSemanticCurationJob) return
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
  }, [api, packId, semanticJob, open])

  useEffect(() => {
    if (!open || !semanticJob || !['queued', 'running'].includes(semanticJob.status)) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [semanticJob, open])

  const startSemanticCuration = async (mode: 'missing' | 'all' = 'missing') => {
    if (!api.startSemanticCuration) return
    setSemanticStarting(true)
    try {
      setSemanticJob(await api.startSemanticCuration(packId, mode === 'all' ? { mode } : undefined))
      setActiveTab('ai')
      setError('')
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause))
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
      showError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSemanticStarting(false)
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose?.() }} onOpenChangeComplete={value => { if (!value) onClosed?.() }}>
    <DialogContent inert={!open} aria-hidden={!open} aria-label={t('curation.title')} className="max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-hidden p-0 sm:max-h-[82vh]">
      <section className="flex h-full max-h-[calc(100dvh-1.5rem)] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground sm:max-h-[82vh]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5">
        <div><p className="text-xs font-medium text-muted-foreground">{t('library')}</p><DialogTitle className="mt-1 text-lg">{t('curation.title')}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{t('curation.hint')}</p></div>
        <Button type="button" variant="ghost" size="icon" aria-label={t('curation.close')} onClick={onClose} className="rounded-full"><X className="size-4" aria-hidden="true" /></Button>
      </header>
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'curation' | 'ai')} className="min-h-0 flex-1">
      <TabsList aria-label={t('curation.views')} className="shrink-0 px-5">
        <TabsTrigger value="curation">{t('curation.title')}</TabsTrigger>
        <TabsTrigger value="ai">{t('curation.aiProcessing')}</TabsTrigger>
      </TabsList>
      {loading ? <p className="p-6 text-sm text-muted-foreground">{t('curation.loading')}</p> : error ? <p role="alert" className="m-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-foreground">{error}</p> : <>
      <TabsContent value="curation" id="resource-curation-panel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {!queue?.items.length ? <p className="rounded-lg border border-success-500/30 bg-muted p-4 text-sm text-success">{t('curation.allTagged')}</p> : <>
          <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-medium text-foreground">{t('curation.pending')}</span><span className="text-xs text-muted-foreground">{t('curation.items', { count: queue.items.length })}</span></div>
          <div className="space-y-2">{queue.items.map(item => <div key={item.id} className="rounded-lg border border-border bg-muted/40 p-3"><p className="truncate text-sm font-medium text-foreground">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.path}</p></div>)}</div>
        </>}
        {canStartSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration()} className="mt-4">{t(semanticStarting ? 'curation.starting' : 'curation.start')}</Button> : null}
      </TabsContent>
      <TabsContent value="ai" id="resource-ai-panel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {semanticJob ? <SemanticProcessingPanel job={semanticJob} queue={queue} now={now} canRetry={canRetrySemanticCuration} canReanalyze={canStartFullSemanticCuration} retrying={semanticStarting} onRetry={() => void retrySemanticCuration()} onReanalyze={() => void startSemanticCuration('all')} /> : <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center"><p className="text-sm font-medium text-foreground">{t('curation.notStarted')}</p><div className="mt-4 flex flex-wrap justify-center gap-2">{canStartSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration()}>{t(semanticStarting ? 'curation.starting' : 'curation.start')}</Button> : null}{canStartFullSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration('all')}>{t('curation.reanalyze')}</Button> : null}</div></div>}
      </TabsContent>
      </>}
      </Tabs>
      </section>
    </DialogContent>
  </Dialog>
}

function SemanticProcessingPanel({ job, queue, now, canRetry, canReanalyze, retrying, onRetry, onReanalyze }: { job: ResourceProcessingJob; queue?: ResourceCurationQueue; now: number; canRetry: boolean; canReanalyze: boolean; retrying: boolean; onRetry: () => void; onReanalyze: () => void }) {
  const { t } = useTranslation('resourceLibrary')
  const processed = job.completedItems + job.failedItems
  const stage = t(`curation.${job.status === 'failed' ? 'failedStage' : job.status === 'cancelled' ? 'stopped' : job.status}`)
  const statusText = job.status === 'running' ? `${stage} · ${t('curation.processing')}` : stage
  const failures = job.failures ?? []
  const names = new Map((queue?.items ?? []).map(item => [item.id, item.name]))
  return <div className="space-y-5">
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><div><span className="text-sm font-medium text-foreground">{t(job.retryOfJobId ? 'curation.retryRun' : job.analysisMode === 'all' ? 'curation.fullAnalysis' : 'curation.unclassifiedAnalysis')}</span><span className="ml-3 text-sm text-muted-foreground">{processed} / {job.totalItems}</span></div><span role="status" className={`text-sm ${job.status === 'failed' ? 'text-destructive' : job.status === 'completed' ? 'text-success' : 'text-info'}`}>{t('curation.stage')}: {statusText}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><UsageValue label={t('curation.input')} value={job.usage?.inputTokens ?? 0} /><UsageValue label={t('curation.cachedInput')} value={job.usage?.cacheReadTokens ?? 0} /><UsageValue label={t('curation.output')} value={job.usage?.outputTokens ?? 0} /><UsageValue label={t('curation.totalTokens')} value={job.usage?.totalTokens ?? 0} /><UsageValue label="Credit" value={formatCredits(job.usage?.creditsMicro ?? 0)} /></div>
      <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">{t('curation.duration')}: {formatRuntime(job.createdAt, job.status === 'queued' || job.status === 'running' ? now : Date.parse(job.updatedAt))}</div>
    </div>
    <div><div className="mb-3 flex items-center justify-between gap-3"><span className="type-caption-1 text-foreground">{t('curation.processingList')}</span><span className="type-caption-2 text-muted-foreground">{failures.length ? t('curation.failedItems', { count: failures.length }) : t(job.status === 'completed' ? 'curation.allDone' : 'curation.processing')}</span></div>{failures.length ? <div className="space-y-2">{failures.map(failure => <div key={`${failure.elementId}:${failure.error}`} className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3"><span role="img" aria-label={t('curation.failed')} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-destructive/60 text-destructive">×</span><div className="min-w-0"><p className="type-caption-1 text-destructive">{names.get(failure.elementId) ?? failure.elementId}</p><p className="mt-1 break-words type-caption-2 text-destructive/80">{failure.error}</p></div></div>)}</div> : <p className="rounded-xl border border-border p-4 type-caption-2 text-muted-foreground">{t(job.status === 'completed' ? 'curation.noFailures' : 'curation.processingResources')}</p>}</div>
    {canRetry || canReanalyze ? <div className="flex justify-end gap-2">{canReanalyze ? <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onReanalyze}>{t('curation.reanalyze')}</Button> : null}{canRetry ? <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>{t(retrying ? 'curation.retrying' : 'curation.retryAnalysis')}</Button> : null}</div> : null}
  </div>
}

function UsageValue({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold text-foreground">{typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value}</div></div>
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
