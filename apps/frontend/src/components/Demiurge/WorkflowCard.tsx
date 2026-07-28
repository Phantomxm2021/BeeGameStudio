import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { WorkflowCardPayload } from '../../types/message';

const statusLabel: Record<WorkflowCardPayload['status'], string> = {
  draft: '准备中',
  running: '执行中',
  blocked: '已阻塞',
  verifying: '验证中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '已过期',
};

export function WorkflowCard({ workflow }: { workflow: WorkflowCardPayload }) {
  const isCompleted = workflow.status === 'completed';
  const isBlocked = workflow.status === 'blocked' || workflow.status === 'failed' || workflow.status === 'cancelled' || workflow.status === 'stale';
  const StatusIcon = isCompleted ? CheckCircle2 : isBlocked ? AlertTriangle : LoaderCircle;
  const usage = workflow.usage;

  return (
    <section
      data-testid={`beegame-workflow-card-${workflow.runId}`}
      className="glass-control w-full max-w-[46rem] overflow-hidden rounded-3xl border border-sky-300/20 bg-sky-300/[0.055] text-zinc-100 shadow-sm backdrop-blur-2xl"
    >
      <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${isCompleted ? 'text-emerald-300' : isBlocked ? 'text-amber-300' : 'animate-spin text-sky-300'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">BeeGame Delivery Workflow</span>
            <span className="text-xs text-zinc-400">{statusLabel[workflow.status]}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {workflow.currentPhase || '等待阶段'}
            {workflow.worker ? ` · ${workflow.worker}` : ''}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-3 text-xs text-zinc-400 sm:grid-cols-4">
        <span>输入 {usage?.input_tokens?.toLocaleString() ?? 0}</span>
        <span>缓存 {usage?.cache_read_tokens?.toLocaleString() ?? 0}</span>
        <span>输出 {usage?.output_tokens?.toLocaleString() ?? 0}</span>
        <span>总计 {usage?.total_tokens?.toLocaleString() ?? 0}</span>
      </div>
      {workflow.block ? (
        <div className="border-t border-amber-300/15 px-4 py-3 text-xs text-amber-100">
          <p>{workflow.block.message}</p>
          {workflow.block.nextAction ? <p className="mt-1 text-amber-200/70">下一步：{workflow.block.nextAction}</p> : null}
        </div>
      ) : workflow.thinking ? (
        <p className="border-t border-white/10 px-4 py-3 text-xs text-zinc-400">{workflow.thinking}</p>
      ) : null}
    </section>
  );
}
