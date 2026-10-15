import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearIntakeRecoveryState,
  readPendingAuthIdeaState,
  readPendingIdeaDraftState,
  readPendingIntakeFlowState,
  readPendingRealtimeBillingIdea,
  writePendingAuthIdeaState,
  writePendingIdeaDraftState,
  writePendingIntakeFlowState,
  writePendingRealtimeBillingIdea,
} from './intakeRecovery';

const now = 1_700_000_000_000;

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
});

afterEach(() => vi.restoreAllMocks());

describe('intake recovery storage', () => {
  it('keeps the existing keys and normalizes drafts without treating them as confirmed builds', () => {
    writePendingAuthIdeaState('  Build a game  ', 'blueprint', ['plan.md']);
    expect(readPendingAuthIdeaState()).toEqual({
      idea: 'Build a game', creationMode: 'blueprint', referenceNames: ['plan.md'], createdAt: now,
    });
    expect(sessionStorage.getItem('beegame.pendingAuthIdea.v1')).not.toBeNull();
    writePendingIdeaDraftState(' ', 'creative', ['reference.png']);
    expect(readPendingIdeaDraftState()?.referenceNames).toEqual(['reference.png']);
    writePendingRealtimeBillingIdea('  Build a game  ');
    expect(readPendingRealtimeBillingIdea()).toBe('Build a game');
    clearIntakeRecoveryState();
    expect(readPendingIdeaDraftState()).toBeNull();
    // Closing intake does not consume OAuth or billing-confirmation recovery.
    expect(readPendingAuthIdeaState()?.idea).toBe('Build a game');
    expect(readPendingRealtimeBillingIdea()).toBe('Build a game');
  });

  it('expires recovery hints after the existing 30-minute window', () => {
    writePendingAuthIdeaState('A game', 'creative', []);
    writePendingIdeaDraftState('A game', 'creative', []);
    writePendingRealtimeBillingIdea('A game');
    writePendingIntakeFlowState({ phase: 'options_ready', idea: 'A game', language: 'en', creationMode: 'blueprint', options: [] });
    vi.mocked(Date.now).mockReturnValue(now + 30 * 60 * 1000 + 1);
    expect(readPendingAuthIdeaState()).toBeNull();
    expect(readPendingIdeaDraftState()).toBeNull();
    expect(readPendingIntakeFlowState()).toBeNull();
    expect(readPendingRealtimeBillingIdea()).toBe('');
    expect(sessionStorage.length).toBe(0);
  });

  it('rejects malformed or incomplete stored flow state', () => {
    sessionStorage.setItem('beegame.pendingIntakeFlow.v1', '{broken');
    expect(readPendingIntakeFlowState()).toBeNull();
    expect(sessionStorage.getItem('beegame.pendingIntakeFlow.v1')).toBeNull();
    sessionStorage.setItem('beegame.pendingIntakeFlow.v1', JSON.stringify({
      phase: 'confirming_brief', idea: 'A game', language: 'en', creationMode: 'blueprint', options: [], createdAt: now,
    }));
    expect(readPendingIntakeFlowState()).toBeNull();
  });

  it('does not block the UI when browser storage is unavailable', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const)
      vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Storage unavailable'); });
    expect(() => writePendingIdeaDraftState('A game', 'creative', [])).not.toThrow();
    expect(() => clearIntakeRecoveryState()).not.toThrow();
    expect(readPendingAuthIdeaState()).toBeNull();
    expect(readPendingIdeaDraftState()).toBeNull();
    expect(readPendingIntakeFlowState()).toBeNull();
    expect(readPendingRealtimeBillingIdea()).toBe('');
  });
});
