import type { IdeaIntakeAnalysisPayload } from '../services/api';

type AxiosLikeError = Error & {
  status?: number;
  originalError?: {
    response?: {
      status?: number;
      data?: unknown;
    };
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isClarificationPayload = (value: unknown): value is IdeaIntakeAnalysisPayload => {
  if (!isRecord(value)) return false;
  return (
    value.clarification_required === true &&
    isRecord(value.answered_slots) &&
    isStringArray(value.pending_slots) &&
    isStringArray(value.clarification_questions) &&
    Array.isArray(value.clarification_suggestions)
  );
};

export const extractBootstrapClarification = (error: unknown): IdeaIntakeAnalysisPayload | null => {
  if (!(error instanceof Error)) return null;
  const axiosError = error as AxiosLikeError;
  const status = axiosError.status ?? axiosError.originalError?.response?.status;
  if (status !== 409) return null;

  const data = axiosError.originalError?.response?.data;
  if (!isRecord(data) || !isRecord(data.detail)) return null;
  const detail = data.detail;
  if (!isRecord(detail.error) || detail.error.code !== 'idea_intake_clarification_required') {
    return null;
  }

  const clarification = detail.clarification;
  return isClarificationPayload(clarification) ? clarification : null;
};
