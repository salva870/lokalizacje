#!/bin/bash
set -euo pipefail

if [[ -z "${PGRST_DB_PASSWORD:-}" ]]; then
  echo "PGRST_DB_PASSWORD is required for database init" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
      CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '${PGRST_DB_PASSWORD}';
    ELSE
      ALTER ROLE authenticator WITH LOGIN PASSWORD '${PGRST_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  GRANT anon TO authenticator;
  GRANT service_role TO authenticator;
  GRANT USAGE ON SCHEMA public TO anon, service_role;
EOSQL
