#!/usr/bin/env bash

set -euo pipefail

resolve_fallow_comparison() {
  local event_name="$1"
  local pull_request_base_ref="$2"
  local push_base_ref="$3"
  local comparison_sha

  if test "$event_name" = "pull_request"; then
    if test -z "$pull_request_base_ref"; then
      echo "The pull request base branch is missing." >&2
      return 1
    fi

    git fetch --no-tags origin \
      "+refs/heads/${pull_request_base_ref}:refs/remotes/origin/${pull_request_base_ref}"
    comparison_sha="$(git merge-base HEAD "refs/remotes/origin/${pull_request_base_ref}")"
  else
    if test -z "$push_base_ref"; then
      echo "The fixed Fallow baseline ref is missing." >&2
      return 1
    fi

    if ! git cat-file -e "${push_base_ref}^{commit}" 2>/dev/null; then
      git fetch --no-tags origin "${push_base_ref}:${push_base_ref}"
    fi
    comparison_sha="$(git rev-parse "${push_base_ref}^{commit}")"
  fi

  git cat-file -e "${comparison_sha}^{commit}"
  printf '%s\n' "$comparison_sha"
}

if test "${BASH_SOURCE[0]}" = "$0"; then
  resolve_fallow_comparison \
    "${GITHUB_EVENT_NAME:-}" \
    "${PR_BASE_REF:-}" \
    "${FALLOW_PUSH_BASE_REF:-}"
fi
