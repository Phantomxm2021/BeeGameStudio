/** Native model request failures only; a chat transport disconnect may still
 * have a live server worker and must never start another turn. */
export function isModelRequestFailure(text: string): boolean {
  return /(?:^API Error:|model.{0,30}(?:at capacity|overloaded)|overloaded_error|rate_limit_error|model_coming_soon|OpenAI stream (?:ended|closed)|Connection error\.|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|request timed out|network error)/i.test(text)
}
