import type { Language } from '../AgentsConfig';
import type { CreationMode } from './IdeaPromptForm';
import type { BeeGameIntakeOption, BeeGameIntakeSettings } from '../../../services/beeGameAdapter';

// Browser-only recovery hints. Confirmed builds still use authoritative server state.
const pendingAuthIdeaStorageKey = 'beegame.pendingAuthIdea.v1';
const pendingIdeaDraftStorageKey = 'beegame.pendingIdeaDraft.v1';
const pendingIntakeFlowStorageKey = 'beegame.pendingIntakeFlow.v1';
const pendingRealtimeBillingStorageKey = 'beegame.pendingRealtimeBilling.v1';
const pendingAuthIdeaMaxAgeMs = 30 * 60 * 1000;
const pendingIntakeFlowMaxAgeMs = 30 * 60 * 1000;

export type RestorableIntakePhase = 'options_ready' | 'configuring_details' | 'confirming_brief';

type PendingAuthIdeaState = {
  idea: string;
  creationMode?: CreationMode;
  referenceNames?: string[];
  createdAt: number;
};

export type PendingIdeaDraftState = {
  idea: string;
  creationMode?: CreationMode;
  referenceNames?: string[];
  createdAt: number;
};

export type PendingIntakeFlowState = {
  creationMode?: CreationMode;
  referenceNames?: string[];
  phase: RestorableIntakePhase;
  idea: string;
  language: Language;
  options: BeeGameIntakeOption[];
  selectedOption?: BeeGameIntakeOption;
  settings?: BeeGameIntakeSettings;
  createdAt: number;
};

export function readPendingAuthIdeaState(): PendingAuthIdeaState | null {
  try {
    const raw = sessionStorage.getItem(pendingAuthIdeaStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!isPendingAuthIdeaState(value)) return null;
    if (Date.now() - value.createdAt > pendingAuthIdeaMaxAgeMs) {
      clearPendingAuthIdeaState();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function readPendingIdeaDraftState(): PendingIdeaDraftState | null {
  try {
    const raw = sessionStorage.getItem(pendingIdeaDraftStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!isPendingIdeaDraftState(value)) return null;
    if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
      clearPendingIdeaDraftState();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writePendingIdeaDraftState(idea: string, creationMode: CreationMode, referenceNames: string[]): void {
  const normalizedIdea = idea.trim();
  try {
    if (!normalizedIdea && !referenceNames.length) {
      clearPendingIdeaDraftState();
      return;
    }
    sessionStorage.setItem(
      pendingIdeaDraftStorageKey,
      JSON.stringify({
        idea: normalizedIdea,
        creationMode,
        referenceNames,
        createdAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort draft recovery only.
  }
}

export function clearPendingIdeaDraftState(): void {
  try {
    sessionStorage.removeItem(pendingIdeaDraftStorageKey);
  } catch {
    // Ignore storage failures; this cache never drives server state.
  }
}

export function readPendingIntakeFlowState(): PendingIntakeFlowState | null {
  try {
    const raw = sessionStorage.getItem(pendingIntakeFlowStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!isPendingIntakeFlowState(value)) {
      clearPendingIntakeFlowState();
      return null;
    }
    if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
      clearPendingIntakeFlowState();
      return null;
    }
    return value;
  } catch {
    clearPendingIntakeFlowState();
    return null;
  }
}

export function writePendingIntakeFlowState(value: Omit<PendingIntakeFlowState, 'createdAt'>): void {
  try {
    sessionStorage.setItem(
      pendingIntakeFlowStorageKey,
      JSON.stringify({
        ...value,
        createdAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort UI recovery only. Confirmed builds still go through server state.
  }
}

export function clearPendingIntakeFlowState(): void {
  try {
    sessionStorage.removeItem(pendingIntakeFlowStorageKey);
  } catch {
    // Ignore storage failures; this cache never drives server state.
  }
}

export function readPendingRealtimeBillingIdea(): string {
  try {
    const raw = sessionStorage.getItem(pendingRealtimeBillingStorageKey);
    if (!raw) return '';
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.idea !== 'string' || typeof value.createdAt !== 'number') return '';
    if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
      sessionStorage.removeItem(pendingRealtimeBillingStorageKey);
      return '';
    }
    return value.idea.trim();
  } catch {
    return '';
  }
}

export function writePendingRealtimeBillingIdea(idea: string): void {
  try {
    sessionStorage.setItem(
      pendingRealtimeBillingStorageKey,
      JSON.stringify({ idea: idea.trim(), createdAt: Date.now() }),
    );
  } catch {
    // Best-effort recovery for a browser refresh.
  }
}

export function clearPendingRealtimeBillingIdea(): void {
  try {
    sessionStorage.removeItem(pendingRealtimeBillingStorageKey);
  } catch {
    // Ignore storage failures; the in-memory flow remains authoritative.
  }
}

export function writePendingAuthIdeaState(idea: string, creationMode: CreationMode, referenceNames: string[]): void {
  const normalizedIdea = idea.trim();
  if (!normalizedIdea) return;
  try {
    sessionStorage.setItem(
      pendingAuthIdeaStorageKey,
      JSON.stringify({
        idea: normalizedIdea,
        creationMode,
        referenceNames,
        createdAt: Date.now(),
      }),
    );
  } catch {
    // OAuth redirects unload the page; this is best-effort recovery only.
  }
}

export function clearPendingAuthIdeaState(): void {
  try {
    sessionStorage.removeItem(pendingAuthIdeaStorageKey);
  } catch {
    // Ignore storage failures; the in-memory login flow can still continue.
  }
}

export function clearIntakeRecoveryState(): void {
  clearPendingIdeaDraftState();
  clearPendingIntakeFlowState();
}

function isPendingAuthIdeaState(value: unknown): value is PendingAuthIdeaState {
  return (
    isRecord(value) &&
    typeof value.idea === 'string' &&
    value.idea.trim().length > 0 &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

function isPendingIdeaDraftState(value: unknown): value is PendingIdeaDraftState {
  return (
    isRecord(value) &&
    typeof value.idea === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

function isPendingIntakeFlowState(value: unknown): value is PendingIntakeFlowState {
  if (!isRecord(value)) return false;
  const phase = value.phase;
  if (phase !== 'options_ready' && phase !== 'configuring_details' && phase !== 'confirming_brief') return false;
  if (typeof value.idea !== 'string' || value.idea.trim().length === 0) return false;
  if (!Array.isArray(value.options) || (value.creationMode === 'blueprint' ? value.options.length !== 0 : value.options.length !== 3)) return false;
  if (typeof value.language !== 'string') return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (
    (phase === 'configuring_details' || phase === 'confirming_brief') &&
    (!isRecord(value.selectedOption) || !isRecord(value.settings))
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
