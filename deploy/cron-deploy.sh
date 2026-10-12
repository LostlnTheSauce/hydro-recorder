#!/bin/bash
# Run by a cPanel cron job every few minutes. Pulls main from GitHub into
# cPanel's copy of this repository and, if main has a commit that has not been
# deployed yet, runs cPanel's "Deploy HEAD Commit" (which follows .cpanel.yml).
# Quiet when there is nothing new, so the log only records real deploys and errors.
#
# Cron line (cPanel → Cron Jobs, every 5 minutes):
#   /bin/bash $HOME/repositories/hydro-recorder/deploy/cron-deploy.sh >> $HOME/hydro-deploy.log 2>&1

# Everything runs inside main(), which bash reads in full before starting, so
# pulling a new copy of this file mid-run cannot confuse the running script.
main() {
  set -euo pipefail
  local repo state stamp head deployed result
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  state="$HOME/.hydro-deployed-commit"
  stamp() { date '+%Y-%m-%d %H:%M:%S'; }

  # One run at a time, even if a pull or deploy is slow.
  exec 9>"$HOME/.hydro-deploy.lock"
  if command -v flock >/dev/null; then flock -n 9 || return 0; fi

  cd "$repo"
  if ! git fetch --quiet origin main 2>/tmp/hydro-deploy-fetch.$$; then
    echo "$(stamp) Could not reach GitHub; will retry. $(tr '\n' ' ' </tmp/hydro-deploy-fetch.$$)"
    rm -f /tmp/hydro-deploy-fetch.$$
    return 1
  fi
  rm -f /tmp/hydro-deploy-fetch.$$
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    echo "$(stamp) cPanel's copy is on branch $(git rev-parse --abbrev-ref HEAD), not main. Switch it to main in cPanel → Git Version Control."
    return 1
  fi
  # Fast-forward only: a copy that was edited on the server is reported, never overwritten.
  if ! git -c advice.diverging=false merge --quiet --ff-only origin/main 2>/dev/null; then
    echo "$(stamp) cPanel's copy has changes that are not on GitHub, so it was not updated. Remove them in cPanel → Git Version Control."
    return 1
  fi

  head="$(git rev-parse HEAD)"
  deployed="$(cat "$state" 2>/dev/null || true)"
  [ "$head" = "$deployed" ] && return 0

  result="$(uapi --output=json VersionControlDeployment create repository_root="$repo" 2>&1 || true)"
  if ! grep -q '"status" *: *1' <<<"$result"; then
    echo "$(stamp) Deploy of ${head:0:7} failed: $(tr '\n' ' ' <<<"$result" | cut -c1-500)"
    return 1
  fi
  echo "$head" >"$state"
  echo "$(stamp) Deployed ${head:0:7}: $(git log -1 --format=%s)"
}

main "$@"
exit $?
