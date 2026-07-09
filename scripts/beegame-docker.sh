#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${BEEGAME_DOCKER_COMPOSE_FILE:-$ROOT_DIR/docker/docker-compose.yml}"
ENV_FILE="${BEEGAME_DOCKER_ENV_FILE:-$ROOT_DIR/docker/.env.production}"
BILLING_ENV_FILE="${BEEGAME_BILLING_ENV_FILE:-$ROOT_DIR/docker/.env.billing}"
ENV_EXAMPLE_FILE="$ROOT_DIR/docker/.env.production.example"
BILLING_ENV_EXAMPLE_FILE="$ROOT_DIR/docker/.env.billing.example"

command="${1:-up}"
if [ "$#" -gt 0 ]; then
  shift
fi

read_env_value() {
  key="$1"
  file="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  sed -n "s/^$key=//p" "$file" | tail -n 1
}

is_unset_or_placeholder() {
  value="$1"
  case "$value" in
    ""|replace-with-*|your-*|sk_live_...|whsec_...)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  if command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi
  echo "Unable to generate a random token; install openssl or od" >&2
  exit 1
}

set_env_value() {
  key="$1"
  value="$2"
  file="$3"
  temp_file="$file.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) print key "=" value
    }
  ' "$file" > "$temp_file"
  mv "$temp_file" "$file"
}

ensure_env_files() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE" >&2
    echo "Create it with: $0 init" >&2
    exit 1
  fi
  if [ ! -f "$BILLING_ENV_FILE" ]; then
    echo "Missing $BILLING_ENV_FILE" >&2
    echo "Create it with: $0 init" >&2
    exit 1
  fi
}

validate_env_files() {
  ensure_env_files

  skills_token="$(read_env_value BEEGAME_SKILLS_SERVICE_TOKEN "$ENV_FILE")"
  if is_unset_or_placeholder "$skills_token"; then
    echo "BEEGAME_SKILLS_SERVICE_TOKEN is not configured in $ENV_FILE" >&2
    echo "Run $0 init, or set it to a high-entropy shared runtime/skills token." >&2
    exit 1
  fi

  runtime_credit_token="$(read_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$ENV_FILE")"
  billing_credit_token="$(read_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$BILLING_ENV_FILE")"
  if is_unset_or_placeholder "$runtime_credit_token"; then
    echo "BEEGAME_CREDIT_CONTROL_TOKEN is not configured in $ENV_FILE" >&2
    echo "Run $0 init, or set the same high-entropy value in both Docker env files." >&2
    exit 1
  fi
  if is_unset_or_placeholder "$billing_credit_token"; then
    echo "BEEGAME_CREDIT_CONTROL_TOKEN is not configured in $BILLING_ENV_FILE" >&2
    echo "Run $0 init, or set the same high-entropy value in both Docker env files." >&2
    exit 1
  fi
  if [ "$runtime_credit_token" != "$billing_credit_token" ]; then
    echo "BEEGAME_CREDIT_CONTROL_TOKEN must match in:" >&2
    echo "  $ENV_FILE" >&2
    echo "  $BILLING_ENV_FILE" >&2
    exit 1
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker command not found" >&2
    exit 127
  fi
}

init_env_files() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
    echo "Created $ENV_FILE"
  else
    echo "Exists  $ENV_FILE"
  fi

  if [ ! -f "$BILLING_ENV_FILE" ]; then
    cp "$BILLING_ENV_EXAMPLE_FILE" "$BILLING_ENV_FILE"
    echo "Created $BILLING_ENV_FILE"
  else
    echo "Exists  $BILLING_ENV_FILE"
  fi

  skills_token="$(read_env_value BEEGAME_SKILLS_SERVICE_TOKEN "$ENV_FILE")"
  if is_unset_or_placeholder "$skills_token"; then
    skills_token="$(generate_secret)"
    set_env_value BEEGAME_SKILLS_SERVICE_TOKEN "$skills_token" "$ENV_FILE"
    echo "Generated BEEGAME_SKILLS_SERVICE_TOKEN in $ENV_FILE"
  fi

  runtime_credit_token="$(read_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$ENV_FILE")"
  billing_credit_token="$(read_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$BILLING_ENV_FILE")"
  if is_unset_or_placeholder "$runtime_credit_token" && is_unset_or_placeholder "$billing_credit_token"; then
    credit_token="$(generate_secret)"
    set_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$credit_token" "$ENV_FILE"
    set_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$credit_token" "$BILLING_ENV_FILE"
    echo "Generated matching BEEGAME_CREDIT_CONTROL_TOKEN values"
  elif is_unset_or_placeholder "$runtime_credit_token"; then
    set_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$billing_credit_token" "$ENV_FILE"
    echo "Copied BEEGAME_CREDIT_CONTROL_TOKEN into $ENV_FILE"
  elif is_unset_or_placeholder "$billing_credit_token"; then
    set_env_value BEEGAME_CREDIT_CONTROL_TOKEN "$runtime_credit_token" "$BILLING_ENV_FILE"
    echo "Copied BEEGAME_CREDIT_CONTROL_TOKEN into $BILLING_ENV_FILE"
  elif [ "$runtime_credit_token" != "$billing_credit_token" ]; then
    echo "BEEGAME_CREDIT_CONTROL_TOKEN differs between Docker env files; leaving existing values unchanged." >&2
    echo "Set the same value in $ENV_FILE and $BILLING_ENV_FILE before starting." >&2
    exit 1
  fi

  echo "Docker env files are ready. Fill Supabase/Stripe/public URL placeholders before running $0 up."
}

case "$command" in
  init)
    init_env_files "$@"
    ;;
  up)
    require_docker
    validate_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build "$@"
    ;;
  down)
    require_docker
    ensure_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down "$@"
    ;;
  restart)
    require_docker
    validate_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart "$@"
    ;;
  logs)
    require_docker
    ensure_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f "$@"
    ;;
  ps|status)
    require_docker
    ensure_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps "$@"
    ;;
  config)
    require_docker
    validate_env_files
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config "$@"
    ;;
  *)
    echo "Usage: $0 [init|up|down|restart|logs|ps|status|config] [docker compose args...]" >&2
    exit 2
    ;;
esac
