import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react';
import {
  AlertCircle,
  CircleCheckBig,
  Circle,
  CirclePause,
  LoaderCircle,
  RotateCcw,
  ScanText as ScanTextTaskIcon,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import MarkdownErrorBoundary from '../Common/MarkdownErrorBoundary';
import { BadgeAlertIcon } from '../ui/badge-alert';
import { CircleCheckIcon } from '../ui/circle-check';
import { ClockIcon } from '../ui/clock';
import { GripIcon } from '../ui/grip';
import { HourglassIcon } from '../ui/hourglass';
import { PauseIcon } from '../ui/pause';
import { ScanTextIcon } from '../ui/scan-text';
import { XIcon } from '../ui/x';
import { useToastContext } from '../../contexts/ToastContext';
import type {
  WorkflowCardAction,
  WorkflowCardPayload,
  WorkflowCardTask,
  WorkflowRecoveryUnitKind,
} from '../../types/message';

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
  COMPREHENSIVE_REVIEW: '八产物综合审计',
  BRIEF_CONFIRMED: '需求确认',
  DOCUMENT_DRAFTING: '基础文档编写',
  DOCUMENT_REVIEW: '文档审计',
  RESOURCE_PREPARATION: 'Asset Manifest 与资源生产',
  ATOMIC_TASK_PLANNING: '原子任务规划',
  IMPLEMENTATION: '游戏实现',
  IMPLEMENTATION_AUDIT: '实现审计',
  ACCEPTANCE: '运行验收',
  DELIVERY: '交付',
};

const workerLabel: Record<string, string> = {
  'document-author': 'Document Author',
  'document-reviewer': 'Document Reviewer',
  'resource-planner': 'Resource Planner',
  'resource-curator': 'Resource Curator',
  'resource-content-author': 'Resource Content Author',
  'atomic-task-planner': 'Task Planner',
  'implementation-worker': 'Implementation Worker',
  'implementation-auditor': 'Implementation Auditor',
  'acceptance-validator': 'Acceptance Validator',
};

const documentTitle: Record<string, string> = {
  'docs/GDD.md': '游戏设计文档 GDD',
  'docs/BALANCE_DESIGN.md': '数值与平衡设计',
  'docs/LEVEL_SCENE_DESIGN.md': '关卡与场景设计',
  'docs/TECHNICAL_DESIGN.md': '技术设计文档',
  'docs/ART_DIRECTION.md': '美术方向',
  'docs/UI_UX_SPEC.md': 'UI / UX 规格',
  'docs/AUDIO_DESIGN.md': '音频设计',
  'docs/ASSET_PLAN.md': '资产计划',
  'docs/acceptance/gameplay-checklist.md': 'Gameplay Checklist',
  'assets/asset-manifest.json': 'Asset Manifest',
  brief_alignment: '简报一致性',
  cross_document_consistency: '跨文档一致性',
  gameplay_completeness: '玩法完整性',
  gameplay_strategy_viability: '策略可行性',
  economy_progression_integrity: '经济与成长闭环',
  numeric_balance_feasibility: '数值可行性',
  pacing_difficulty_coherence: '节奏与难度一致性',
  level_scene_design_integrity: '关卡与场景完整性',
  technical_feasibility: '技术可行性',
  art_direction_coherence: '美术方向一致性',
  ui_audio_consistency: 'UI 与音频一致性',
  acceptance_observability: '验收可观测性',
  checklist_traceability: 'Checklist 可追踪性',
  resource_semantic_fitness: '资源语义适配',
  content_structure_fitness: '内容结构适配',
  resource_content_consistency: '资源与内容一致性',
};

const displayTaskTitle = (task: WorkflowCardTask): string => {
  const title = documentTitle[task.title] || task.title;
  if (task.operation === 'review') return `审计：${title}`;
  if (task.operation === 'produce') return `资源：${title}`;
  if (task.operation === 'assemble') return `组合：${title}`;
  return title;
};

const displayRecoveryUnitTitle = (
  kind?: WorkflowRecoveryUnitKind,
  itemId?: string,
): string | undefined => {
  switch (kind) {
    case 'document':
    case 'review-check':
      return itemId ? documentTitle[itemId] : undefined;
    case 'checklist':
      return 'Gameplay Checklist';
    case 'resource-inventory':
      return '资源清单';
    case 'resource-content':
      return '资源内容';
    case 'resource-gate':
      return '资源准入审计';
    case 'atomic-plan':
      return '原子任务规划';
    case 'implementation-task':
      return '实现任务';
    case 'implementation-audit':
      return '实现审计';
    case 'acceptance':
      return '运行验收';
  }
};

