import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Button } from '../beui/project-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs'
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

  return <Dialog open onOpenChange={value => { if (!value) onClose?.() }}>
    <DialogContent aria-label="资源整理" className="max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-hidden p-0 sm:max-h-[82vh]">
      <section className="flex h-full max-h-[calc(100dvh-1.5rem)] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground sm:max-h-[82vh]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5">
        <div><p className="text-xs font-medium text-muted-foreground">资源库</p><DialogTitle className="mt-1 text-lg">资源整理</DialogTitle><p className="mt-1 text-sm text-muted-foreground">AI 分析完成后自动写入用途标签。</p></div>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭资源整理" onClick={onClose} className="rounded-full"><X className="size-4" aria-hidden="true" /></Button>
      </header>
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'curation' | 'ai')} className="min-h-0 flex-1">
      <TabsList aria-label="资源整理视图" className="shrink-0 px-5">
        <TabsTrigger value="curation">资源整理</TabsTrigger>
        <TabsTrigger value="ai">AI 处理</TabsTrigger>
      </TabsList>
      {loading ? <p className="p-6 text-sm text-muted-foreground">正在加载整理状态…</p> : error ? <p role="alert" className="m-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-foreground">{error}</p> : <>
      <TabsContent value="curation" id="resource-curation-panel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {!queue?.items.length ? <p className="rounded-lg border border-success-500/30 bg-muted p-4 text-sm text-success">所有可分析资源都已写入用途标签。</p> : <>
          <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-medium text-foreground">待分析资源</span><span className="text-xs text-muted-foreground">{queue.items.length} 项</span></div>
          <div className="space-y-2">{queue.items.map(item => <div key={item.id} className="rounded-lg border border-border bg-muted/40 p-3"><p className="truncate text-sm font-medium text-foreground">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.path}</p></div>)}</div>
        </>}
        {canStartSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration()} className="mt-4">{semanticStarting ? '启动中…' : 'AI 整理用途'}</Button> : null}
      </TabsContent>
      <TabsContent value="ai" id="resource-ai-panel" className="min-h-0 flex-1 overflow-y-auto p-5">
        {semanticJob ? <SemanticProcessingPanel job={semanticJob} queue={queue} now={now} canRetry={canRetrySemanticCuration} canReanalyze={canStartFullSemanticCuration} retrying={semanticStarting} onRetry={() => void retrySemanticCuration()} onReanalyze={() => void startSemanticCuration('all')} /> : <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center"><p className="text-sm font-medium text-foreground">尚未开始 AI 整理</p><div className="mt-4 flex flex-wrap justify-center gap-2">{canStartSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration()}>{semanticStarting ? '启动中…' : 'AI 整理用途'}</Button> : null}{canStartFullSemanticCuration ? <Button type="button" variant="secondary" size="sm" disabled={semanticStarting} onClick={() => void startSemanticCuration('all')}>重新全部分析</Button> : null}</div></div>}
      </TabsContent>
      </>}
      </Tabs>
      </section>
    </DialogContent>
  </Dialog>
}

function SemanticProcessingPanel({ job, queue, now, canRetry, canReanalyze, retrying, onRetry, onReanalyze }: { job: ResourceProcessingJob; queue?: ResourceCurationQueue; now: number; canRetry: boolean; canReanalyze: boolean; retrying: boolean; onRetry: () => void; onReanalyze: () => void }) {
  const processed = job.completedItems + job.failedItems
  const stage = processingStage(job.status)
  const statusText = job.status === 'running' ? `${stage} · 处理中` : stage
  const failures = job.failures ?? []
  const names = new Map((queue?.items ?? []).map(item => [item.id, item.name]))
  return <div className="space-y-5">
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><div><span className="text-sm font-medium text-foreground">{job.retryOfJobId ? '失败项重试' : job.analysisMode === 'all' ? '全量分析' : '未分类分析'}</span><span className="ml-3 text-sm text-muted-foreground">{processed} / {job.totalItems}</span></div><span role="status" className={`text-sm ${job.status === 'failed' ? 'text-destructive' : job.status === 'completed' ? 'text-success' : 'text-info'}`}>阶段：{statusText}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><UsageValue label="输入" value={job.usage?.inputTokens ?? 0} /><UsageValue label="缓存输入" value={job.usage?.cacheReadTokens ?? 0} /><UsageValue label="输出" value={job.usage?.outputTokens ?? 0} /><UsageValue label="总 tokens" value={job.usage?.totalTokens ?? 0} /><UsageValue label="Credit" value={formatCredits(job.usage?.creditsMicro ?? 0)} /></div>
      <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">运行时长：{formatRuntime(job.createdAt, job.status === 'queued' || job.status === 'running' ? now : Date.parse(job.updatedAt))}</div>
    </div>
    <div><div className="mb-3 flex items-center justify-between gap-3"><span className="type-caption-1 text-foreground">处理列表</span><span className="type-caption-2 text-muted-foreground">{failures.length ? `${failures.length} 项失败` : job.status === 'completed' ? '全部完成' : '处理中'}</span></div>{failures.length ? <div className="space-y-2">{failures.map(failure => <div key={`${failure.elementId}:${failure.error}`} className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3"><span role="img" aria-label="处理失败" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-destructive/60 text-destructive">×</span><div className="min-w-0"><p className="type-caption-1 text-destructive">{names.get(failure.elementId) ?? failure.elementId}</p><p className="mt-1 break-words type-caption-2 text-destructive/80">{failure.error}</p></div></div>)}</div> : <p className="rounded-xl border border-border p-4 type-caption-2 text-muted-foreground">{job.status === 'completed' ? '没有失败项，标签已自动写入。' : '正在处理资源…'}</p>}</div>
    {canRetry || canReanalyze ? <div className="flex justify-end gap-2">{canReanalyze ? <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onReanalyze}>重新全部分析</Button> : null}{canRetry ? <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>{retrying ? '重试中…' : '重试失败项'}</Button> : null}</div> : null}
  </div>
}

function UsageValue({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold text-foreground">{typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value}</div></div>
}

function processingStage(status: ResourceProcessingJob['status']): string {
  if (status === 'queued') return '准备处理'
  if (status === 'running') return '模型语义判定'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '处理失败'
  return '已停止'
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
