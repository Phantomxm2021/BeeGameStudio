#!/usr/bin/env bash
set -euo pipefail

if [ -d /opt/beegame/default-config/skills ] && [ ! -d "${BEEGAME_CONFIG_DIR:-/home/bun/.beegame}/skills" ]; then
  mkdir -p "${BEEGAME_CONFIG_DIR:-/home/bun/.beegame}"
  cp -R /opt/beegame/default-config/skills "${BEEGAME_CONFIG_DIR:-/home/bun/.beegame}/skills"
fi

exec "$@"