const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The Clipboard API can be unavailable in desktop webviews; use the
    // user-initiated DOM copy operation below in that case.
  }

  if (typeof document.execCommand !== 'function') return false;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } finally {
    input.remove();
  }
};

const useVerticalOverflow = <T extends HTMLElement>(contentKey: string) => {
  const elementRef = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const measure = useCallback(() => {
    const element = elementRef.current;
    setIsOverflowing(Boolean(element && element.scrollHeight > element.clientHeight + 1));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (elementRef.current) observer?.observe(elementRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [contentKey, measure]);

  return { elementRef, isOverflowing };
};

const taskStatusText = (task: WorkflowCardTask): string => {
  if (task.status === 'stopped') return '已停止';
  if (task.operation === 'review') {
    if (task.status === 'completed') return '已审计';
    if (task.status === 'running') return '审计中';
    if (task.status === 'failed' || task.status === 'blocked') return '审计失败';
    return '待审计';
  }
  if (task.operation === 'produce') {
    if (task.status === 'completed') return '已就绪';
    if (task.status === 'running') return '准备中';
    if (task.status === 'failed' || task.status === 'blocked') return '准备失败';
    return '待准备';
  }
  if (task.operation === 'assemble') {
    if (task.status === 'completed') return '已装配';
    if (task.status === 'running') return '装配中';
    if (task.status === 'failed' || task.status === 'blocked') return '装配失败';
    return '待装配';
  }
  if (task.status === 'completed') return '已完成';
  if (task.status === 'running') return '编写中';
  if (task.status === 'failed' || task.status === 'blocked') return '编写失败';
  return '待编写';
};

const taskIcon = (task: WorkflowCardTask) => {
  const label = `任务状态：${taskStatusText(task)}`;
  if (task.status === 'completed')
    return (
      <CircleCheckBig
        aria-label={label}
        data-task-icon={task.operation === 'review' ? 'review-completed' : 'write-completed'}
        className="h-4 w-4 text-emerald-300"
      />
    );
  if (task.status === 'failed' || task.status === 'blocked')
    return (
      <XCircle
        aria-label={label}
        data-task-icon={task.operation === 'review' ? 'review-failed' : 'write-failed'}
        className="h-4 w-4 text-rose-300"
      />
    );
  if (task.status === 'stopped')
    return <CirclePause aria-label={label} data-task-icon="task-stopped" className="h-4 w-4 text-zinc-500" />;
  if (task.operation === 'review')
    return (
      <ScanTextTaskIcon
        aria-label={label}
        data-task-icon={task.status === 'running' ? 'review-running' : 'review-pending'}
        className={`h-4 w-4 ${task.status === 'running' ? 'animate-pulse text-sky-300' : 'text-zinc-600'}`}
      />
    );
  if (task.status === 'running')
    return (
      <LoaderCircle aria-label={label} data-task-icon="write-running" className="h-4 w-4 animate-spin text-sky-300" />
    );
  return <Circle aria-label={label} data-task-icon="write-pending" className="h-4 w-4 text-zinc-600" />;
};

type AnimatedStatusIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type AnimatedStatusIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & { size?: number } & RefAttributes<AnimatedStatusIconHandle>
>;

const AutoPlayStatusIcon = ({
  Icon,
  ...props
}: {
  Icon: AnimatedStatusIconComponent;
} & HTMLAttributes<HTMLDivElement> & { size?: number }) => {
  const iconRef = useRef<AnimatedStatusIconHandle>(null);

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;
    void Promise.resolve(icon.startAnimation()).then(() => {
      if (iconRef.current === icon) icon.stopAnimation();
    });
  }, []);

  return (
    <Icon
      ref={iconRef}
      data-animation="once"
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      {...props}
    />
  );
};

