import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowCardStageSnapshot } from '../../types/message';

export interface WorkflowCardDeckState {
  selectedStageId?: string;
  selectedIndex: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectPrevious: () => void;
  selectNext: () => void;
}

/**
 * Keeps the visible workflow stage anchored by its stable stage identity.
 * New stages are followed only when the user was already looking at the newest one.
 */
export const useWorkflowCardDeck = (
  stageSnapshots: readonly WorkflowCardStageSnapshot[],
): WorkflowCardDeckState => {
  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(
    () => stageSnapshots.at(-1)?.stageId,
  );
  const snapshotsRef = useRef(stageSnapshots);
  const selectedRef = useRef(selectedStageId);

  const selectStage = useCallback(
    (stageId: string | undefined) => {
      if (!stageId || !stageSnapshots.some(snapshot => snapshot.stageId === stageId)) return;
      selectedRef.current = stageId;
      setSelectedStageId(current => (current === stageId ? current : stageId));
    },
    [stageSnapshots],
  );

  useEffect(() => {
    const previousSnapshots = snapshotsRef.current;
    const previousSelectedId = selectedRef.current;
    const previousNewestId = previousSnapshots.at(-1)?.stageId;
    const wasFollowingNewest = previousSelectedId === previousNewestId;
    const previousSelectedIndex = previousSnapshots.findIndex(
      snapshot => snapshot.stageId === previousSelectedId,
    );

    let nextSelectedId: string | undefined;
    if (stageSnapshots.length === 0) {
      nextSelectedId = undefined;
    } else if (wasFollowingNewest) {
      nextSelectedId = stageSnapshots.at(-1)?.stageId;
    } else {
      const selectedStillExists = stageSnapshots.some(snapshot => snapshot.stageId === previousSelectedId);
      if (selectedStillExists) {
        nextSelectedId = previousSelectedId;
      } else {
        const clampedIndex = Math.min(
          Math.max(previousSelectedIndex, 0),
          stageSnapshots.length - 1,
        );
        nextSelectedId = stageSnapshots[clampedIndex]?.stageId;
      }
    }

    snapshotsRef.current = stageSnapshots;
    selectedRef.current = nextSelectedId;
    setSelectedStageId(current => (current === nextSelectedId ? current : nextSelectedId));
  }, [stageSnapshots]);

  const selectedIndex = useMemo(() => {
    if (stageSnapshots.length === 0) return -1;
    const index = stageSnapshots.findIndex(snapshot => snapshot.stageId === selectedStageId);
    return index >= 0 ? index : stageSnapshots.length - 1;
  }, [selectedStageId, stageSnapshots]);

  const selectPrevious = useCallback(() => {
    const index = stageSnapshots.findIndex(snapshot => snapshot.stageId === selectedRef.current);
    if (index > 0) selectStage(stageSnapshots[index - 1]?.stageId);
  }, [selectStage, stageSnapshots]);

  const selectNext = useCallback(() => {
    const index = stageSnapshots.findIndex(snapshot => snapshot.stageId === selectedRef.current);
    if (index >= 0 && index < stageSnapshots.length - 1) selectStage(stageSnapshots[index + 1]?.stageId);
  }, [selectStage, stageSnapshots]);

  return {
    selectedStageId,
    selectedIndex,
    canSelectPrevious: selectedIndex > 0,
    canSelectNext: selectedIndex >= 0 && selectedIndex < stageSnapshots.length - 1,
    selectPrevious,
    selectNext,
  };
};
