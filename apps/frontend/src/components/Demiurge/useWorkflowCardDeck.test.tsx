import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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
  const DragHarness = ({ snapshots }: { snapshots: readonly WorkflowCardStageSnapshot[] }): ReactNode => {
    const deck = useWorkflowCardDeck(snapshots);
    return (
      <div
        data-testid="drag-harness"
        data-selected-index={deck.selectedIndex}
        data-drag-offset={deck.dragOffset}
        {...deck.dragHandlers}
      >
        <div data-testid="role-button-target" role="button">selectable card text</div>
      </div>
    );
  };

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

  it('moves one card per deliberate horizontal drag in either direction', () => {
    const snapshots = [stage('one', 1), stage('two', 2), stage('three', 3)];
    render(<DragHarness snapshots={snapshots} />);
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(harness, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 1, clientX: 210, clientY: 42 });
    fireEvent.pointerUp(harness, { pointerId: 1, clientX: 210, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '1');

    fireEvent.pointerDown(harness, { pointerId: 2, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 2, clientX: 30, clientY: 42 });
    fireEvent.pointerUp(harness, { pointerId: 2, clientX: 30, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '2');
  });

  it('does not lock or navigate when vertical intent dominates', () => {
    const snapshots = [stage('one', 1), stage('two', 2), stage('three', 3)];
    render(<DragHarness snapshots={snapshots} />);
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(harness, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 1, clientX: 130, clientY: 100 });
    fireEvent.pointerUp(harness, { pointerId: 1, clientX: 130, clientY: 100 });
    expect(harness).toHaveAttribute('data-selected-index', '2');
    expect(harness).toHaveAttribute('data-drag-offset', '0');
  });

  it('snaps back for sub-threshold drags and safely cancels pointer capture', () => {
    const snapshots = [stage('one', 1), stage('two', 2), stage('three', 3)];
    render(<DragHarness snapshots={snapshots} />);
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(harness, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 1, clientX: 150, clientY: 42 });
    expect(harness).not.toHaveAttribute('data-selected-index', '1');
    fireEvent.pointerCancel(harness, { pointerId: 1, clientX: 150, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '2');
    expect(harness).toHaveAttribute('data-drag-offset', '0');
  });

  it('does not hijack a selection that starts before horizontal lock', () => {
    const snapshots = [stage('one', 1), stage('two', 2), stage('three', 3)];
    render(<DragHarness snapshots={snapshots} />);
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(harness, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(harness);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerMove(harness, { pointerId: 1, clientX: 220, clientY: 42 });
    fireEvent.pointerUp(harness, { pointerId: 1, clientX: 220, clientY: 42 });
    selection?.removeAllRanges();
    expect(harness).toHaveAttribute('data-selected-index', '2');
  });

  it('excludes role button targets from pointer drags', () => {
    const snapshots = [stage('one', 1), stage('two', 2), stage('three', 3)];
    render(<DragHarness snapshots={snapshots} />);
    const target = screen.getByTestId('role-button-target');
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(target, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 220, clientY: 42 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 220, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '2');
  });

  it('applies restrained resistance at deck boundaries without wrapping', () => {
    const snapshots = [stage('one', 1), stage('two', 2)];
    render(<DragHarness snapshots={snapshots} />);
    const harness = screen.getByTestId('drag-harness');

    fireEvent.pointerDown(harness, { pointerId: 1, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 1, clientX: -20, clientY: 42 });
    expect(Number(harness.getAttribute('data-drag-offset'))).toBeLessThan(0);
    expect(Number(harness.getAttribute('data-drag-offset'))).toBeLessThan(140);
    fireEvent.pointerUp(harness, { pointerId: 1, clientX: -20, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '1');

    fireEvent.pointerDown(harness, { pointerId: 2, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 2, clientX: 260, clientY: 42 });
    fireEvent.pointerUp(harness, { pointerId: 2, clientX: 260, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '0');

    fireEvent.pointerDown(harness, { pointerId: 3, clientX: 120, clientY: 40, button: 0 });
    fireEvent.pointerMove(harness, { pointerId: 3, clientX: 260, clientY: 42 });
    expect(Number(harness.getAttribute('data-drag-offset'))).toBeGreaterThan(0);
    expect(Number(harness.getAttribute('data-drag-offset'))).toBeLessThan(140);
    fireEvent.pointerUp(harness, { pointerId: 3, clientX: 260, clientY: 42 });
    expect(harness).toHaveAttribute('data-selected-index', '0');
  });
});
