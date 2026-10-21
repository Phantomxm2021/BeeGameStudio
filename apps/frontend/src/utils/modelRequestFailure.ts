/** Only newly observed terminal failures may auto-resume once. Other failed
 * turns still offer manual continuation, independent of their error wording.
 * A chat/SSE disconnect alone never establishes that the server worker stopped. */
export function canAutomaticallyRetryModelFailure(text: string): boolean {
  // Partial output/unknown usage needs an explicit decision; configuration,
  // authorization and cancellation errors need their cause corrected first.
  if (/stream (?:disconnected|ended|closed|failed)|(?:response|reply).{0,30}(?:incomplete|unfinished)|final token usage|usage_not_included|\bOpenCode Go:|cancel(?:led|ed)|aborted|interrupted|permission denied|access denied|unauthori[sz]ed|forbidden|invalid (?:request|argument|parameter)|insufficient_quota|credit_balance_exhausted|spend_limit_exceeded|model_coming_soon|CERT_|CERTIFICATE_|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|(?:HTTP\s+|status\D{0,10}|API Error:\s*)(?:400|401|403|404|422)\b/i.test(text)) return false
  return /model.{0,30}(?:at capacity|overloaded)|server.{0,20}overloaded|overloaded_error|rate_limit_(?:error|exceeded)|Connection error\.|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_(?:SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|request timed out|network error|provider transport failed|(?:HTTP\s+|(?:unexpected )?status\D{0,10}|API Error:\s*)(?:408|425|429|500|502|503|504)\b/i.test(text)
}
