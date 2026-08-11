#!/usr/bin/env bash
# Add, list or remove an individual database login.
#
# Everyone gets their own role so access can be revoked per person and psql
# activity is attributable. Nobody should share the bootstrap superuser.
#
#   scripts/db_user.sh add    fvadmin admin
#   scripts/db_user.sh add    fvread  read
#   scripts/db_user.sh list
#   scripts/db_user.sh revoke minsu
#   scripts/db_user.sh passwd jinwoo
#
# The generated password is printed once and never stored by this script.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$(cd -- "$SCRIPT_DIR/.." && pwd)"

DB_USER="${POSTGRES_USER:-finverse}"
DB_NAME="${POSTGRES_DB:-finverse}"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  else sudo docker compose "$@"; fi
}
psql_q() { compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --no-psqlrc -qtA -c "$1"; }

gen_password() {
  python3 -c "import secrets,string; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(28)))"
}

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

case "${1:-}" in
  add)
    name="${2:?usage: add <name> <read|write|loader>}"
    level="${3:-read}"
    case "$level" in read|write|loader|admin) ;; *) echo "level must be read, write, loader or admin" >&2; exit 1 ;; esac
    # Reject anything that is not a plain identifier rather than quoting it
    # into SQL; this value becomes a role name.
    [[ "$name" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || { echo "name must match ^[a-z][a-z0-9_]{1,30}\$" >&2; exit 1; }
    pw="$(gen_password)"
    psql_q "DO \$\$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$name') THEN
                CREATE ROLE $name LOGIN;
              END IF;
            END \$\$;" >/dev/null
    psql_q "ALTER ROLE $name WITH LOGIN PASSWORD '$pw';" >/dev/null
    psql_q "GRANT finverse_$level TO $name;" >/dev/null
    # admin manages people, so it needs CREATEROLE on top of the group grant.
    if [ "$level" = admin ]; then
      psql_q "ALTER ROLE $name CREATEROLE;" >/dev/null
    fi
    # ALTER ROLE ... SET does NOT inherit through group membership: session
    # settings only apply to the role that actually logs in. Granting
    # finverse_read is what blocks writes; these are the guard rails and must
    # be set on the individual login.
    if [ "$level" = read ]; then
      psql_q "ALTER ROLE $name SET default_transaction_read_only = on;" >/dev/null
      psql_q "ALTER ROLE $name SET statement_timeout = '10min';" >/dev/null
      psql_q "ALTER ROLE $name SET idle_in_transaction_session_timeout = '5min';" >/dev/null
    fi
    host="$(tailscale ip -4 2>/dev/null | head -1 || echo '<server>')"
    echo "created: $name  (finverse_$level)"
    echo
    echo "  password: $pw"
    echo "  DATABASE_URL=postgresql://$name:$pw@$host:5432/$DB_NAME"
    echo
    echo "Shown once. Store it in a password manager; re-issue with 'passwd'."
    ;;
  passwd)
    name="${2:?usage: passwd <name>}"
    [[ "$name" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || { echo "bad name" >&2; exit 1; }
    pw="$(gen_password)"
    psql_q "ALTER ROLE $name WITH PASSWORD '$pw';" >/dev/null
    echo "rotated: $name"
    echo "  password: $pw"
    ;;
  revoke)
    name="${2:?usage: revoke <name>}"
    [[ "$name" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || { echo "bad name" >&2; exit 1; }
    # Keep the role so object ownership stays intact; just stop it logging in.
    psql_q "ALTER ROLE $name NOLOGIN;" >/dev/null
    psql_q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '$name';" >/dev/null
    echo "revoked: $name (login disabled, sessions terminated)"
    ;;
  list)
    printf '%-20s %-10s %s\n' NAME LOGIN GROUPS
    psql_q "SELECT r.rolname || '|' || (CASE WHEN r.rolcanlogin THEN 'yes' ELSE 'no' END) || '|' ||
                   coalesce(string_agg(g.rolname, ','), '-')
            FROM pg_roles r
            LEFT JOIN pg_auth_members m ON m.member = r.oid
            LEFT JOIN pg_roles g ON g.oid = m.roleid
            WHERE r.rolname NOT LIKE 'pg_%'
              AND r.rolname NOT IN ('finverse_read','finverse_write','finverse_loader')
            GROUP BY r.rolname, r.rolcanlogin ORDER BY r.rolname;" |
      while IFS='|' read -r n l g; do
        [ -z "$n" ] && continue
        printf '%-20s %-10s %s\n' "$n" "$l" "$g"
      done
    ;;
  *) usage ;;
esac
