import { useCallback, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
    dragOffset,
    isDragging,
    prefersReducedMotion,
    dragHandlers,
  } = useWorkflowCardDeck(stageSnapshots);
  const framerReducedMotion = useReducedMotion();
  const reducedMotion = Boolean(framerReducedMotion || prefersReducedMotion);
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

  const isDeck = stageSnapshots.length > 1;
  const stackLayers = useMemo(() => {
    if (!isDeck || selectedIndex < 0) return [];
    const previous = stageSnapshots
      .slice(0, selectedIndex)
      .reverse()
      .slice(0, 2);
    if (previous.length >= 2) return previous;
    return [
      ...previous,
      ...stageSnapshots.slice(selectedIndex + 1, selectedIndex + 1 + (2 - previous.length)),
    ];
  }, [isDeck, selectedIndex, stageSnapshots]);
  const frontTransition = useMemo(
    () =>
      isDragging
        ? { duration: 0 }
        : reducedMotion
          ? { duration: 0.12, ease: 'easeOut' as const }
          : { type: 'spring' as const, stiffness: 340, damping: 32, mass: 0.8 },
    [isDragging, reducedMotion],
  );
  if (!selectedSnapshot) return null;

  const recovery = {
    recoverable: workflow.recoverable,
    lastProvenPhase: workflow.lastProvenPhase,
    lastProvenUnitKind: workflow.lastProvenUnitKind,
    lastProvenItemId: workflow.lastProvenItemId,
  };

  const deckControls = isDeck ? (
    <div
      data-testid="workflow-card-controls"
      className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-full border border-white/10 bg-black/25 px-0.5 py-0.5"
    >
      <button
        type="button"
        onClick={selectPrevious}
        disabled={!canSelectPrevious}
        className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="查看上一阶段"
        title="查看上一阶段"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        data-testid="workflow-card-deck-counter"
        className="min-w-[3rem] text-center text-[11px] tabular-nums text-zinc-400"
        aria-live="polite"
      >
        {selectedIndex + 1} / {stageSnapshots.length}
      </span>
      <button
        type="button"
        onClick={selectNext}
        disabled={!canSelectNext}
        className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="查看下一阶段"
        title="查看下一阶段"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  ) : undefined;

  return (
    <div
      data-testid={`beegame-workflow-card-deck-${workflow.runId}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="min-w-0 w-full outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      aria-label="工作流阶段卡片"
    >
      <div className={isDeck ? 'relative min-w-0 w-full overflow-visible pr-6 pb-6' : 'relative min-w-0 w-full'}>
        <div
          data-testid="workflow-card-deck"
          role="group"
          aria-label="工作流阶段卡片组"
          className="relative min-w-0 w-full overflow-visible"
          {...dragHandlers}
        >
          {stackLayers.map((snapshot, layerIndex) => {
            const depth = layerIndex + 1;
            const offset = reducedMotion ? depth * 4 : depth * 10;
            const verticalOffset = reducedMotion ? depth * 3 : depth * 8;
            return (
              <div
                key={snapshot.stageId}
                data-testid={`workflow-card-stack-layer-${depth}`}
                data-workflow-card-layer="true"
                data-opaque-surface="true"
                data-stage-id={snapshot.stageId}
                data-stack-depth={depth}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-3xl border border-white/10 bg-[#17181d] shadow-sm"
                style={{
                  transform: `translate3d(${offset}px, ${verticalOffset}px, 0)`,
                  zIndex: 10 - depth,
                }}
              />
            );
          })}
          <motion.div
            data-testid="workflow-card-front"
            data-dragging={isDragging ? 'true' : 'false'}
            data-reduced-motion={reducedMotion ? 'true' : 'false'}
            data-stage-id={selectedSnapshot.stageId}
            aria-current="true"
            className="relative z-20 min-w-0 w-full"
            animate={{ x: dragOffset }}
            initial={false}
            transition={frontTransition}
            style={{ touchAction: 'pan-y', width: isDeck ? 'calc(100% + 1.5rem)' : '100%' }}
          >
            <WorkflowStageCard
              runId={workflow.runId}
              snapshot={selectedSnapshot}
              isLatest={selectedIndex === stageSnapshots.length - 1}
              nextAction={selectedIndex === stageSnapshots.length - 1 ? workflow.nextAction : undefined}
              recovery={selectedIndex === stageSnapshots.length - 1 ? recovery : undefined}
              headerControls={deckControls}
              onAction={onAction}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
