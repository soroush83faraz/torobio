#!/usr/bin/env bash
# Copy the SQLite database to the VPS and verify it arrived intact.
#
#   deploy/push-data.sh --host user@vps [--dir /opt/bazaar] [--file data/market.sqlite]
#                       [--port 22] [--restart] [--dry-run]
#
# What it does (printed before it runs; --dry-run prints and stops):
#   1. checks the local file is a SQLite database and computes its sha256
#   2. uploads it with rsync (compressed, resumable) to <dir>/data/market.sqlite.part
#   3. computes the sha256 ON THE VPS and compares; aborts (and removes the partial file) on mismatch
#   4. makes it world-readable (the container user is not your ssh user) and renames it into place
#      atomically; the previous file is kept as market.sqlite.prev
#   5. --restart: restarts the app container, because a running server keeps the old file open
# Settings may also come from DEPLOY_HOST, DEPLOY_DIR, DEPLOY_SSH_PORT, DEPLOY_SSH_OPTS (see deploy/lib.sh).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$here/lib.sh"

FILE="$here/../data/market.sqlite"
RESTART=0
usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help) usage ;;
    --host) [[ $# -ge 2 ]] || usage; HOST="$2"; shift ;;
    --dir) [[ $# -ge 2 ]] || usage; DIR="$2"; shift ;;
    --port) [[ $# -ge 2 ]] || usage; SSH_PORT="$2"; shift ;;
    --file) [[ $# -ge 2 ]] || usage; FILE="$2"; shift ;;
    --restart) RESTART=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
  shift
done
validate_target
build_ssh

[[ -f "$FILE" ]] || die "database file not found: $FILE (build it with 'npm run data:build' or pass --file)"
[[ "$(head -c 15 "$FILE")" == "SQLite format 3" ]] || die "$FILE is not a SQLite database"
SIZE="$(wc -c < "$FILE" | tr -d ' ')"

echo "== push-data: $FILE ($((SIZE / 1000000)) MB) -> $HOST:$DIR/data/market.sqlite$([[ "$DRY_RUN" == 1 ]] && echo '   [DRY RUN]')"
echo "   computing local sha256 ..."
LOCAL_SHA="$(sha256_of "$FILE")"
echo "   local sha256: $LOCAL_SHA"

run "${SSH[@]}" "$HOST" "mkdir -p '$DIR/data'"
if command -v rsync > /dev/null; then
  run rsync -z --partial --progress -e "$RSYNC_SSH" "$FILE" "$HOST:$DIR/data/market.sqlite.part"
else
  echo "   (rsync not found locally: using scp, no resume)"
  run "${SCP[@]}" "$FILE" "$HOST:$DIR/data/market.sqlite.part"
fi

# Runs on the VPS. $1 = dir, $2 = expected sha256. Values are validated above / hex only.
# shellcheck disable=SC2016  # single quotes on purpose: expanded on the VPS, not here
REMOTE='set -euo pipefail
cd "$1/data"
got="$(sha256sum market.sqlite.part | cut -d" " -f1)"
echo "   remote sha256: $got"
if [ "$got" != "$2" ]; then
  rm -f market.sqlite.part
  echo "CHECKSUM MISMATCH - upload discarded, nothing changed" >&2
  exit 1
fi
chmod 644 market.sqlite.part
[ -f market.sqlite ] && cp -p market.sqlite market.sqlite.prev
mv -f market.sqlite.part market.sqlite
echo "$2  market.sqlite" > market.sqlite.sha256
echo "   installed $1/data/market.sqlite (previous kept as market.sqlite.prev)"'
if [[ "$DRY_RUN" == 1 ]]; then
  echo "+ ${SSH[*]} $HOST bash -c '<verify sha256, chmod 644, atomic rename>' -- $DIR $LOCAL_SHA"
else
  "${SSH[@]}" "$HOST" "bash -c $(printf '%q' "$REMOTE") -- $(printf '%q %q' "$DIR" "$LOCAL_SHA")"
fi

if [[ "$RESTART" == 1 ]]; then
  run "${SSH[@]}" "$HOST" "cd '$DIR' && docker compose restart app"
else
  echo "== done. A running app still has the old file open: restart it with"
  echo "   ssh $HOST \"cd $DIR && docker compose restart app\"   (or re-run with --restart)"
fi
