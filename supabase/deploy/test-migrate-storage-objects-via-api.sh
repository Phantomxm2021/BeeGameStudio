#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/migrate-storage-objects-via-api.sh"

[[ -x "$script" ]] || { echo 'missing executable Storage API migration script'; exit 1; }
grep -Fq 'TRUNCATE TABLE storage.objects CASCADE;' "$script"
grep -Fq '/storage/v1/object/' "$script"
grep -Fq 'Storage object count mismatch' "$script"
echo 'Storage API migration script contract passed.'
