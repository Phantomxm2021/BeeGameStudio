import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowCardStageSnapshot } from '../../types/message';
import { useWorkflowCardDeck } from './useWorkflowCardDeck';

const stage = (stageId: string, phaseIndex: number): WorkflowCardStageSnapshot => ({
  stageId,
  status: 'completed',
  currentPhase: stageId,
  phaseIndex,
  phaseCount: 4,
});

describe('useWorkflowCardDeck', () => {
  it('auto-follows appended cards while the selected card was newest', () => {
    const { result, rerender } = renderHook(({ snapshots }) => useWorkflowCardDeck(snapshots), {
      initialProps: { snapshots: [stage('one', 1), stage('two', 2)] },
    });

    expect(result.current.selectedStageId).toBe('two');
    rerender({ snapshots: [stage('one', 1), stage('two', 2), stage('three', 3)] });
    expect(result.current.selectedStageId).toBe('three');
    expect(result.current.selectedIndex).toBe(2);
  });

  it('stays historical when new cards append after a user-selected card', () => {
    const { result, rerender } = renderHook(({ snapshots }) => useWorkflowCardDeck(snapshots), {
      initialProps: { snapshots: [stage('one', 1), stage('two', 2)] },
    });

    act(() => result.current.selectPrevious());
    expect(result.current.selectedStageId).toBe('one');
    rerender({ snapshots: [stage('one', 1), stage('two', 2), stage('three', 3)] });
    expect(result.current.selectedStageId).toBe('one');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('anchors selection by stage identity across refreshes and clamps when it disappears', () => {
    const { result, rerender } = renderHook(({ snapshots }) => useWorkflowCardDeck(snapshots), {
      initialProps: { snapshots: [stage('one', 1), stage('two', 2), stage('three', 3)] },
    });

    act(() => result.current.selectPrevious());
    expect(result.current.selectedStageId).toBe('two');
    rerender({ snapshots: [stage('zero', 0), stage('two', 2), stage('three', 3)] });
    expect(result.current.selectedStageId).toBe('two');
    rerender({ snapshots: [stage('zero', 0)] });
    expect(result.current.selectedStageId).toBe('zero');
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.canSelectPrevious).toBe(false);
    expect(result.current.canSelectNext).toBe(false);
  });
});