const WorkflowStatusIcon = ({ status }: { status: WorkflowCardPayload['status'] }) => {
  const props = {
    'aria-label': `工作流状态：${statusLabel[status]}`,
    className: 'mt-0.5 h-4 w-4 shrink-0',
    size: 16,
  };

  switch (status) {
    case 'draft':
      return (
        <AutoPlayStatusIcon
          Icon={HourglassIcon}
          {...props}
          className={`${props.className} text-zinc-400`}
          data-icon="hourglass"
        />
      );
    case 'running':
      return <GripIcon {...props} data-icon="grip" loop />;
    case 'blocked':
      return (
        <AutoPlayStatusIcon
          Icon={BadgeAlertIcon}
          {...props}
          className={`${props.className} text-amber-300`}
          data-icon="badge-alert"
        />
      );
    case 'verifying':
      return (
        <AutoPlayStatusIcon
          Icon={ScanTextIcon}
          {...props}
          className={`${props.className} text-sky-300`}
          data-icon="scan-text"
        />
      );
    case 'completed':
      return (
        <AutoPlayStatusIcon
          Icon={CircleCheckIcon}
          {...props}
          className={`${props.className} text-emerald-300`}
          data-icon="circle-check"
        />
      );
    case 'failed':
      return (
        <AutoPlayStatusIcon Icon={XIcon} {...props} className={`${props.className} text-rose-400`} data-icon="x" />
      );
    case 'cancelled':
      return (
        <AutoPlayStatusIcon
          Icon={PauseIcon}
          {...props}
          className={`${props.className} text-zinc-400`}
          data-icon="pause"
        />
      );
    case 'stale':
      return (
        <AutoPlayStatusIcon
          Icon={ClockIcon}
          {...props}
          className={`${props.className} text-amber-300`}
          data-icon="clock"
        />
      );
  }
};

