#!/bin/sh
set -eu

if [ -z "${CLOUDFLARE_RADAR_API_TOKEN:-}" ]; then
	echo 'library-shield: CLOUDFLARE_RADAR_API_TOKEN is unset; using the bundled last-known-good bot catalog'
	exit 0
fi

output_file=/etc/nginx/conf.d/10-radar-bots.conf
sync_command=/usr/local/bin/sync-radar-bots.sh
policy_file=/opt/library-shield/radar-policy.json
renderer_file=/opt/library-shield/render-radar-bots.jq
interval=${RADAR_BOT_SYNC_INTERVAL_SECONDS:-86400}

case "$interval" in
	''|*[!0-9]*)
		echo 'library-shield: RADAR_BOT_SYNC_INTERVAL_SECONDS must be an integer' >&2
		exit 1
		;;
esac

if [ "$interval" -lt 300 ]; then
	echo 'library-shield: RADAR_BOT_SYNC_INTERVAL_SECONDS must be at least 300' >&2
	exit 1
fi

refresh_policy() {
	backup=$(mktemp)
	cp "$output_file" "$backup"
	if "$sync_command" \
		--policy "$policy_file" \
		--renderer "$renderer_file" \
		--output "$output_file" \
		&& nginx -t; then
		rm -f "$backup"
		return 0
	fi
	mv "$backup" "$output_file"
	return 1
}

if ! refresh_policy; then
	echo 'library-shield: Radar refresh failed; using the bundled last-known-good bot catalog' >&2
fi

(
	while sleep "$interval"; do
		if refresh_policy; then
			nginx -s reload
		else
			echo 'library-shield: Radar refresh failed; keeping the last-known-good bot catalog' >&2
		fi
	done
) &
