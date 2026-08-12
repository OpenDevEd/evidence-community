#!/bin/sh
set -eu

if [ "$(id -u)" != "0" ]; then
	exec "$@"
fi

config_path="${LIBRARY_CONFIG_PATH:-}"
config_access_error() {
	echo "Startup failed: $config_path is not readable by the app user (uid 1001) and could not be changed. If the mount is read-only, make the file readable by uid or gid 1001 on the host." >&2
	exit 1
}

if [ -n "$config_path" ] && [ -e "$config_path" ] \
	&& ! setpriv --reuid 1001 --regid 1001 --init-groups -- test -r "$config_path"; then
	chgrp 1001 "$config_path" && chmod g+r "$config_path" || config_access_error
	setpriv --reuid 1001 --regid 1001 --init-groups -- test -r "$config_path" \
		|| config_access_error
fi

exec setpriv --reuid 1001 --regid 1001 --init-groups -- "$@"
