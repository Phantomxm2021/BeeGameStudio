import { useCallback, useMemo } from 'react';
import type {
  WorkflowCardAction,
  WorkflowCardPayload,
  WorkflowCardStageSnapshot,
} from '../../types/message';
import { WorkflowStageCard } from './WorkflowStageCard';
import { useWorkflowCardDeck } from './useWorkflowCardDeck';

const adaptLegacyWorkflow = (workflow: WorkflowCardPayload): WorkflowCardStageSnapshot => ({
  stageId: workflow.currentPhase?.trim() || `${workflow.runId}:current`,
  status: workflow.status,
  currentPhase: workflow.currentPhase,
  phaseIndex:
    Number.isInteger(workflow.phaseIndex) && Number(workflow.phaseIndex) > 0 ? Number(workflow.phaseIndex) : 1,
  phaseCount: workflow.phaseCount,
  substage: workflow.substage,
  convergencePass: workflow.convergencePass,
  documentStep: workflow.documentStep,
  reviewMode: workflow.reviewMode,
  reviewTarget: workflow.reviewTarget,
  worker: workflow.worker,
  thinking: workflow.thinking,
  executionStatus: workflow.executionStatus,
  currentItemId: workflow.currentItemId,
  tasks: workflow.tasks,
  completedTaskCount: workflow.completedTaskCount,
  totalTaskCount: workflow.totalTaskCount,
  createdAt: workflow.createdAt,
  completedAt: workflow.completedAt,
  updatedAt: workflow.updatedAt,
  stageStartedAt: workflow.stageStartedAt,
  elapsedMs: workflow.elapsedMs,
  activeSince: workflow.activeSince,
  block: workflow.block,
});

export function WorkflowCard({
  workflow,
  onAction,
}: {
  workflow: WorkflowCardPayload;
  onAction?: (action: WorkflowCardAction) => Promise<void> | void;
}) {
  const stageSnapshots = useMemo<readonly WorkflowCardStageSnapshot[]>(
    () => (workflow.stageSnapshots && workflow.stageSnapshots.length > 0 ? workflow.stageSnapshots : [adaptLegacyWorkflow(workflow)]),
    [workflow],
  );
  const {
    selectedStageId,
    selectedIndex,
    canSelectPrevious,
    canSelectNext,
    selectPrevious,
    selectNext,
  } = useWorkflowCardDeck(stageSnapshots);
  const selectedSnapshot = stageSnapshots.find(snapshot => snapshot.stageId === selectedStageId) || stageSnapshots.at(-1);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' && canSelectPrevious) {
        event.preventDefault();
        selectPrevious();
      } else if (event.key === 'ArrowRight' && canSelectNext) {
        event.preventDefault();
        selectNext();
      }
    },
    [canSelectNext, canSelectPrevious, selectNext, selectPrevious],
  );

  if (!selectedSnapshot) return null;

  const isDeck = stageSnapshots.length > 1;
  const recovery = {
    recoverable: workflow.recoverable,
    lastProvenPhase: workflow.lastProvenPhase,
    lastProvenUnitKind: workflow.lastProvenUnitKind,
    lastProvenItemId: workflow.lastProvenItemId,
  };

  return (
    <div
      data-testid={`beegame-workflow-card-deck-${workflow.runId}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="min-w-0 w-full outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      aria-label="工作流阶段卡片"
    >
      {isDeck ? (
        <div className="mb-2 flex items-center justify-between gap-3 px-1 text-xs text-zinc-500">
          <button
            type="button"
            onClick={selectPrevious}
            disabled={!canSelectPrevious}
            className="rounded-full px-2 py-1 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="查看上一阶段"
          >
            查看上一阶段
          </button>
          <span className="tabular-nums" aria-live="polite">
            {selectedIndex + 1} / {stageSnapshots.length}
          </span>
          <button
            type="button"
            onClick={selectNext}
            disabled={!canSelectNext}
            className="rounded-full px-2 py-1 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="查看下一阶段"
          >
            查看下一阶段
          </button>
        </div>
      ) : null}
      <WorkflowStageCard
        runId={workflow.runId}
        snapshot={selectedSnapshot}
        isLatest={selectedIndex === stageSnapshots.length - 1}
        nextAction={selectedIndex === stageSnapshots.length - 1 ? workflow.nextAction : undefined}
        recovery={selectedIndex === stageSnapshots.length - 1 ? recovery : undefined}
        onAction={onAction}
      />
    </div>
  );
}
