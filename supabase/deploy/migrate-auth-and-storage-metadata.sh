#!/usr/bin/env bash
# Migrates Auth records and Storage DATABASE metadata after the public stage.
# It does not copy the real files stored in Storage buckets.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_file="${MIGRATION_CONFIG_FILE:-$script_dir/.beegame-migration.env}"

[[ -f "$config_file" && ! -L "$config_file" ]] || {
  printf 'Missing safe migration config: %s\nRun migrate-old-public-to-new.sh first.\n' "$config_file" >&2
  exit 1
}
source "$config_file"

for variable in OLD_DB_URL TARGET_DB_HOST TARGET_DB_PORT TARGET_DB_USER TARGET_DB_NAME TARGET_DB_PASSWORD MIGRATION_OUTPUT_DIR; do
  [[ -n "${!variable:-}" ]] || {
    printf 'Missing required config value: %s\n' "$variable" >&2
    exit 1
  }
done

for command in sudo docker psql tee mktemp; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  }
done

step() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

run_with_progress() {
  local description="$1"
  shift
  local pid monitor result_code
  step "$description"
  "$@" &
  pid=$!
  (
    while sleep 15; do
      kill -0 "$pid" 2>/dev/null || exit 0
      step "$description — still running"
    done
  ) &
  monitor=$!
  set +e
  wait "$pid"
  result_code=$?
  set -e
  kill "$monitor" 2>/dev/null || true
  wait "$monitor" 2>/dev/null || true
  [[ "$result_code" -eq 0 ]] || {
    step "$description — FAILED (exit $result_code)"
    return "$result_code"
  }
  step "$description — completed"
}

source_psql() {
  sudo env "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" psql --dbname "$OLD_DB_URL" "$@"
}

dump_source_metadata() {
  sudo docker run --rm \
    --network host \
    --volume "$MIGRATION_OUTPUT_DIR:/backup" \
    "${PG_DUMP_IMAGE:-postgres:17}" \
    pg_dump \
      --dbname "$OLD_DB_URL" \
      --data-only \
      --schema auth \
      --schema storage \
      --exclude-table-data=auth.schema_migrations \
      --exclude-table-data=storage.schema_migrations \
      --exclude-table-data=storage.migrations \
      --exclude-table-data='storage.*vector*' \
      --no-owner \
      --no-privileges \
      --file "/backup/$metadata_file_name"
}

target_psql() {
  sudo env \
    "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" \
    "PGPASSWORD=$TARGET_DB_PASSWORD" \
    psql \
      --host "$TARGET_DB_HOST" \
      --port "$TARGET_DB_PORT" \
      --username "$TARGET_DB_USER" \
      --dbname "$TARGET_DB_NAME" \
      "$@"
}

# Supabase owns these schemas through their service roles.  The postgres role can
# import metadata, but cannot ALTER every managed Auth/Storage table.
target_auth_psql() {
  sudo env \
    "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" \
    "PGPASSWORD=$TARGET_DB_PASSWORD" \
    psql \
      --host "$TARGET_DB_HOST" \
      --port "$TARGET_DB_PORT" \
      --username supabase_auth_admin \
      --dbname "$TARGET_DB_NAME" \
      "$@"
}

target_storage_psql() {
  sudo env \
    "PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}" \
    "PGPASSWORD=$TARGET_DB_PASSWORD" \
    psql \
      --host "$TARGET_DB_HOST" \
      --port "$TARGET_DB_PORT" \
      --username supabase_storage_admin \
      --dbname "$TARGET_DB_NAME" \
      "$@"
}

scalar() {
  tr -d '[:space:]'
}

mkdir -p "$MIGRATION_OUTPUT_DIR"
MIGRATION_OUTPUT_DIR="$(cd "$MIGRATION_OUTPUT_DIR" && pwd)"
log_file="$MIGRATION_OUTPUT_DIR/migrate-auth-and-storage-metadata.log"
metadata_sql="$MIGRATION_OUTPUT_DIR/old-server-auth-storage-data.sql"
metadata_file_name="$(basename "$metadata_sql")"
auth_compatibility_sql="$MIGRATION_OUTPUT_DIR/old-server-auth-compatibility.sql"
storage_compatibility_sql="$MIGRATION_OUTPUT_DIR/old-server-storage-compatibility.sql"
bucket_manifest="$MIGRATION_OUTPUT_DIR/old-server-storage-buckets.tsv"
exec > >(tee -a "$log_file") 2>&1

step "Log file: $log_file"
step 'Requesting sudo authorization...'
sudo -v

source_users="$(source_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from auth.users;' | scalar)"
source_objects="$(source_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
source_buckets="$(source_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.buckets;' | scalar)"
target_users="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from auth.users;' | scalar)"
target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
target_buckets="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.buckets;' | scalar)"

step "Source has ${source_users} Auth users, ${source_buckets} Storage buckets, and ${source_objects} Storage object metadata rows."
step "Target has ${target_users} Auth users, ${target_buckets} Storage buckets, and ${target_objects} Storage object metadata rows."

