import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { WorkflowCardStageSnapshot } from '../../types/message';

const POINTER_LOCK_DISTANCE = 8;
const DRAG_DISTANCE_THRESHOLD = 72;
const DRAG_VELOCITY_THRESHOLD = 0.8;
const DRAG_VELOCITY_DISTANCE = 48;
const DRAG_MAX_OFFSET = 140;
const REDUCED_MOTION_MAX_OFFSET = 40;

type CardPointerEvent = ReactPointerEvent<HTMLElement>;

export interface WorkflowCardDeckDragHandlers {
  onPointerDown: (event: CardPointerEvent) => void;
  onPointerMove: (event: CardPointerEvent) => void;
  onPointerUp: (event: CardPointerEvent) => void;
  onPointerCancel: (event: CardPointerEvent) => void;
  onLostPointerCapture: (event: CardPointerEvent) => void;
  onSelect: () => void;
}

export interface WorkflowCardDeckState {
  selectedStageId?: string;
  selectedIndex: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectPrevious: () => void;
  selectNext: () => void;
  dragOffset: number;
  isDragging: boolean;
  prefersReducedMotion: boolean;
  dragHandlers: WorkflowCardDeckDragHandlers;
}

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, option, [role="button"], [contenteditable], [data-no-card-drag]',
    ),
  );
};

const hasSelection = (): boolean => {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
};

const readReducedMotionPreference = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

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
  const pointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    locked: boolean;
    cancelled: boolean;
    captureTarget?: HTMLElement;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readReducedMotionPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.('change', update);
    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

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
  const canSelectPrevious = selectedIndex > 0;
  const canSelectNext = selectedIndex >= 0 && selectedIndex < stageSnapshots.length - 1;

  const selectPrevious = useCallback(() => {
    const index = stageSnapshots.findIndex(snapshot => snapshot.stageId === selectedRef.current);
    if (index > 0) selectStage(stageSnapshots[index - 1]?.stageId);
  }, [selectStage, stageSnapshots]);

  const selectNext = useCallback(() => {
    const index = stageSnapshots.findIndex(snapshot => snapshot.stageId === selectedRef.current);
    if (index >= 0 && index < stageSnapshots.length - 1) selectStage(stageSnapshots[index + 1]?.stageId);
  }, [selectStage, stageSnapshots]);

  const clearPointer = useCallback((pointerId?: number) => {
    const pointer = pointerRef.current;
    if (!pointer || (pointerId !== undefined && pointer.pointerId !== pointerId)) return;
    pointerRef.current = null;
    const captureTarget = pointer.captureTarget;
    const hasCapture = captureTarget?.hasPointerCapture;
    if (
      captureTarget &&
      typeof captureTarget.releasePointerCapture === 'function' &&
      (!hasCapture || hasCapture.call(captureTarget, pointer.pointerId))
    ) {
      try {
        captureTarget.releasePointerCapture(pointer.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    setDragOffset(0);
    setIsDragging(false);
  }, []);

  const onPointerDown = useCallback((event: CardPointerEvent) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    if (pointerRef.current) return;
    if (isInteractiveTarget(event.target) || hasSelection()) return;
    pointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
      locked: false,
      cancelled: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: CardPointerEvent) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId || pointer.cancelled) return;
      const dx = event.clientX - pointer.startX;
      const dy = event.clientY - pointer.startY;
      const distance = Math.hypot(dx, dy);
      if (!pointer.locked) {
        if (hasSelection()) {
          pointer.cancelled = true;
          clearPointer(pointer.pointerId);
          return;
        }
        if (distance < POINTER_LOCK_DISTANCE) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.1) {
          clearPointer(pointer.pointerId);
          return;
        }
        pointer.locked = true;
        const currentTarget = event.currentTarget;
        if (currentTarget instanceof HTMLElement && typeof currentTarget.setPointerCapture === 'function') {
          try {
            currentTarget.setPointerCapture(pointer.pointerId);
            pointer.captureTarget = currentTarget;
          } catch {
            // Pointer capture is not available in some embedded webviews.
          }
        }
        setIsDragging(true);
      }

      event.preventDefault();
      const atBoundary = (dx > 0 && !canSelectPrevious) || (dx < 0 && !canSelectNext);
      const resistedOffset = atBoundary ? dx * 0.24 : dx;
      const maxOffset = prefersReducedMotion ? REDUCED_MOTION_MAX_OFFSET : DRAG_MAX_OFFSET;
      setDragOffset(Math.max(-maxOffset, Math.min(maxOffset, resistedOffset)));
    },
    [canSelectNext, canSelectPrevious, clearPointer, prefersReducedMotion],
  );

  const onPointerUp = useCallback(
    (event: CardPointerEvent) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      if (pointer.cancelled || !pointer.locked) {
        clearPointer(pointer.pointerId);
        return;
      }
      const dx = event.clientX - pointer.startX;
      const elapsed = Math.max(1, Date.now() - pointer.startTime);
      const velocity = Math.abs(dx) / elapsed;
      const shouldNavigate =
        Math.abs(dx) >= DRAG_DISTANCE_THRESHOLD ||
        (Math.abs(dx) >= DRAG_VELOCITY_DISTANCE && velocity >= DRAG_VELOCITY_THRESHOLD);
      const navigatePrevious = dx > 0;
      clearPointer(pointer.pointerId);
      if (shouldNavigate) {
        if (navigatePrevious) selectPrevious();
        else selectNext();
      }
    },
    [clearPointer, selectNext, selectPrevious],
  );

  const onPointerCancel = useCallback(
    (event: CardPointerEvent) => clearPointer(event.pointerId),
    [clearPointer],
  );

  const onLostPointerCapture = useCallback(
    (event: CardPointerEvent) => clearPointer(event.pointerId),
    [clearPointer],
  );

  const onSelect = useCallback(() => {
    const pointer = pointerRef.current;
    if (pointer && !pointer.locked) clearPointer(pointer.pointerId);
  }, [clearPointer]);

  const dragHandlers = useMemo<WorkflowCardDeckDragHandlers>(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onSelect }),
    [onLostPointerCapture, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, onSelect],
  );

  return {
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
  };
};
