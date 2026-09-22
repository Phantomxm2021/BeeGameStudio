export class UserQuestionValidationError extends Error {}

/** Keep Claude's original questions intact; the UI supplies only user answers. */
export function answeredQuestionInput(
  toolName: string,
  input: Record<string, unknown>,
  answers: unknown,
): Record<string, unknown> {
  if (toolName !== 'AskUserQuestion')
    throw new UserQuestionValidationError('Answers are only supported for AskUserQuestion')
  const questions = input.questions
  if (!Array.isArray(questions) || !questions.length ||
      questions.some(q => !q || typeof q.question !== 'string' || !q.question.trim()))
    throw new UserQuestionValidationError('Invalid AskUserQuestion questions')
  const names = questions.map(q => q.question as string)
  if (new Set(names).size !== names.length)
    throw new UserQuestionValidationError('AskUserQuestion question text must be unique')
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    throw new UserQuestionValidationError('Answer every question before submitting')
  const entries = Object.entries(answers)
  if (entries.length !== names.length ||
      entries.some(([key, value]) => !names.includes(key) || typeof value !== 'string' || !value.trim()))
    throw new UserQuestionValidationError('Answer every question before submitting')
  return { ...input, answers: Object.fromEntries(entries) }
}
