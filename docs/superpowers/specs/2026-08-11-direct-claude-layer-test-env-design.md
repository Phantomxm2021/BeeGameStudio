# Direct Claude Layer Test Environment

## Purpose

Provide one secret local environment file for reproducing model behavior without BeeGame workflow, Supabase runtime lookup, document validation, or persistence. The same explicit values will be used for provider HTTP and Claude CLI comparisons.

## Files

- `.env.direct-claude-test`: ignored local secrets filled by the operator.
- `.env.direct-claude-test.example`: committed field template with no credentials.

## Contract

The files contain only `DIRECT_PROVIDER`, `DIRECT_BASE_URL`, `DIRECT_API_KEY`, `DIRECT_FAST_MODEL`, `DIRECT_BALANCED_MODEL`, `DIRECT_STRONG_MODEL`, and `DIRECT_STREAM_IDLE_TIMEOUT_MS`. Test runners must fail when required values are absent and must never print the API key.

## Verification

Run the same neutral request at three isolated boundaries: provider HTTP, Claude CLI, and BeeGame. Record terminal event presence, elapsed time, and failure layer. Test prompts are fixtures only and must never enter product logic.