if [[ ( "$target_buckets" != "0" || "$target_objects" != "0" ) && "${RESET_TARGET_STORAGE_BUCKETS:-}" == "YES" ]]; then
  step 'Removing target Storage bucket/object migration artifacts (RESET_TARGET_STORAGE_BUCKETS=YES)...'
  external_storage_fk_count="$(target_psql --no-psqlrc --tuples-only --no-align --command "
    select count(*)
    from pg_constraint foreign_key
    join pg_class referenced_relation on referenced_relation.oid = foreign_key.confrelid
    join pg_namespace referenced_schema on referenced_schema.oid = referenced_relation.relnamespace
    join pg_class referencing_relation on referencing_relation.oid = foreign_key.conrelid
    join pg_namespace referencing_schema on referencing_schema.oid = referencing_relation.relnamespace
    where foreign_key.contype = 'f'
      and referenced_schema.nspname = 'storage'
      and referencing_schema.nspname <> 'storage';" | scalar)"
  [[ "$external_storage_fk_count" == "0" ]] || {
    printf 'Refusing Storage reset: %s foreign key(s) outside the storage schema reference Storage tables.\n' "$external_storage_fk_count" >&2
    exit 1
  }
  target_storage_psql --no-psqlrc --variable ON_ERROR_STOP=1 \
    --command 'TRUNCATE TABLE storage.buckets CASCADE;'
  target_buckets="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.buckets;' | scalar)"
  target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
  step "Target Storage now has ${target_buckets} buckets and ${target_objects} object metadata rows."
fi

if [[ "$target_users" != "0" || "$target_objects" != "0" || "$target_buckets" != "0" ]]; then
  printf 'Refusing to overwrite non-empty target Auth or Storage metadata.\n' >&2
  if [[ "$target_buckets" != "0" ]]; then
    printf 'The target has %s Storage bucket(s), including a bucket that conflicts with the old data export.\n' "$target_buckets" >&2
    printf 'If they are only migration artifacts, rerun with RESET_TARGET_STORAGE_BUCKETS=YES.\n' >&2
  fi
  exit 1
fi

if [[ "${CONFIRM_AUTH_AND_STORAGE_TARGET_EMPTY:-}" != "YES" ]]; then
  if [[ ! -t 0 ]]; then
    printf 'Set CONFIRM_AUTH_AND_STORAGE_TARGET_EMPTY=YES after confirming the target Auth and Storage metadata are empty.\n' >&2
    exit 1
  fi
  printf 'Type YES to import Auth users and Storage metadata into the empty target: '
  read -r CONFIRM_AUTH_AND_STORAGE_TARGET_EMPTY
  [[ "$CONFIRM_AUTH_AND_STORAGE_TARGET_EMPTY" == "YES" ]] || {
    printf 'Migration cancelled.\n' >&2
    exit 1
  }
fi

generate_compatibility_sql() {
  local schema_name="$1"
  local output_file="$2"
  source_psql --no-psqlrc --tuples-only --no-align --command "
  select format(
    'alter table %I.%I add column if not exists %I %s%s%s;',
    namespace.nspname,
    relation.relname,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    case when default_value.oid is null then '' else ' default ' || pg_get_expr(default_value.adbin, default_value.adrelid) end,
    case when attribute.attnotnull then ' not null' else '' end
  )
  from pg_attribute attribute
  join pg_class relation on relation.oid = attribute.attrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  left join pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where namespace.nspname = '${schema_name}'
    and relation.relkind in ('r', 'p')
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and relation.relname not like '%vector%'
  order by namespace.nspname, relation.relname, attribute.attnum;" \
    > "$output_file"
}

step 'Generating additive Auth/Storage column compatibility SQL from the old database...'
generate_compatibility_sql auth "$auth_compatibility_sql"
generate_compatibility_sql storage "$storage_compatibility_sql"

run_with_progress 'Checking target Auth service-role connection' target_auth_psql \
  --no-psqlrc --command 'select current_user;'
run_with_progress 'Adding old Auth columns missing from the target' target_auth_psql \
  --no-psqlrc \
  --variable ON_ERROR_STOP=1 \
  --file "$auth_compatibility_sql"

run_with_progress 'Checking target Storage service-role connection' target_storage_psql \
  --no-psqlrc --command 'select current_user;'
run_with_progress 'Adding old Storage columns missing from the target' target_storage_psql \
  --no-psqlrc \
  --variable ON_ERROR_STOP=1 \
  --file "$storage_compatibility_sql"

run_with_progress "Exporting old Auth and Storage metadata with ${PG_DUMP_IMAGE:-postgres:17}" dump_source_metadata

run_with_progress 'Importing Auth and Storage metadata' target_psql \
  --no-psqlrc \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --command 'SET session_replication_role = replica' \
  --file "$metadata_sql"

target_users="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from auth.users;' | scalar)"
target_objects="$(target_psql --no-psqlrc --tuples-only --no-align --command 'select count(*) from storage.objects;' | scalar)"
[[ "$source_users" == "$target_users" ]] || { printf 'Auth user count mismatch: source=%s target=%s\n' "$source_users" "$target_users" >&2; exit 1; }
[[ "$source_objects" == "$target_objects" ]] || { printf 'Storage metadata count mismatch: source=%s target=%s\n' "$source_objects" "$target_objects" >&2; exit 1; }

source_psql --no-psqlrc --tuples-only --no-align \
  --command "select name || E'\\t' || public from storage.buckets order by name;" \
  > "$bucket_manifest"

step 'Auth and Storage metadata verification passed.'
printf 'Auth/Storage dump: %s\n' "$metadata_sql"
printf 'Auth compatibility SQL: %s\n' "$auth_compatibility_sql"
printf 'Storage compatibility SQL: %s\n' "$storage_compatibility_sql"
printf 'Storage bucket manifest: %s\n' "$bucket_manifest"
printf 'NEXT REQUIRED: copy the real files for every bucket in that manifest before switching traffic.\n'
