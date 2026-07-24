#!/usr/bin/env bash
set -euo pipefail

runtime_user="${BEEGAME_RUNTIME_USER:-bun}"
runtime_group="${BEEGAME_RUNTIME_GROUP:-bun}"
workspace_dir="${AGENT_WORKFLOW_WORKSPACE_PATH:-${BEEGAME_WORKSPACE_ROOT:-/srv/beegame/projects}}"
config_dir="${BEEGAME_CONFIG_DIR:-/home/bun/.beegame}"
builtin_skills_dir="${BEEGAME_BUILTIN_SKILLS_DIR:-/opt/beegame/default-config/skills/builtinskills}"

mkdir -p "$workspace_dir" "$config_dir"

if [ ! -d "$builtin_skills_dir" ]; then
  echo "BeeGame built-in skills directory is unavailable: $builtin_skills_dir" >&2
  exit 78
fi

if [ "$(id -u)" = "0" ]; then
  chown -R "$runtime_user:$runtime_group" "$workspace_dir" "$config_dir"
  exec su-exec "$runtime_user:$runtime_group" "$@"
fi

exec "$@"
