import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { WorkflowCardPayload, WorkflowCardTask } from '../../types/message';

const statusLabel: Record<WorkflowCardPayload['status'], string> = {
  draft: '准备中',
  running: '执行中',
  blocked: '需要处理',
  verifying: '验证中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已暂停',
  stale: '已过期',
};

const stageLabel: Record<string, string> = {
  FOUNDATION_DRAFTING: '基础文档编写',
  FOUNDATION_REVIEW: '基础文档审计',
  CHECKLIST_DRAFTING: 'Gameplay Checklist 编写',
  CHECKLIST_REVIEW: '八产物综合审计',
  BRIEF_CONFIRMED: '需求确认',
  DOCUMENT_DRAFTING: '基础文档编写',
  DOCUMENT_REVIEW: '文档审计',
  RESOURCE_PREPARATION: 'Asset Manifest 与资源准备',
  ATOMIC_TASK_PLANNING: '原子任务规划',
  IMPLEMENTATION: '游戏实现',
  IMPLEMENTATION_AUDIT: '实现审计',
  ACCEPTANCE: '运行验收',
  DELIVERY: '交付',
};

const workerLabel: Record<string, string> = {
  'document-author': 'Document Author',
  'document-reviewer': 'Document Reviewer',
  'resource-preparer': 'Resource Preparer',
  'atomic-task-planner': 'Task Planner',
  'implementation-worker': 'Implementation Worker',
  'implementation-auditor': 'Implementation Auditor',
  'acceptance-validator': 'Acceptance Validator',
};

const documentTitle: Record<string, string> = {
  'docs/GDD.md': '游戏设计文档 GDD',
  'docs/TECHNICAL_DESIGN.md': '技术设计文档',
  'docs/ART_DIRECTION.md': '美术方向',
  'docs/UI_UX_SPEC.md': 'UI / UX 规格',
  'docs/AUDIO_DESIGN.md': '音频设计',
  'docs/ASSET_PLAN.md': '资产计划',
  'docs/acceptance/gameplay-checklist.md': 'Gameplay Checklist',
};

const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
};

