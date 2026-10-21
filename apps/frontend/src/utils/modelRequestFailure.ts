/** Native model request failures only; a chat transport disconnect may still
 * have a live server worker and must never start another turn. */
export function isModelRequestFailure(text: string): boolean {
  return /(?:^API Error:|model.{0,30}(?:at capacity|overloaded)|overloaded_error|rate_limit_error|model_coming_soon|OpenAI stream (?:ended|closed)|Connection error\.|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|request timed out|network error)/i.test(text)
}

/** An incomplete response may contain partial work; replay requires an explicit action. */
export function canAutomaticallyRetryModelFailure(text: string): boolean {
  return isModelRequestFailure(text) && !/OpenAI stream ended before (?:a terminal finish_reason|message_stop)|\bOpenCode Go:/i.test(text)
}
