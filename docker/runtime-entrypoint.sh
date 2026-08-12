#!/usr/bin/env bash
set -euo pipefail

runtime_user="${BEEGAME_RUNTIME_USER:-bun}"
runtime_group="${BEEGAME_RUNTIME_GROUP:-bun}"
workspace_dir="${AGENT_WORKFLOW_WORKSPACE_PATH:?AGENT_WORKFLOW_WORKSPACE_PATH is required}"
config_dir="${BEEGAME_CONFIG_DIR:-/home/bun/.beegame}"

mkdir -p "$workspace_dir" "$config_dir"

if [ "$(id -u)" = "0" ]; then
  chown -R "$runtime_user:$runtime_group" "$workspace_dir" "$config_dir"
  exec su-exec "$runtime_user:$runtime_group" "$@"
fi

exec "$@"