const taskIcon = (task: WorkflowCardTask) => {
  if (task.status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (task.status === 'running') return <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />;
  if (task.status === 'failed' || task.status === 'blocked') return <XCircle className="h-4 w-4 text-rose-300" />;
  return <Circle className="h-4 w-4 text-zinc-600" />;
};

export function WorkflowCard({
  workflow,
  onAction,
}: {
  workflow: WorkflowCardPayload;
  onAction?: (action: 'resume' | 'retry') => Promise<void> | void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [actionState, setActionState] = useState<'idle' | 'pending'>('idle');
  const [actionError, setActionError] = useState('');
  const isCompleted = workflow.status === 'completed';
  const isActive = ['draft', 'running', 'verifying'].includes(workflow.status);
  const isBlocked = ['blocked', 'failed', 'cancelled', 'stale'].includes(workflow.status);
  const StatusIcon = isCompleted ? CheckCircle2 : LoaderCircle;
  const tasks = workflow.tasks ?? [];
  const completedCount = workflow.completedTaskCount ?? tasks.filter(task => task.status === 'completed').length;
  const totalCount = workflow.totalTaskCount ?? tasks.length;
  const stageTitle = stageLabel[workflow.documentStep || ''] || stageLabel[workflow.currentPhase || ''] || workflow.currentPhase || '等待阶段';
  const startedAt = Date.parse(workflow.createdAt || '');
  const finishedAt = Date.parse(workflow.completedAt || (!isActive ? workflow.updatedAt || '' : ''));
  const elapsed = Number.isFinite(startedAt)
    ? !isActive && Number.isFinite(finishedAt)
      ? finishedAt - startedAt
      : now - startedAt
    : 0;

  useEffect(() => {
    if (!isActive || !Number.isFinite(startedAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive, startedAt]);

  const executionText = useMemo(() => {
    const worker = workerLabel[workflow.worker || ''] || workflow.worker || '';
    const state = workflow.executionStatus === 'working'
      ? '正在执行'
      : workflow.executionStatus === 'waiting'
        ? '等待中'
        : workflow.executionStatus === 'idle'
          ? '空闲'
          : workflow.executionStatus || '';
    const item = workflow.currentItemId ? documentTitle[workflow.currentItemId] || workflow.currentItemId : '';
    return [worker, state, item].filter(Boolean).join(' · ');
  }, [workflow.currentItemId, workflow.executionStatus, workflow.worker]);

  const handleAction = async () => {
    if (!workflow.nextAction || !onAction || actionState === 'pending') return;
    setActionState('pending');
    setActionError('');
    try {
      await onAction(workflow.nextAction);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败，请稍后重试');
    } finally {
      setActionState('idle');
    }
  };

  return (
    <section
      data-testid={`beegame-workflow-card-${workflow.runId}`}
      className="box-border min-w-0 w-full max-w-[46rem] overflow-hidden rounded-3xl border border-white/15 bg-white/[0.04] text-zinc-100 shadow-sm backdrop-blur-2xl"
    >
      <div className="px-4 py-4">
        <div className="flex items-start gap-3">
          {!isBlocked ? <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${isCompleted ? 'text-emerald-300' : 'animate-spin text-sky-300'}`} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-100">{stageTitle}</h3>
                  {totalCount > 0 ? <span className="text-[11px] tabular-nums text-zinc-500">{completedCount} / {totalCount}</span> : null}
                </div>
                <p className="mt-1.5 text-sm leading-5 text-zinc-300">{workflow.thinking || (isBlocked ? workflow.block?.message : '正在准备当前阶段…')}</p>
                {executionText ? <p className="mt-1 text-[11px] text-zinc-500">{executionText}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-zinc-400">{statusLabel[workflow.status]}</span>
                {workflow.block ? (
                  <div className="group relative">
                    <button
                      type="button"
                      className="rounded-full text-amber-300 outline-none transition-colors hover:text-amber-200 focus-visible:ring-2 focus-visible:ring-amber-300/40"
                      aria-label="查看错误详情"
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </button>
                    <div
                      role="tooltip"
                      className="pointer-events-none invisible absolute right-0 top-6 z-30 w-72 rounded-xl border border-amber-300/20 bg-zinc-950/95 p-3 text-xs leading-5 text-amber-100 opacity-0 shadow-2xl backdrop-blur-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                    >
                      <p>{workflow.block.message}</p>
                      {workflow.block.nextAction ? <p className="mt-1 text-amber-200/70">下一步：{workflow.block.nextAction}</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {tasks.length > 0 ? (
              <ul className="mt-4 space-y-2 pl-3">
                {tasks.slice(0, 8).map(task => (
                  <li key={task.id} className="flex min-w-0 items-start gap-2 text-xs">
                    <span className="mt-px shrink-0">{taskIcon(task)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={task.status === 'completed' ? 'truncate text-zinc-500 line-through decoration-zinc-700' : task.status === 'running' ? 'truncate text-zinc-200' : 'truncate text-zinc-400'}>
                        {documentTitle[task.title] || task.title}
                      </p>
                      {task.failureReason ? <p className="mt-0.5 line-clamp-2 text-rose-300/80">{task.failureReason}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {actionError ? <p role="alert" className="mt-3 text-xs text-rose-300">{actionError}</p> : null}
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <span className="text-[11px] tabular-nums text-zinc-500">{formatDuration(elapsed)}</span>
              {workflow.nextAction && onAction ? (
                <button
                  type="button"
                  onClick={() => void handleAction()}
                  disabled={actionState === 'pending'}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${actionState === 'pending' ? 'animate-spin' : ''}`} />
                  {actionState === 'pending' ? '处理中…' : workflow.nextAction === 'resume' ? '继续' : '重试'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}
