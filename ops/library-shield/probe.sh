#!/usr/bin/env bash
# Contract test for the Evidence Library browser shield.
# Usage: probe.sh <hostname> [hostname...]
set -u

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
fail_total=0

check() {
	local desc="$1" expect="$2" got="$3"
	if [ "$got" = "$expect" ]; then
		printf '  ok   %-38s %s\n' "$desc" "$got"
	else
		printf '  FAIL %-38s got %s, expected %s\n' "$desc" "$got" "$expect"
		fail_total=$((fail_total + 1))
	fi
}

for host in "$@"; do
	echo "== $host =="
	base="https://$host"

	body=$(mktemp)
	code=$(curl -s -m 20 -o "$body" -w '%{http_code}' -A "$UA" -H 'Accept: text/html,application/xhtml+xml' "$base/lib")
	check "uncookied HTML -> challenge (401)" 401 "$code"
	grep -q 'Checking your browser' "$body" && printf '  ok   %-38s\n' "challenge page content" || { printf '  FAIL challenge page content missing\n'; fail_total=$((fail_total + 1)); }
	rm -f "$body"

	code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -A "$UA" -H 'Accept: text/html' -H 'Cookie: ode_browser_check=1' "$base/lib")
	check "cookied HTML -> real page (200)" 200 "$code"

	ct=$(curl -s -m 20 -o /dev/null -w '%{content_type}' -A "$UA" "$base/api/auth/session")
	check "API without cookie -> JSON" "application/json" "${ct%%;*}"

	code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -A "$UA" -H 'Accept: text/html' "$base/robots.txt")
	check "robots.txt bypasses (200)" 200 "$code"

	code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -A 'GPTBot/1.0' -H 'Accept: text/html' "$base/lib")
	check "GPTBot blocked (403)" 403 "$code"
done

echo
if [ "$fail_total" -eq 0 ]; then
	echo "all checks passed"
else
	echo "$fail_total check(s) FAILED"
	exit 1
fi
