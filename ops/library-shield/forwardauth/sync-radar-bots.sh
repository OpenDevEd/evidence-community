#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
policy_file="$script_dir/radar-policy.json"
renderer_file="$script_dir/render-radar-bots.jq"
source_file=""
output_file="/etc/nginx/conf.d/10-radar-bots.conf"
api_url="https://api.cloudflare.com/client/v4/radar/bots"

usage() {
	printf 'Usage: %s [--source FILE] [--output FILE] [--policy FILE] [--renderer FILE]\n' "$0"
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--source)
			source_file=${2:?missing value for --source}
			shift 2
			;;
		--output)
			output_file=${2:?missing value for --output}
			shift 2
			;;
		--policy)
			policy_file=${2:?missing value for --policy}
			shift 2
			;;
		--renderer)
			renderer_file=${2:?missing value for --renderer}
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			usage >&2
			exit 2
			;;
	esac
done

[ -r "$policy_file" ] || { printf 'Policy file is not readable: %s\n' "$policy_file" >&2; exit 1; }
[ -r "$renderer_file" ] || { printf 'Renderer file is not readable: %s\n' "$renderer_file" >&2; exit 1; }

work_dir=$(mktemp -d)
cleanup() {
	rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

if [ -n "$source_file" ]; then
	[ -r "$source_file" ] || { printf 'Source file is not readable: %s\n' "$source_file" >&2; exit 1; }
	feed_file=$source_file
else
	: "${CLOUDFLARE_RADAR_API_TOKEN:?CLOUDFLARE_RADAR_API_TOKEN is required without --source}"
	feed_file="$work_dir/feed.json"
	printf '{"bots":[]}\n' > "$feed_file"
	offset=0
	limit=1000

	while :; do
		page_file="$work_dir/page-$offset.json"
		curl --fail-with-body --silent --show-error \
			--retry 3 --retry-all-errors \
			--connect-timeout 10 --max-time 30 \
			--get "$api_url" \
			--header "Authorization: Bearer $CLOUDFLARE_RADAR_API_TOKEN" \
			--data-urlencode 'botVerificationStatus=VERIFIED' \
			--data-urlencode "limit=$limit" \
			--data-urlencode "offset=$offset" \
			--output "$page_file"

		page_count=$(jq -er 'select(.success == true) | .result.bots | length' "$page_file")
		next_feed="$work_dir/feed-next.json"
		jq -s '{bots: (.[0].bots + .[1].result.bots)}' "$feed_file" "$page_file" > "$next_feed"
		mv "$next_feed" "$feed_file"

		[ "$page_count" -eq "$limit" ] || break
		offset=$((offset + limit))
	done
fi

jq -e '
	(.result.bots // .bots) as $bots
	| ($bots | type == "array")
	and all($bots[];
		(.category | type == "string")
		and (.userAgentPatterns | type == "array")
		and all(.userAgentPatterns[]; type == "string" and (test("[\\r\\n]") | not))
	)
' "$feed_file" >/dev/null

output_dir=$(dirname -- "$output_file")
[ -d "$output_dir" ] || { printf 'Output directory does not exist: %s\n' "$output_dir" >&2; exit 1; }
candidate=$(mktemp "$output_file.tmp.XXXXXX")
jq -r --slurpfile policy "$policy_file" -f "$renderer_file" "$feed_file" > "$candidate"
chmod 0644 "$candidate"
mv "$candidate" "$output_file"
