#!/usr/bin/env bash
# Copies real Storage files from Supabase Cloud to a self-hosted local-disk backend.
# Bucket definitions must already exist on the target.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
base_config="${MIGRATION_CONFIG_FILE:-$script_dir/.beegame-migration.env}"
api_config="${MIGRATION_STORAGE_API_CONFIG_FILE:-$script_dir/.beegame-storage-api.env}"

[[ -f "$base_config" && ! -L "$base_config" ]] || { printf 'Missing safe migration config: %s\n' "$base_config" >&2; exit 1; }
source "$base_config"
[[ ! -e "$api_config" || ( -f "$api_config" && ! -L "$api_config" ) ]] || { printf 'Refusing unsafe Storage API config path: %s\n' "$api_config" >&2; exit 1; }
[[ ! -f "$api_config" ]] || source "$api_config"

for variable in OLD_DB_URL TARGET_DB_HOST TARGET_DB_PORT TARGET_DB_NAME TARGET_DB_PASSWORD MIGRATION_OUTPUT_DIR; do
  [[ -n "${!variable:-}" ]] || { printf 'Missing required config value: %s\n' "$variable" >&2; exit 1; }
done
for command in sudo psql curl python3 tee mktemp; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$command" >&2; exit 1; }
done

step() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
scalar() { tr -d '[:space:]'; }
sql_literal() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}
source_psql() { sudo env "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" psql --dbname "$OLD_DB_URL" "$@"; }
target_psql() { sudo env "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" "PGPASSWORD=$TARGET_DB_PASSWORD" psql --host "$TARGET_DB_HOST" --port "$TARGET_DB_PORT" --username postgres --dbname "$TARGET_DB_NAME" "$@"; }
target_storage_psql() { sudo env "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" "PGPASSWORD=$TARGET_DB_PASSWORD" psql --host "$TARGET_DB_HOST" --port "$TARGET_DB_PORT" --username supabase_storage_admin --dbname "$TARGET_DB_NAME" "$@"; }

prompt_value() {
  local variable="$1" label="$2" secret="$3" value
  [[ -n "${!variable:-}" ]] && return
  [[ -t 0 ]] || { printf 'Missing %s. Run interactively once.\n' "$variable" >&2; exit 1; }
  if [[ "$secret" == yes ]]; then read -r -s -p "$label: " value; printf '\n'; else read -r -p "$label: " value; fi
  [[ -n "$value" ]] || { printf '%s cannot be empty.\n' "$label" >&2; exit 1; }
  printf -v "$variable" '%s' "$value"
}

storage_api_base() {
  local root="${1%/}"
  [[ "$root" == */storage/v1 ]] && printf '%s\n' "$root" || printf '%s/storage/v1\n' "$root"
}

encode_object_path() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/"))' "$1"
}

storage_request() {
  local description="$1" response_file="$2" http_code curl_exit
  shift 2
  set +e
  http_code="$(curl --silent --show-error --location --retry 3 --output "$response_file" --write-out '%{http_code}' "$@")"
  curl_exit=$?
  set -e
  if [[ "$curl_exit" -ne 0 || ! "$http_code" =~ ^2 ]]; then
    printf '%s failed: curl exit=%s, HTTP status=%s\n' "$description" "$curl_exit" "${http_code:-none}" >&2
    if [[ -s "$response_file" ]]; then
      printf 'Storage response (first 4096 bytes):\n' >&2
      head -c 4096 "$response_file" >&2
      printf '\n' >&2
    fi
    return 1
  fi
}

