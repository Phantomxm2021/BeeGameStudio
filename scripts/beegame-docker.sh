#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${BEEGAME_DOCKER_COMPOSE_FILE:-$ROOT_DIR/docker/docker-compose.yml}"
ENV_FILE="${BEEGAME_DOCKER_ENV_FILE:-$ROOT_DIR/docker/.env.production}"

command="${1:-up}"
if [ "$#" -gt 0 ]; then
  shift
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found" >&2
  exit 127
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  echo "Create it with: cp docker/.env.production.example docker/.env.production" >&2
  exit 1
fi

case "$command" in
  up)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build "$@"
    ;;
  down)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down "$@"
    ;;
  restart)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart "$@"
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f "$@"
    ;;
  ps|status)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps "$@"
    ;;
  config)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config "$@"
    ;;
  *)
    echo "Usage: $0 [up|down|restart|logs|ps|status|config] [docker compose args...]" >&2
    exit 2
    ;;
esac
