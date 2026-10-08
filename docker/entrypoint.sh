#!/bin/sh
set -eu

# jemalloc's background thread returns the memory of threads that have gone idle, such as the PDF workers
# after an import. It starts with the service and not before: setpriv aborts when it changes user with the
# thread running.
service_allocator="MALLOC_CONF=background_thread:true"

if [ "$(id -u)" != "0" ]; then
	exec env "$service_allocator" "$@"
fi

config_path="${LIBRARY_CONFIG_PATH:-}"
config_seed_path="${LIBRARY_CONFIG_SEED_PATH:-}"
config_access_error() {
	echo "Startup failed: $config_path is not readable by the app user (uid 1001) and could not be changed. If the mount is read-only, make the file readable by uid or gid 1001 on the host." >&2
	exit 1
}

repair_config_access() {
	if [ -e "$config_path" ] \
		&& ! setpriv --reuid 1001 --regid 1001 --init-groups -- test -r "$config_path"; then
		chgrp 1001 "$config_path" && chmod g+r "$config_path" || config_access_error
	fi
}

if [ -n "$config_path" ] && [ -n "$config_seed_path" ]; then
	config_directory="$(dirname "$config_path")"
	mkdir -p "$config_directory"
	chown 1001:1001 "$config_directory"
	repair_config_access
	setpriv --reuid 1001 --regid 1001 --init-groups -- \
		node_modules/.bin/tsx tools/activateLibraryConfig.ts \
		--initialize "$config_seed_path" "$config_path"
fi

if [ -n "$config_path" ]; then
	repair_config_access
	setpriv --reuid 1001 --regid 1001 --init-groups -- test -r "$config_path" \
		|| config_access_error
fi

exec setpriv --reuid 1001 --regid 1001 --init-groups -- env "$service_allocator" "$@"
