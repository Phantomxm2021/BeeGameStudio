# Direct Claude Layer Test Environment

## Purpose

Provide one secret local environment file for reproducing model behavior without BeeGame workflow, Supabase runtime lookup, document validation, or persistence. Anthropic and OpenAI-compatible settings are isolated so a model or endpoint configured for one protocol can never be reused implicitly by the other protocol's test.

## Files

- `.env.direct-claude-test`: ignored local secrets filled by the operator.
- `.env.direct-claude-test.example`: committed field template with no credentials.

## Contract

The existing `DIRECT_PROVIDER`, `DIRECT_BASE_URL`, `DIRECT_API_KEY`, `DIRECT_FAST_MODEL`, `DIRECT_BALANCED_MODEL`, and `DIRECT_STRONG_MODEL` fields are the Anthropic test configuration. The OpenAI-compatible test configuration uses the separate `DIRECT_OPENAI_BASE_URL`, `DIRECT_OPENAI_API_KEY`, `DIRECT_OPENAI_FAST_MODEL`, `DIRECT_OPENAI_BALANCED_MODEL`, and `DIRECT_OPENAI_STRONG_MODEL` fields. `DIRECT_STREAM_IDLE_TIMEOUT_MS` is shared timing policy only. Test runners must fail when the selected protocol's required values are absent, must never fall back across protocols, and must never print either API key.

## Verification

Run the same neutral request at three isolated boundaries: provider HTTP, Claude CLI, and BeeGame. Each comparison must record which protocol-specific configuration set was selected, terminal event presence, elapsed time, and failure layer. Test prompts are fixtures only and must never enter product logic.
