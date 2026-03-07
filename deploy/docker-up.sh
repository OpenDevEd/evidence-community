#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="$(basename "$REPO_ROOT")"

source "$REPO_ROOT/deploy/app-config.sh"

HOST_PORT="$(get_host_port "$APP_NAME")"

cd "$REPO_ROOT"
HOST_PORT="$HOST_PORT" docker compose up --build "$@"
