#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2206  # variables/arrays are used by the sourcing scripts; DEPLOY_SSH_OPTS is split on purpose
# Shared helpers for deploy/push-data.sh and deploy/remote-up.sh (sourced, not executed).
# Connection settings come from arguments or the environment; nothing secret is stored here:
#   DEPLOY_HOST      user@host of the VPS            (--host)
#   DEPLOY_DIR       absolute project dir on the VPS (--dir, default /opt/bazaar)
#   DEPLOY_SSH_PORT  ssh port                        (--port, default 22)
#   DEPLOY_SSH_OPTS  extra ssh options, e.g. "-i ~/.ssh/vps_key"
# Authentication is plain ssh (keys / agent); this repo never handles passwords or keys.

HOST="${DEPLOY_HOST:-}"
DIR="${DEPLOY_DIR:-/opt/bazaar}"
SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DRY_RUN=0

die() {
  echo "error: $*" >&2
  exit 2
}

# Validate before anything is built into a remote command line.
validate_target() {
  [[ -n "$HOST" ]] || die "no host: pass --host user@vps or set DEPLOY_HOST"
  [[ "$HOST" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@:%+-]*$ ]] || die "invalid host '$HOST' (expected user@host or an ssh config alias)"
  [[ "$DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "invalid --dir '$DIR' (absolute path, letters digits . _ - / only)"
  [[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || die "invalid ssh port '$SSH_PORT'"
}

# ssh / rsync command prefixes (word-splitting of DEPLOY_SSH_OPTS is intended).
build_ssh() {
  SSH=(ssh -p "$SSH_PORT" -o ConnectTimeout=15 -o ServerAliveInterval=30 ${DEPLOY_SSH_OPTS:-})
  SCP=(scp -P "$SSH_PORT" ${DEPLOY_SSH_OPTS:-})
  RSYNC_SSH="ssh -p $SSH_PORT -o ConnectTimeout=15 -o ServerAliveInterval=30 ${DEPLOY_SSH_OPTS:-}"
}

# Print a command; execute it unless --dry-run.
run() {
  printf '+ %s\n' "$*"
  if [[ "$DRY_RUN" == 0 ]]; then "$@"; fi
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
