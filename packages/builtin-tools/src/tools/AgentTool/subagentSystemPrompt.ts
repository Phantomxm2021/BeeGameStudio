import { asSystemPrompt, type SystemPrompt } from 'src/utils/systemPromptType.js'

/** Fresh delegates inherit appended user/platform constraints, not parent reasoning.
 * Exact-context forks/summarizers already carry their rendered prompt unchanged. */
export function subagentSystemPrompt(prompt: SystemPrompt, appended: string | undefined, exactContext = false): SystemPrompt {
  return !exactContext && appended && !prompt.includes(appended)
    ? asSystemPrompt([...prompt, appended]) : prompt
}
