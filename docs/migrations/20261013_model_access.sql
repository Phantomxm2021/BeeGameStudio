-- Additive: existing models retain platform credentials and visibility.
-- Apply before deploying the model-connections feature. No credentials are copied.
-- Deploy the API/frontend and rebuild the native CLI together: BGS subscription
-- isolation requires the new CLI credential-store selection and no-host-fallback.
-- Personal connections use the existing per-user runtime host data directory;
-- they are not shared across machines. BYOK is encrypted with the configured
-- BEEGAME_CONFIG_ENCRYPTION_KEY. OAuth uses CLI-compatible 0600 credential files.
-- This migration does not alter vendor authorization or BGS billing rules.
ALTER TABLE public.beegame_model_configs
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auth_methods jsonb NOT NULL DEFAULT '["platform"]'::jsonb;
