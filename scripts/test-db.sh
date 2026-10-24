#!/usr/bin/env bash
# PostgreSQL for DB-backed server tests on hosts without Docker.
#
#   scripts/test-db.sh ensure   start (installing on first use) and migrate; idempotent
#   scripts/test-db.sh reset    as ensure, but drop and recreate the database first
#   scripts/test-db.sh status   exit 0 when the database from .env.test accepts connections
#   scripts/test-db.sh stop     stop the server this script started
#
# The first `ensure` installs PostgreSQL 14 from conda-forge with micromamba under
# OUTLINE_TEST_PG_HOME (default: ~/.local/share/outline-test-pg). If something else
# already listens on the configured port, it is used as is. `reset` drops the database
# only on the server started from this data directory, and refuses while any other
# session is connected to it; it never ends a session.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home="${OUTLINE_TEST_PG_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/outline-test-pg}"
bin="$home/pg14/bin"
data="$home/data"

die() {
  echo "test-db: $*" >&2
  exit 1
}

url="$(sed -n 's/^DATABASE_URL=//p' "$repo/.env.test")"
[[ $url =~ ^postgres://([^:]+):([^@]+)@(127\.0\.0\.1|localhost):([0-9]+)/(.+)$ ]] ||
  die "unsupported DATABASE_URL in .env.test: $url"
user="${BASH_REMATCH[1]}" pass="${BASH_REMATCH[2]}" port="${BASH_REMATCH[4]}" db="${BASH_REMATCH[5]}"

# A closed port can time out instead of refusing (WSL), so the probe is bounded.
listening() { timeout 5 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; }

install() {
  [ "$(uname -sm)" = "Linux x86_64" ] || die "automatic install supports Linux x86_64 only"
  mkdir -p "$home"
  if [ ! -x "$bin/postgres" ]; then
    if [ ! -x "$home/micromamba" ]; then
      curl -fsSL https://micro.mamba.pm/api/micromamba/linux-64/latest |
        tar -xj -C "$home" --strip-components=1 bin/micromamba
    fi
    MAMBA_ROOT_PREFIX="$home/mamba" "$home/micromamba" create -y -q \
      -p "$home/pg14" -c conda-forge postgresql=14
  fi
  if [ ! -f "$data/PG_VERSION" ]; then
    "$bin/initdb" -D "$data" --auth=trust -U "$user" >/dev/null
  fi
}

psql() { "$bin/psql" -h 127.0.0.1 -p "$port" -U "$user" -d postgres -qtAX "$@"; }

start() {
  "$bin/pg_ctl" -D "$data" -l "$home/postgres.log" -w \
    -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
  psql -c "ALTER USER \"$user\" PASSWORD '$pass'"
  [ "$(psql -c "SELECT 1 FROM pg_database WHERE datname = '$db'")" = 1 ] ||
    psql -c "CREATE DATABASE \"$db\""
}

# The listening server is ours only when it reports $data as its data directory; a
# postmaster.pid alone can be stale while another server holds the port.
owned() {
  [ -f "$data/postmaster.pid" ] && [ -x "$bin/psql" ] &&
    [ "$(psql -w -c 'SHOW data_directory' 2>/dev/null)" -ef "$data" ]
}

# Drop and recreate $db; DROP DATABASE without FORCE also refuses a session that
# connects after the check, so the database stays in place in that case too.
recreate() {
  local sessions
  sessions="$(psql -c "SELECT format('pid %s (%s, %s)', pid, usename,
    coalesce(nullif(application_name, ''), client_addr::text, 'local'))
    FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid()")"
  [ -z "$sessions" ] ||
    die "not resetting $db: other sessions are connected to it:"$'\n'"$sessions"
  psql -c "DROP DATABASE IF EXISTS \"$db\"" || die "not resetting $db: DROP DATABASE failed"
  psql -c "CREATE DATABASE \"$db\""
}

migrate() {
  cd "$repo"
  NODE_ENV=test corepack yarn sequelize db:migrate >/dev/null
  echo "test-db: $db ready on 127.0.0.1:$port"
}

case "${1:-}" in
  ensure)
    if ! listening; then
      install
      start
    fi
    migrate
    ;;
  reset)
    if ! listening; then
      install
      start
    fi
    owned || die "something other than the server from $data listens on 127.0.0.1:$port; not resetting $db"
    recreate
    migrate
    ;;
  status)
    listening
    ;;
  stop)
    [ -f "$data/postmaster.pid" ] || die "no server started from $data"
    "$bin/pg_ctl" -D "$data" -w -m fast stop >/dev/null
    ;;
  *)
    die "usage: $0 ensure|reset|status|stop"
    ;;
esac
