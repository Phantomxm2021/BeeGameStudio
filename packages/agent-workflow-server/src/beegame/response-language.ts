/** Presentation preference only: no tool restrictions or workflow decisions. */
export function responseLanguageInstruction(language?: string): string {
  if (!language) return ''
  return `User response language: ${language}. This is the current user's preference and supersedes earlier response-language preferences. Use it for all user-visible prose, including thinking/reasoning summaries, progress updates, tool explanations, and final responses. Preserve code, identifiers, enum values, paths, and quoted source text; do not translate those.`
}