export function WorkflowCard({
  workflow,
  onAction,
}: {
  workflow: WorkflowCardPayload;
  onAction?: (action: WorkflowCardAction) => Promise<void> | void;
}) {
  const { showSuccess, showError } = useToastContext();
  const [now, setNow] = useState(() => Date.now());
  const [actionState, setActionState] = useState<'idle' | 'pending'>('idle');
  const [actionError, setActionError] = useState('');
  const isRecoverable = workflow.recoverable === true;
  const isActive = ['draft', 'running', 'verifying'].includes(workflow.status);
  const isBlocked = ['blocked', 'failed', 'cancelled', 'stale'].includes(workflow.status);
  const hasFailureDetails = ['blocked', 'failed', 'stale'].includes(workflow.status) && Boolean(workflow.block);
  const tasks = workflow.tasks ?? [];
  const recoveryPhaseTitle = isRecoverable ? stageLabel[workflow.lastProvenPhase || ''] : undefined;
  const recoveryUnitTitle = isRecoverable
    ? displayRecoveryUnitTitle(workflow.lastProvenUnitKind, workflow.lastProvenItemId)
    : undefined;
  const recoveryMessage = '已验证的工作流检查点可继续恢复。';
  const failureMessage = isRecoverable
    ? '工作流需要恢复。请点击继续以从已验证的检查点恢复。'
    : workflow.block?.message;
  const message = isRecoverable
    ? recoveryMessage
    : workflow.thinking || (isBlocked ? workflow.block?.message : undefined) || '正在准备当前阶段…';
  const { elementRef: messageRegionRef, isOverflowing: isMessageOverflowing } = useVerticalOverflow<HTMLDivElement>(
    message || '',
  );
  const completedCount = workflow.completedTaskCount ?? tasks.filter(task => task.status === 'completed').length;
  const totalCount = workflow.totalTaskCount ?? tasks.length;
  const hasPhaseProgress =
    Number.isInteger(workflow.phaseIndex) &&
    Number.isInteger(workflow.phaseCount) &&
    Number(workflow.phaseIndex) > 0 &&
    Number(workflow.phaseCount) >= Number(workflow.phaseIndex);
  const convergingFoundation = workflow.phaseIndex === 4;
  const foundationContext =
    convergingFoundation || workflow.reviewTarget === 'foundation' || workflow.documentStep === 'FOUNDATION_REVIEW';
  const convergenceTitle = convergingFoundation ? '基础文档收敛' : '完整交付收敛';
  const substageTitle =
    workflow.substage === 'INITIAL_DRAFTING'
      ? '基础文档编写'
      : workflow.substage === 'INITIAL_REVIEW'
        ? foundationContext
          ? '基础文档初审'
          : '完整交付初审'
        : workflow.substage === 'REPAIR_PLANNING'
          ? '制定修订方案'
          : workflow.substage === 'REPAIRING'
            ? workflow.reviewTarget === 'foundation'
              ? '修订基础文档'
              : workflow.reviewTarget === 'checklist'
                ? '修订验收清单'
                : '修订资源与内容合同'
            : workflow.substage === 'CLOSURE_REVIEW'
              ? 'Closure Review'
              : workflow.substage === 'CHECKLIST_DRAFTING'
                ? '编写验收清单'
                : undefined;
  const stageTitle = isRecoverable
    ? '工作流需要恢复'
    : workflow.substage && [4, 6].includes(Number(workflow.phaseIndex))
      ? convergenceTitle
      : substageTitle ||
        stageLabel[workflow.documentStep || ''] ||
        stageLabel[workflow.currentPhase || ''] ||
        workflow.currentPhase ||
        '等待阶段';
  const convergencePosition =
    substageTitle && [4, 6].includes(Number(workflow.phaseIndex)) && workflow.substage !== 'INITIAL_DRAFTING'
      ? [workflow.convergencePass ? `第 ${workflow.convergencePass} 轮` : '', substageTitle].filter(Boolean).join(' · ')
      : undefined;
  const startedAt = Date.parse(workflow.createdAt || '');
  const finishedAt = Date.parse(workflow.completedAt || (!isActive ? workflow.updatedAt || '' : ''));
  const activeSince = Date.parse(workflow.activeSince || '');
  const durableElapsed = Number(workflow.elapsedMs);
  const elapsed = Number.isFinite(durableElapsed)
    ? Math.max(0, durableElapsed) + (isActive && Number.isFinite(activeSince) ? Math.max(0, now - activeSince) : 0)
    : Number.isFinite(startedAt)
      ? !isActive && Number.isFinite(finishedAt)
        ? finishedAt - startedAt
        : now - startedAt
      : 0;

  useEffect(() => {
    if (!isActive || !Number.isFinite(startedAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeSince, isActive, startedAt]);

  const executionText = useMemo(() => {
    const worker = workerLabel[workflow.worker || ''] || workflow.worker || '';
    const state =
      workflow.executionStatus === 'working'
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

  const handleCopyFailure = async () => {
    const message = failureMessage;
    if (!message) return;
    const copied = await copyText(message);
    if (copied) showSuccess('错误信息已复制');
    else showError('复制错误信息失败');
  };

  return (
    <section
      data-testid={`beegame-workflow-card-${workflow.runId}`}
      className="box-border min-w-0 w-full max-w-[46rem] overflow-hidden rounded-3xl border border-white/15 bg-white/[0.04] text-zinc-100 shadow-sm backdrop-blur-2xl"
    >
      <div className="px-4 py-4">
        <div className="flex items-start gap-3">
          <WorkflowStatusIcon status={workflow.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-100">{stageTitle}</h3>
                  {hasPhaseProgress ? (
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {workflow.phaseIndex} / {workflow.phaseCount}
                    </span>
                  ) : null}
                </div>
                {convergencePosition ? <p className="mt-1 text-xs text-zinc-400">{convergencePosition}</p> : null}
                {isRecoverable && (recoveryPhaseTitle || recoveryUnitTitle) ? (
                  <p className="mt-1 text-xs text-zinc-400">
                    {[recoveryPhaseTitle, recoveryUnitTitle].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-zinc-400">{statusLabel[workflow.status]}</span>
                {hasFailureDetails && workflow.block ? (
                  <div className="group relative">
                    <button
                      type="button"
                      onClick={() => void handleCopyFailure()}
                      className="rounded-full text-rose-400 outline-none transition-colors hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-rose-400/40"
                      aria-label="复制错误信息"
                      title="点击复制错误信息"
                    >
                      <AlertCircle className="h-4 w-4" />
                    </button>
                    <div
                      role="tooltip"
                      className="pointer-events-none invisible absolute right-0 top-6 z-30 w-72 rounded-xl border border-rose-400/20 bg-zinc-950/95 p-3 text-xs leading-5 text-rose-100 opacity-0 shadow-2xl backdrop-blur-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                    >
                      <p>{failureMessage}</p>
                      {workflow.block.nextAction ? (
                        <p className="mt-1 text-rose-200/70">下一步：{workflow.block.nextAction}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              ref={messageRegionRef}
              data-testid="workflow-card-message-region"
              className={`scrollbar-premium mt-1.5 max-h-20 overflow-y-auto overscroll-contain pr-1 ${isMessageOverflowing ? 'scroll-fade scroll-fade-y scroll-fade-6' : ''}`}
            >
              <MarkdownErrorBoundary messageId={`workflow-${workflow.runId}`} rawContent={message}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={{
                    p: props => <p className="mb-2 text-xs leading-5 text-zinc-300 last:mb-0" {...props} />,
                    h1: props => <h1 className="mb-2 text-xs font-semibold leading-5 text-zinc-100" {...props} />,
                    h2: props => <h2 className="mb-2 text-xs font-semibold leading-5 text-zinc-100" {...props} />,
                    h3: props => <h3 className="mb-1 text-xs font-semibold leading-5 text-zinc-100" {...props} />,
                    ul: props => (
                      <ul className="my-2 ml-4 list-disc space-y-1 text-xs leading-5 text-zinc-300" {...props} />
                    ),
                    ol: props => (
                      <ol className="my-2 ml-4 list-decimal space-y-1 text-xs leading-5 text-zinc-300" {...props} />
                    ),
                    li: props => <li className="break-words [overflow-wrap:anywhere]" {...props} />,
                    blockquote: props => (
                      <blockquote
                        className="my-2 border-l-2 border-white/15 pl-3 text-xs leading-5 text-zinc-400"
                        {...props}
                      />
                    ),
                    a: props => (
                      <a
                        className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-2 hover:text-emerald-200"
                        target="_blank"
                        rel="noreferrer"
                        {...props}
                      />
                    ),
                    strong: props => <strong className="font-semibold text-zinc-100" {...props} />,
                    pre: props => (
                      <pre
                        className="my-2 max-w-full overflow-x-auto rounded-lg border border-white/10 bg-zinc-950 p-2 text-xs leading-5 text-zinc-200"
                        {...props}
                      />
                    ),
                    code: props => (
                      <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-zinc-200" {...props} />
                    ),
                    table: props => <table className="my-2 block max-w-full overflow-x-auto text-xs" {...props} />,
                    th: props => (
                      <th
                        className="border border-white/10 px-2 py-1 text-left font-semibold text-zinc-200"
                        {...props}
                      />
                    ),
                    td: props => <td className="border border-white/10 px-2 py-1 text-zinc-300" {...props} />,
                  }}
                >
                  {message}
                </ReactMarkdown>
              </MarkdownErrorBoundary>
            </div>
            {executionText ? <p className="mt-1 text-[11px] text-zinc-500">{executionText}</p> : null}

            {tasks.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 pl-3 text-[10px] tabular-nums text-zinc-600">
                  任务 {completedCount} / {totalCount}
                </p>
                <ul
                  data-testid="workflow-card-task-region"
                  className={`scrollbar-premium space-y-2 pl-3 pr-1 ${tasks.length > 12 ? 'scroll-fade scroll-fade-y scroll-fade-6 max-h-[17.5rem] overflow-y-auto overscroll-contain' : ''}`}
                >
                  {tasks.map(task => (
                    <li key={task.id} className="flex min-w-0 items-start gap-2 text-xs">
                      <span className="mt-px shrink-0">{taskIcon(task)}</span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            task.status === 'completed'
                              ? 'truncate text-zinc-500 line-through decoration-zinc-700'
                              : task.status === 'running'
                                ? 'truncate text-zinc-200'
                                : 'truncate text-zinc-400'
                          }
                        >
                          {displayTaskTitle(task)}
                        </p>
                        {task.failureReason ? (
                          <p className="mt-0.5 line-clamp-2 text-rose-300/80">{task.failureReason}</p>
                        ) : null}
                      </div>
                      <span
                        className={
                          task.status === 'running'
                            ? 'shrink-0 text-[10px] text-sky-300'
                            : task.status === 'failed' || task.status === 'blocked'
                              ? 'shrink-0 text-[10px] text-rose-300'
                              : 'shrink-0 text-[10px] text-zinc-600'
                        }
                      >
                        {taskStatusText(task)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {actionError ? (
              <p role="alert" className="mt-3 text-xs text-rose-300">
                {actionError}
              </p>
            ) : null}
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
