# Task 3 Secret Crypto Design

## Goal

Protect persisted model, MCP, and service secrets with a versioned AES-256-GCM envelope while preserving legacy migration, update semantics, and public redaction.

## Architecture

`packages/agent-workflow-server/src/security/secret-crypto.ts` owns key loading, envelope encoding/decoding, AAD validation, and explicit local plaintext compatibility. Store modules call it only at persistence boundaries. Versioned ciphertext is recognized by its envelope shape; legacy plaintext is decrypted as-is and rewritten on the next save.

The envelope is exactly `v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>`, with a random 12-byte IV and record type as AES-GCM AAD. Production requires `BEEGAME_CONFIG_ENCRYPTION_KEY` to decode to exactly 32 bytes. Local plaintext compatibility requires `BEEGAME_ALLOW_PLAINTEXT_SECRETS=1` and is never allowed in production.

## Data flow and contracts

- Model API keys are encrypted in local JSON and Supabase model-config writes; reads decrypt only for internal persistence/runtime use, while public model DTOs expose previews.
- MCP environment values are encrypted in local JSON and Supabase service/MCP writes; public MCP DTOs expose only previews.
- Omitted update fields preserve stored values. Explicit empty secret values clear the stored value.
- Legacy plaintext is accepted for reads and migration, then rewritten encrypted when a store is saved. Repeated migration does not create additional changes.
- Existing Supabase column names and API shapes remain unchanged; the stored value changes from plaintext to the envelope.

## Testing

Focused tests cover round-trip and exact format, AAD/tamper/unknown-version rejection, key configuration and local plaintext policy, legacy migration/idempotence, omitted-vs-clear updates, and public DTO redaction.
