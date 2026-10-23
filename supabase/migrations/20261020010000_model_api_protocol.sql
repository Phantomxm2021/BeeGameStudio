-- Keep the API wire protocol explicit. NULL preserves the pre-Codex provider defaults.
-- Apply before deploying a backend that writes api_protocol.
alter table public.beegame_model_configs
  add column if not exists api_protocol text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.beegame_model_configs'::regclass
      and conname = 'beegame_model_configs_api_protocol_check'
  ) then
    alter table public.beegame_model_configs
      add constraint beegame_model_configs_api_protocol_check
      check (api_protocol is null or api_protocol in ('responses', 'chat-completions', 'anthropic-messages', 'gemini'));
  end if;
end
$$;

-- Preserve the existing invoker/RLS/owner checks while returning the Codex runtime contract.
create or replace function public.beegame_runtime_env(
  p_user_id uuid,
  p_data_dir text default null,
  p_model_config_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  model_row public.beegame_model_configs%rowtype;
  settings_row public.beegame_runtime_settings%rowtype;
  platform_settings jsonb := '{}'::jsonb;
  model_env jsonb := '{}'::jsonb;
  settings_env jsonb := '{}'::jsonb;
  runtime_env jsonb := '{}'::jsonb;
  base_config_dir text;
  runtime_root_dir text;
  config_owner_id uuid;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  config_owner_id := public.beegame_model_config_owner_id(p_user_id);

  base_config_dir := trim(trailing '/' from coalesce(p_data_dir, ''));
  if base_config_dir <> '' then
    runtime_root_dir := base_config_dir || '/.runtime';
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_CONFIG_DIR', runtime_root_dir || '/app'
    );
  end if;

  select *
  into model_row
  from public.beegame_model_configs
  where owner_id = config_owner_id
    and (
      (p_model_config_id is not null and id = p_model_config_id) or
      (p_model_config_id is null and is_default = true)
    )
  order by is_default desc, updated_at desc
  limit 1;

  if found then
    case model_row.provider
      when 'anthropic-compatible' then
        model_env := jsonb_build_object(
          'BEEGAME_MODEL_TYPE', 'anthropic',
          'BEEGAME_API_PROTOCOL', coalesce(model_row.api_protocol, 'anthropic-messages'),
          'ANTHROPIC_BASE_URL', coalesce(nullif(model_row.base_url, ''), 'https://api.anthropic.com'),
          'ANTHROPIC_API_KEY', model_row.api_key_ciphertext
        );
      when 'openai-compatible' then
        model_env := jsonb_build_object(
          'BEEGAME_MODEL_TYPE', 'openai',
          'BEEGAME_API_PROTOCOL', coalesce(model_row.api_protocol, 'chat-completions'),
          'OPENAI_BASE_URL', coalesce(nullif(model_row.base_url, ''), 'https://api.openai.com/v1'),
          'OPENAI_API_KEY', model_row.api_key_ciphertext
        );
      when 'gemini' then
        model_env := jsonb_build_object(
          'BEEGAME_MODEL_TYPE', 'gemini',
          'BEEGAME_API_PROTOCOL', coalesce(model_row.api_protocol, 'gemini'),
          'GEMINI_BASE_URL', coalesce(nullif(model_row.base_url, ''), 'https://generativelanguage.googleapis.com/v1beta'),
          'GEMINI_API_KEY', model_row.api_key_ciphertext
        );
      when 'grok' then
        model_env := jsonb_build_object(
          'BEEGAME_MODEL_TYPE', 'grok',
          'BEEGAME_API_PROTOCOL', coalesce(model_row.api_protocol, 'chat-completions'),
          'GROK_BASE_URL', coalesce(nullif(model_row.base_url, ''), 'https://api.x.ai/v1'),
          'GROK_API_KEY', model_row.api_key_ciphertext
        );
      else
        raise exception 'Unsupported model provider';
    end case;
    model_env := model_env || jsonb_build_object(
      'BEEGAME_MODEL', model_row.models->>'balanced',
      'BGS_DEFAULT_FAST_MODEL', model_row.models->>'fast',
      'BGS_DEFAULT_BALANCED_MODEL', model_row.models->>'balanced',
      'BGS_DEFAULT_STRONG_MODEL', model_row.models->>'strong'
    );
  end if;

  select coalesce(config, '{}'::jsonb)
  into platform_settings
  from public.beegame_platform_settings
  where key = 'runtime_settings'
  limit 1;

  if platform_settings = '{}'::jsonb then
    select *
    into settings_row
    from public.beegame_runtime_settings
    where owner_id = config_owner_id
    limit 1;

    if found then
      platform_settings := coalesce(settings_row.settings, '{}'::jsonb);
    end if;
  end if;

  if platform_settings <> '{}'::jsonb then
    settings_env := settings_env || jsonb_build_object(
      'BEEGAME_RUNTIME_SETTINGS_JSON',
      platform_settings::text
    );

  end if;

  return jsonb_strip_nulls(runtime_env || model_env || settings_env);
end
$$;

