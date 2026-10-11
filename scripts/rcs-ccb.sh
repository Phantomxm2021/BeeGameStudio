#!/usr/bin/env bash
set -euo pipefail
: "${ACP_RCS_URL:?Set ACP_RCS_URL to your Bee Game Studio remote-control server}"
: "${ACP_RCS_TOKEN:?Set ACP_RCS_TOKEN to its access token}"
exec acp-link bee-game-studio-bun -- --acp