save_api_config() {
  local temporary_config
  umask 077
  temporary_config="$(mktemp "$script_dir/.beegame-storage-api.env.XXXXXX")"
  {
    printf 'SOURCE_STORAGE_URL=%q\n' "$SOURCE_STORAGE_URL"
    printf 'SOURCE_STORAGE_SERVICE_KEY=%q\n' "$SOURCE_STORAGE_SERVICE_KEY"
    printf 'TARGET_STORAGE_URL=%q\n' "$TARGET_STORAGE_URL"
    printf 'TARGET_STORAGE_SERVICE_KEY=%q\n' "$TARGET_STORAGE_SERVICE_KEY"
  } > "$temporary_config"
  chmod 600 "$temporary_config"
  mv "$temporary_config" "$api_config"
}

prompt_value SOURCE_STORAGE_URL 'Cloud project URL (for example https://project-ref.supabase.co)' no
prompt_value SOURCE_STORAGE_SERVICE_KEY 'Cloud service_role key' yes
# The target runs on this host; use Kong directly rather than the public domain.
TARGET_STORAGE_URL='http://127.0.0.1:8000'
prompt_value TARGET_STORAGE_SERVICE_KEY 'Self-hosted service_role key' yes
[[ "$SOURCE_STORAGE_URL" == http://* || "$SOURCE_STORAGE_URL" == https://* ]] || { printf 'Cloud URL must start with http:// or https://\n' >&2; exit 1; }
[[ "$TARGET_STORAGE_URL" == http://* || "$TARGET_STORAGE_URL" == https://* ]] || { printf 'Self-hosted URL must start with http:// or https://\n' >&2; exit 1; }
save_api_config

source_api="$(storage_api_base "$SOURCE_STORAGE_URL")"
target_api="$(storage_api_base "$TARGET_STORAGE_URL")"
mkdir -p "$MIGRATION_OUTPUT_DIR"
MIGRATION_OUTPUT_DIR="$(cd "$MIGRATION_OUTPUT_DIR" && pwd)"
log_file="$MIGRATION_OUTPUT_DIR/migrate-storage-objects-via-api.log"
object_list="$MIGRATION_OUTPUT_DIR/cloud-storage-objects.tsv"
temporary_file="$(mktemp "$MIGRATION_OUTPUT_DIR/.storage-object.XXXXXX")"
api_response="$(mktemp "$MIGRATION_OUTPUT_DIR/.storage-api-response.XXXXXX")"
trap 'rm -f "$temporary_file" "$api_response"' EXIT
exec > >(tee -a "$log_file") 2>&1

step "Log file: $log_file"
step 'Requesting sudo authorization...'
sudo -v

step 'Testing Cloud and self-hosted Storage API connections...'
curl --fail --silent --show-error --location \
  -H "Authorization: Bearer $SOURCE_STORAGE_SERVICE_KEY" -H "apikey: $SOURCE_STORAGE_SERVICE_KEY" \
  "$source_api/bucket?limit=1" >/dev/null
curl --fail --silent --show-error --location \
  -H "Authorization: Bearer $TARGET_STORAGE_SERVICE_KEY" -H "apikey: $TARGET_STORAGE_SERVICE_KEY" \
  "$target_api/bucket?limit=1" >/dev/null

source_objects="$(source_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
source_psql --no-psqlrc --tuples-only --no-align --field-separator $'\t' \
  --command "select bucket_id, name, coalesce(metadata->>'mimetype', 'application/octet-stream'), coalesce(metadata->>'cacheControl', '3600') from storage.objects order by bucket_id, name;" \
  > "$object_list"
mapfile -t buckets < <(source_psql --no-psqlrc --tuples-only --no-align --command 'select id from storage.buckets order by id;' | sed '/^[[:space:]]*$/d')
[[ "${#buckets[@]}" -gt 0 ]] || { printf 'No Cloud Storage buckets were found.\n' >&2; exit 1; }
for bucket in "${buckets[@]}"; do
  bucket_literal="$(sql_literal "$bucket")"
  exists="$(target_psql --no-psqlrc --tuples-only --no-align --command "select count(*) from storage.buckets where id = $bucket_literal;" | scalar)"
  [[ "$exists" == 1 ]] || { printf 'Target bucket is missing: %s\n' "$bucket" >&2; exit 1; }
done
[[ "$(wc -l < "$object_list" | scalar)" == "$source_objects" ]] || { printf 'Source object list count does not match source database count.\n' >&2; exit 1; }

target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
step "Cloud has ${source_objects} object(s) in ${#buckets[@]} bucket(s); target currently has ${target_objects} object metadata row(s)."
if [[ "${CONFIRM_CLEAR_TARGET_STORAGE_OBJECTS:-}" != YES ]]; then
  [[ -t 0 ]] || { printf 'Set CONFIRM_CLEAR_TARGET_STORAGE_OBJECTS=YES after confirming target object metadata may be replaced.\n' >&2; exit 1; }
  printf 'Type YES to clear target Storage object metadata and repopulate it through the Storage API: '
  read -r CONFIRM_CLEAR_TARGET_STORAGE_OBJECTS
  [[ "$CONFIRM_CLEAR_TARGET_STORAGE_OBJECTS" == YES ]] || { printf 'Migration cancelled.\n' >&2; exit 1; }
fi

external_storage_fk_count="$(target_psql --no-psqlrc --tuples-only --no-align --command "
  select count(*) from pg_constraint foreign_key
  join pg_class referenced_relation on referenced_relation.oid = foreign_key.confrelid
  join pg_namespace referenced_schema on referenced_schema.oid = referenced_relation.relnamespace
  join pg_class referencing_relation on referencing_relation.oid = foreign_key.conrelid
  join pg_namespace referencing_schema on referencing_schema.oid = referencing_relation.relnamespace
  where foreign_key.contype = 'f' and referenced_schema.nspname = 'storage' and referencing_schema.nspname <> 'storage';" | scalar)"
[[ "$external_storage_fk_count" == 0 ]] || { printf 'Refusing object reset: %s non-Storage foreign key(s) reference Storage tables.\n' "$external_storage_fk_count" >&2; exit 1; }

step 'Clearing target Storage object metadata; bucket definitions are retained...'
target_storage_psql --no-psqlrc --variable ON_ERROR_STOP=1 --command 'TRUNCATE TABLE storage.objects CASCADE;'
target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
[[ "$target_objects" == 0 ]] || { printf 'Target Storage objects were not cleared.\n' >&2; exit 1; }

index=0
while IFS=$'\t' read -r bucket object_name mime_type cache_control; do
  [[ -n "$bucket" && -n "$object_name" ]] || { printf 'Invalid source object-list row.\n' >&2; exit 1; }
  index=$((index + 1))
  encoded_path="$(encode_object_path "$object_name")"
  step "[$index/$source_objects] Copying $bucket/$object_name"
  storage_request 'Cloud object download' "$temporary_file" \
    -H "Authorization: Bearer $SOURCE_STORAGE_SERVICE_KEY" -H "apikey: $SOURCE_STORAGE_SERVICE_KEY" \
    "$source_api/object/$bucket/$encoded_path"
  storage_request 'Self-hosted object upload' "$api_response" \
    -X POST -H "Authorization: Bearer $TARGET_STORAGE_SERVICE_KEY" -H "apikey: $TARGET_STORAGE_SERVICE_KEY" \
    -H 'x-upsert: true' -H "content-type: $mime_type" -H "cache-control: $cache_control" \
    --data-binary "@$temporary_file" "$target_api/object/$bucket/$encoded_path"
done < "$object_list"

target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
[[ "$source_objects" == "$target_objects" ]] || { printf 'Storage object count mismatch: source=%s target=%s\n' "$source_objects" "$target_objects" >&2; exit 1; }
step 'Storage object copy verification passed.'
printf 'Copied %s object(s) across %s bucket(s).\n' "$target_objects" "${#buckets[@]}"
printf 'Object manifest: %s\n' "$object_list"
printf 'Saved API config: %s\n' "$api_config"
