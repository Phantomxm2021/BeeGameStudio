export const PHASE_PROMOTION_GATE_KIND = 'phase_promotion_approval';

const REVIEW_BLOCKER_GATE_KINDS = new Set(['review_blocker_resolution', 'blocker_resolution']);

export const normalizeGateKind = (value: unknown): string => String(value ?? '').trim();

export const isReviewBlockerGateKind = (value: unknown): boolean => (
  REVIEW_BLOCKER_GATE_KINDS.has(normalizeGateKind(value))
);
