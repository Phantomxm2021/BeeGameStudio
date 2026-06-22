export interface BootstrapPayload {
  idea: string
  title?: string
  root_path?: string
  clarification?: Record<string, string>
  language?: string
}

export function buildBootstrapPayload(
  rawIdea: string,
  clarification?: Record<string, string>,
  language?: string,
): BootstrapPayload {
  const trimmed = rawIdea.trim()
  if (!trimmed) {
    return { idea: '' }
  }

  return {
    idea: trimmed,
    ...(clarification ? { clarification } : {}),
    ...(language ? { language } : {}),
  }
}
