/**
 * Task ID formatting utilities for the XRMOD Demiurge frontend.
 */

/**
 * Replaces the 'wp_' prefix with 'Task_' in a task ID.
 * @param id The task ID to format (e.g., 'wp_1')
 * @returns The formatted task ID (e.g., 'Task_1')
 */
export function formatTaskId(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/^wp_/, 'Task_');
}

/**
 * Replaces all occurrences of 'wp_xx' with 'Task_xx' in a text string.
 * @param content The text content containing potential 'wp_' references
 * @returns The text with 'wp_' replaced by 'Task_'
 */
export function formatMessageContent(content: string | null | undefined): string {
  if (!content) return '';
  
  // Regex to find wp_ followed by numbers, or word boundaries
  // This handles cases like "wp_1", "wp_12", etc.
  return content.replace(/\bwp_(\d+)\b/g, 'Task_$1');
}
