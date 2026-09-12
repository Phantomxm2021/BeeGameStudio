import type { SingleReviewState } from './single-agent-journal'

// No implicit cumulative time, token, turn or tool-call budget. An explicit
// tokenBudget supplied by a caller remains bound to its immutable request.
export const consumedReviewTime = (state: Pick<SingleReviewState, 'attempts'>) =>
  state.attempts.reduce((total, attempt) => total + (attempt.closed?.elapsedMs ?? 0), 0)
export const consumedReviewTokens = (state: Pick<SingleReviewState, 'attempts'>) =>
  state.attempts.reduce((total, attempt) => total + (attempt.closed?.usage.total_tokens ?? attempt.usage?.total_tokens ?? 0), 0)
