import { describe, expect, it } from 'vitest';

import { GLOBAL_WORKFLOW_PHASES, deriveGlobalWorkflowProgress } from './workflowProgress';

const messageAt = (timestamp: number) => ({
  id: `msg-${timestamp}`,
  sender: 'metis',
  content: 'working',
  timestamp,
});

describe('deriveGlobalWorkflowProgress', () => {
  it('starts empty projects at zero instead of a default phase boost', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: { current_phase: 0, phase_name: '', history: [] },
      currentStatus: 'idle',
      messages: [],
    });

    expect(progress).toBe(0);
  });

  it('keeps idea intake within the first global segment before brief starts', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: { current_phase: 0, phase_name: '', history: [] },
      currentStatus: 'running',
      messages: [messageAt(1), messageAt(2), messageAt(3)],
    });

    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(100 / GLOBAL_WORKFLOW_PHASES.length);
  });

  it('maps brief to the first production phase instead of twenty percent', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: {
        current_phase: 1,
        phase_name: 'brief',
        history: [{ phase: 1, name: 'brief', timestamp: 1_000 }],
      },
      currentStatus: 'running',
      messages: [],
    });

    expect(progress).toBeGreaterThanOrEqual(100 / GLOBAL_WORKFLOW_PHASES.length);
    expect(progress).toBeLessThan(20);
  });

  it('uses phase names rather than the numeric current_phase counter', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: {
        current_phase: 6,
        phase_name: 'gdd',
        history: [{ phase: 6, name: 'gdd', timestamp: 1_000 }],
      },
      currentStatus: 'running',
      messages: [],
    });

    const gddIndex = GLOBAL_WORKFLOW_PHASES.indexOf('gdd');
    expect(progress).toBeGreaterThanOrEqual((gddIndex / GLOBAL_WORKFLOW_PHASES.length) * 100);
    expect(progress).toBeLessThan(((gddIndex + 1) / GLOBAL_WORKFLOW_PHASES.length) * 100);
  });

  it('keeps later phases monotonic across implementation, qa, and build', () => {
    const phaseProgress = ['gdd', 'implementation', 'qa', 'build'].map((phaseName) =>
      deriveGlobalWorkflowProgress({
        phaseInfo: {
          current_phase: 1,
          phase_name: phaseName,
          history: [{ phase: 1, name: phaseName, timestamp: 1_000 }],
        },
        currentStatus: 'running',
        messages: [],
      }),
    );

    expect(phaseProgress[0]).toBeLessThan(phaseProgress[1]);
    expect(phaseProgress[1]).toBeLessThan(phaseProgress[2]);
    expect(phaseProgress[2]).toBeLessThan(phaseProgress[3]);
    expect(phaseProgress[3]).toBeLessThan(100);
  });

  it('does not let activity spill into the next global phase', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: {
        current_phase: 1,
        phase_name: 'brief',
        history: [{ phase: 1, name: 'brief', timestamp: 1_000 }],
      },
      currentStatus: 'running',
      messages: Array.from({ length: 80 }, (_, index) => messageAt(1_001 + index)),
    });

    const nextPhaseBase = ((GLOBAL_WORKFLOW_PHASES.indexOf('brief') + 1) / GLOBAL_WORKFLOW_PHASES.length) * 100;
    expect(progress).toBeLessThan(nextPhaseBase);
  });

  it('finishes at one hundred percent only when the dashboard is finished', () => {
    const progress = deriveGlobalWorkflowProgress({
      phaseInfo: {
        current_phase: 10,
        phase_name: 'build',
        history: [{ phase: 10, name: 'build', timestamp: 1_000 }],
      },
      currentStatus: 'finished',
      messages: [],
    });

    expect(progress).toBe(100);
  });
});
