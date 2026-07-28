-- Realtime usage can exceed PostgreSQL int4 during a single long-running
-- generation, especially when cached input tokens are included. Existing
-- installations created before the realtime billing schema used int4 for
-- some of these columns, so CREATE TABLE IF NOT EXISTS does not upgrade them.

alter table if exists public.beegame_shadow_usage_events
  alter column prompt_tokens type bigint using prompt_tokens::bigint,
  alter column completion_tokens type bigint using completion_tokens::bigint,
  alter column cache_read_tokens type bigint using cache_read_tokens::bigint,
  alter column cache_creation_tokens type bigint using cache_creation_tokens::bigint,
  alter column total_tokens type bigint using total_tokens::bigint,
  alter column prompt_tokens_delta type bigint using prompt_tokens_delta::bigint,
  alter column completion_tokens_delta type bigint using completion_tokens_delta::bigint,
  alter column cache_read_tokens_delta type bigint using cache_read_tokens_delta::bigint,
  alter column cache_creation_tokens_delta type bigint using cache_creation_tokens_delta::bigint,
  alter column total_tokens_delta type bigint using total_tokens_delta::bigint,
  alter column weighted_tokens type bigint using weighted_tokens::bigint,
  alter column weighted_tokens_delta type bigint using weighted_tokens_delta::bigint,
  alter column shadow_credits_micro type bigint using shadow_credits_micro::bigint;

alter table if exists public.beegame_usage_wallets
  alter column included_credits_micro type bigint using included_credits_micro::bigint,
  alter column consumed_credits_micro type bigint using consumed_credits_micro::bigint;

alter table if exists public.beegame_usage_debit_events
  alter column amount_credits_micro type bigint using amount_credits_micro::bigint;
