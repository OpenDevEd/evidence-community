#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_CONFIG_FILE="${APP_CONFIG_FILE:-$DEPLOY_DIR/apps.conf}"

list_known_apps() {
	awk '{ print $1 }' "$APP_CONFIG_FILE"
}

get_host_port() {
	local app="${1:?app name is required}"
	local port

	port="$(awk -v app="$app" '$1 == app { print $2 }' "$APP_CONFIG_FILE")"

	if [ -z "$port" ]; then
		echo "Error: unknown app folder '$app'" >&2
		echo "Valid app folders:" >&2
		list_known_apps | sed 's/^/  /' >&2
		return 1
	fi

	printf '%s\n' "$port"
}
