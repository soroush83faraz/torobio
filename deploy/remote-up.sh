#!/usr/bin/env bash
# Build and (re)start the app on the VPS with Docker Compose.
#
#   deploy/remote-up.sh --host user@vps [--dir /opt/bazaar] [--port 22]
#                       [--sync | --git-pull | --no-sync] [--proxy] [--env-file PATH]
#                       [--dry-run]
#
#   --sync       (default) copy the working tree (tracked + untracked, minus .gitignore'd files such as
#                .env and the database) to <dir> with rsync. No remote git repository needed.
#   --git-pull   instead run `git pull --ff-only` in <dir> on the VPS (it must be a clone).
#   --no-sync    do not touch the source on the VPS (rebuild what is there).
#   --proxy      also run the bundled Caddy (compose profile "proxy"; DOMAIN in the VPS .env => HTTPS).
#   --env-file   upload PATH as <dir>/.env (mode 600). Without it an existing VPS .env is kept, or
#                created from .env.example on the first run (then edit it on the VPS).
#   --dry-run    print every step and the remote script; change nothing.
#
# On the VPS it: tags the running image as :previous, builds the new one (tagged with the commit),
# starts it with `docker compose up -d`, waits until the container is healthy and prints `docker compose ps`.
# Roll back with deploy/rollback.md. Settings may come from DEPLOY_* variables (see deploy/lib.sh).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=deploy/lib.sh
source "$here/lib.sh"

SYNC=sync
PROXY=0
ENV_FILE=""
usage() {
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help) usage ;;
    --host) [[ $# -ge 2 ]] || usage; HOST="$2"; shift ;;
    --dir) [[ $# -ge 2 ]] || usage; DIR="$2"; shift ;;
    --port) [[ $# -ge 2 ]] || usage; SSH_PORT="$2"; shift ;;
    --env-file) [[ $# -ge 2 ]] || usage; ENV_FILE="$2"; shift ;;
    --sync) SYNC=sync ;;
    --git-pull) SYNC=pull ;;
    --no-sync) SYNC=none ;;
    --proxy) PROXY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
  shift
done
validate_target
build_ssh
[[ -z "$ENV_FILE" || -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
[[ "$SYNC" != sync || -f "$root/compose.yaml" ]] || die "run from a checkout that contains compose.yaml"

# Build identifier shown by /api/health ("commit") and used as the image tag.
if COMMIT="$(cd "$root" && git rev-parse --short=12 HEAD 2> /dev/null)"; then
  [[ -z "$(cd "$root" && git status --porcelain 2> /dev/null)" ]] || COMMIT="${COMMIT}-dirty"
else
  COMMIT="$(date -u +%Y%m%d%H%M%S)"
fi

echo "== remote-up: $HOST:$DIR   source=$SYNC proxy=$PROXY build=$COMMIT$([[ "$DRY_RUN" == 1 ]] && echo '   [DRY RUN]')"

run "${SSH[@]}" "$HOST" "mkdir -p '$DIR'"

case "$SYNC" in
  sync)
    echo "+ (cd $root && git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- ./ $HOST:$DIR/)"
    if [[ "$DRY_RUN" == 0 ]]; then
      command -v rsync > /dev/null || die "rsync is required for --sync (or use --git-pull)"
      (cd "$root" && git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- -e "$RSYNC_SSH" ./ "$HOST:$DIR/")
    fi
    ;;
  pull) run "${SSH[@]}" "$HOST" "cd '$DIR' && git pull --ff-only" ;;
  none) echo "   (source on the VPS left as is)" ;;
esac

if [[ -n "$ENV_FILE" ]]; then
  run "${SCP[@]}" "$ENV_FILE" "$HOST:$DIR/.env.upload"
  run "${SSH[@]}" "$HOST" "cd '$DIR' && chmod 600 .env.upload && mv -f .env.upload .env"
fi

# Runs on the VPS. $1 = dir, $2 = build id, $3 = 1 to include the proxy profile.
# shellcheck disable=SC2016  # single quotes on purpose: expanded on the VPS, not here
REMOTE='set -euo pipefail
cd "$1"
if [ ! -f .env ]; then
  cp .env.example .env && chmod 600 .env
  echo "NOTE: created .env from .env.example - edit it on the VPS (LLM_API_KEY, DOMAIN, TRUST_PROXY ...)"
fi
grep -q "^DATA_DIR=" .env || [ -f data/market.sqlite ] || echo "WARNING: data/market.sqlite is missing - the app will report db:false (run deploy/push-data.sh)"
profile=""; [ "$3" = 1 ] && profile="--profile proxy"
dc() { docker compose $profile "$@"; }
if docker image inspect bazaar-companion:latest > /dev/null 2>&1; then
  docker tag bazaar-companion:latest bazaar-companion:previous
fi
export APP_COMMIT="$2"
dc build app
docker tag bazaar-companion:latest "bazaar-companion:$2"
dc up -d --remove-orphans
echo "waiting for the app to become healthy ..."
for i in $(seq 1 45); do
  state="$(docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" "$(dc ps -q app)" 2> /dev/null || true)"
  [ "$state" = healthy ] && break
  sleep 2
done
dc ps
if [ "$state" != healthy ]; then
  echo "app is not healthy (state: ${state:-unknown}); last log lines:" >&2
  dc logs --tail 30 app >&2 || true
  exit 1
fi
echo "app is healthy (build $2)"'

if [[ "$DRY_RUN" == 1 ]]; then
  echo "+ ${SSH[*]} $HOST bash -c '<remote script below>' -- $DIR $COMMIT $PROXY"
  echo "------ remote script ------"
  echo "$REMOTE"
  echo "---------------------------"
  echo "== dry run finished: nothing was changed."
else
  "${SSH[@]}" "$HOST" "bash -c $(printf '%q' "$REMOTE") -- $(printf '%q %q %q' "$DIR" "$COMMIT" "$PROXY")"
  echo "== deployed. Next: deploy/smoke.sh http://<vps-ip>:<port> (or https://<your-domain>)"
fi
