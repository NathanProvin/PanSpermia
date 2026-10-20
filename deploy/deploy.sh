#!/usr/bin/env bash
# Deploys one commit of master on the server, then checks the game answers; if it doesn't, rolls back.
# GitHub Actions runs it over ssh as a forced command (authorized_keys), so the commit SHA is all a caller can pass:
#   ssh panspermia@HOST <full sha>      (or by hand on the server: bash deploy/deploy.sh <full sha>)
set -euo pipefail
sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: deploy.sh <full commit sha>" >&2; exit 2; }
cd /opt/panspermia
git fetch --quiet origin
git merge-base --is-ancestor "$sha" origin/master || { echo "$sha is not on master" >&2; exit 2; }
previous=$(git rev-parse HEAD)

build() { git checkout --quiet --force "$1" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent; }
healthy() {
  for _ in $(seq 30); do
    curl -fsS http://127.0.0.1:2567/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

build "$sha"
sudo /usr/bin/systemctl restart panspermia
if healthy; then
  echo "deployed $sha"
  exit 0
fi
echo "not healthy after the restart: rolling back to $previous" >&2
build "$previous"
sudo /usr/bin/systemctl restart panspermia
healthy || echo "the rollback is not healthy either: see journalctl -u panspermia" >&2
exit 1
