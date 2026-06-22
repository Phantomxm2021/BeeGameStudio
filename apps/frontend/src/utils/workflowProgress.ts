import type { PhaseInfo } from '../store/systemStore';
import type { Message } from '../types/message';

export const GLOBAL_WORKFLOW_PHASES = [
  'idea_intake',
  'brief',
  'gdd',
  'architecture',
  'art_direction',
  'ui',
  'asset',
  'implementation',
  'qa',
  'polish',
  'build',
] as const;

type GlobalWorkflowPhase = (typeof GLOBAL_WORKFLOW_PHASES)[number];

interface WorkflowProgressInput {
  phaseInfo: PhaseInfo | null;
  currentStatus: string;
  messages: Pick<Message, 'timestamp'>[];
}

const ACTIVE_STATUSES = new Set(['running', 'waiting_approval', 'paused']);

export function deriveGlobalWorkflowProgress({ phaseInfo, currentStatus, messages }: WorkflowProgressInput): number {
  if (currentStatus === 'finished') return 100;

  const activePhase = resolveActivePhase(phaseInfo);
  const segmentWeight = 100 / GLOBAL_WORKFLOW_PHASES.length;

  if (!activePhase) {
    if (!ACTIVE_STATUSES.has(currentStatus) && messages.length === 0) return 0;
    return clamp(messages.length > 0 ? Math.min(messages.length * 0.6, segmentWeight * 0.8) : segmentWeight * 0.2, 0, segmentWeight - 0.01);
  }

  const phaseIndex = GLOBAL_WORKFLOW_PHASES.indexOf(activePhase);
  const baseProgress = phaseIndex * segmentWeight;
  const nextPhaseBase = (phaseIndex + 1) * segmentWeight;
  const phaseStartTime = phaseStartTimestamp(phaseInfo, activePhase);
  const messagesInCurrentPhase = phaseStartTime > 0
    ? messages.filter((message) => Number(message.timestamp) > phaseStartTime).length
    : messages.length;
  const activityContribution = Math.min((messagesInCurrentPhase / 20) * (segmentWeight * 0.8), segmentWeight * 0.8);
  const progress = baseProgress + activityContribution;

  return clamp(progress, 0, Math.min(nextPhaseBase - 0.01, 99.99));
}

function resolveActivePhase(phaseInfo: PhaseInfo | null): GlobalWorkflowPhase | null {
  const phaseName = normalizePhaseName(phaseInfo?.phase_name);
  if (isGlobalWorkflowPhase(phaseName)) return phaseName;

  const lastHistoryPhase = [...(phaseInfo?.history || [])]
    .reverse()
    .map((item) => normalizePhaseName(item.name))
    .find(isGlobalWorkflowPhase);

  return lastHistoryPhase || null;
}

function phaseStartTimestamp(phaseInfo: PhaseInfo | null, phase: GlobalWorkflowPhase): number {
  const historyItem = [...(phaseInfo?.history || [])]
    .reverse()
    .find((item) => normalizePhaseName(item.name) === phase);
  return Number(historyItem?.timestamp) || 0;
}

function normalizePhaseName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isGlobalWorkflowPhase(value: string): value is GlobalWorkflowPhase {
  return (GLOBAL_WORKFLOW_PHASES as readonly string[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
