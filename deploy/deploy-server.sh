#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${1:?usage: npm run deploy:server -- <app-folder>}"
REMOTE_HOST="${DEPLOY_HOST:-evlib22}"
REMOTE_BASE_DIR="${REMOTE_BASE_DIR:-/root/evlib2}"
REMOTE_APP_DIR="$REMOTE_BASE_DIR/$APP_NAME"
VERCEL_SCOPE="${VERCEL_SCOPE:-opendeved}"
VERCEL_ENVIRONMENT="${VERCEL_ENVIRONMENT:-production}"
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-50.28.0}"
LOCAL_ENV_FILE=".env"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "$REPO_ROOT/deploy/app-config.sh"

require_command() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "Error: required command not found: $1" >&2
		exit 1
	}
}

echo_step() {
	printf '\n[%s] %s\n' "$1" "$2"
}

require_command git
require_command ssh
require_command scp
require_command npx

REMOTE_URL="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || true)"
if [ "$REMOTE_URL" != "git@github.com:OpenDevEd/new-el.git" ] && [ "$REMOTE_URL" != "https://github.com/OpenDevEd/new-el.git" ]; then
	echo "Error: run this from the new-el repo (expected OpenDevEd/new-el origin, got: ${REMOTE_URL:-none})" >&2
	exit 1
fi

CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
[ -n "$CURRENT_BRANCH" ] || {
	echo "Error: could not determine current git branch" >&2
	exit 1
}

git -C "$REPO_ROOT" diff --quiet && git -C "$REPO_ROOT" diff --cached --quiet || {
	echo "Error: local repo has uncommitted changes. Commit them before deploy." >&2
	exit 1
}

get_host_port "$APP_NAME" >/dev/null

echo_step 1 "Pushing local branch $CURRENT_BRANCH"
git -C "$REPO_ROOT" push -u origin "$CURRENT_BRANCH"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deploy-${APP_NAME}.XXXXXX")"
cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo_step 2 "Pulling Vercel env for $APP_NAME into a temp directory"
(
	cd "$TMP_DIR"
	export NO_UPDATE_NOTIFIER=1
	npx "vercel@${VERCEL_CLI_VERSION}" link --scope "$VERCEL_SCOPE" --project "$APP_NAME" -y
	npx "vercel@${VERCEL_CLI_VERSION}" env pull "$LOCAL_ENV_FILE" --yes --environment="$VERCEL_ENVIRONMENT"
)

[ -f "$TMP_DIR/$LOCAL_ENV_FILE" ] || {
	echo "Error: expected Vercel to create $LOCAL_ENV_FILE in $TMP_DIR" >&2
	exit 1
}

echo_step 3 "Checking remote prerequisites on $REMOTE_HOST"
ssh "$REMOTE_HOST" "test -d '$REMOTE_APP_DIR/.git'" || {
	echo "Error: remote app directory is missing or not a git repo: $REMOTE_APP_DIR" >&2
	exit 1
}

ssh "$REMOTE_HOST" "docker --version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1" || {
	echo "Error: remote host '$REMOTE_HOST' is missing Docker or Docker Compose" >&2
	exit 1
}

echo_step 4 "Resetting remote repo to origin/$CURRENT_BRANCH"
ssh "$REMOTE_HOST" "bash -lc 'set -euo pipefail; cd \"$REMOTE_APP_DIR\"; git fetch origin \"$CURRENT_BRANCH\"; git reset --hard; git clean -fdx; git checkout -B \"$CURRENT_BRANCH\" \"origin/$CURRENT_BRANCH\"; git reset --hard \"origin/$CURRENT_BRANCH\"; git clean -fdx'"

echo_step 5 "Uploading $LOCAL_ENV_FILE to $REMOTE_APP_DIR"
scp "$TMP_DIR/$LOCAL_ENV_FILE" "$REMOTE_HOST:$REMOTE_APP_DIR/$LOCAL_ENV_FILE"

echo_step 6 "Running Docker deploy for $APP_NAME on $REMOTE_HOST"
ssh "$REMOTE_HOST" "bash -lc 'set -euo pipefail; cd \"$REMOTE_APP_DIR\"; bash ./deploy/docker-up.sh up -d'"

echo_step 7 "Deployment completed for $APP_NAME"
