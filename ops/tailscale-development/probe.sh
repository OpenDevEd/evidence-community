#!/usr/bin/env bash
# Proves that the development library is private and its admin bypass works.
# Usage: probe.sh <private-base-url> <old-public-base-url>
set -u

private_base="${1%/}"
public_base="${2%/}"
probe_dir="$(mktemp -d)"
fail_total=0

cleanup() {
	rm -rf "$probe_dir"
}
trap cleanup EXIT

pass() {
	printf '  ok   %s\n' "$1"
}

fail() {
	printf '  FAIL %s\n' "$1"
	fail_total=$((fail_total + 1))
}

request() {
	local name="$1" url="$2"
	curl -sS -L --max-time 30 \
		-D "$probe_dir/$name.headers" \
		-o "$probe_dir/$name.body" \
		-w '%{http_code}\n%{url_effective}' \
		"$url" >"$probe_dir/$name.result" 2>"$probe_dir/$name.error" || true
}

echo "== private Tailscale path =="
request private-health "$private_base/api/library-config/health"
private_health_code="$(sed -n '1p' "$probe_dir/private-health.result")"
if [ "$private_health_code" = "200" ] &&
	jq -e '.active.revision | type == "string" and length > 0' "$probe_dir/private-health.body" >/dev/null 2>&1; then
	pass "library health returns an active revision"
else
	fail "library health did not return an active revision"
fi

request private-admin-api "$private_base/api/admin/library"
private_admin_code="$(sed -n '1p' "$probe_dir/private-admin-api.result")"
private_admin_cache="$(awk 'BEGIN { IGNORECASE=1 } /^cache-control:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0 } END { print value }' "$probe_dir/private-admin-api.headers")"
if [ "$private_admin_code" = "200" ]; then
	pass "admin API is enabled"
else
	fail "admin API returned HTTP ${private_admin_code:-000}"
fi
if [ "$private_admin_cache" = "private, no-store" ]; then
	pass "admin API disables shared caching"
else
	fail "admin API cache control was '${private_admin_cache:-missing}'"
fi

request private-admin-page "$private_base/admin"
private_admin_page_code="$(sed -n '1p' "$probe_dir/private-admin-page.result")"
if [ "$private_admin_page_code" = "200" ] && grep -q "Library administration" "$probe_dir/private-admin-page.body"; then
	pass "admin workbench is visible"
else
	fail "admin workbench was not visible"
fi

request private-library "$private_base/lib"
private_library_code="$(sed -n '1p' "$probe_dir/private-library.result")"
private_library_url="$(sed -n '2p' "$probe_dir/private-library.result")"
if [ "$private_library_code" = "200" ] && [[ "$private_library_url" == "$private_base"/* ]]; then
	pass "public library stays on the private hostname"
else
	fail "public library returned HTTP ${private_library_code:-000} at ${private_library_url:-no URL}"
fi

echo
echo "== retired public path =="
request public-health "$public_base/api/library-config/health"
public_health_code="$(sed -n '1p' "$probe_dir/public-health.result")"
if [ "$public_health_code" = "000" ] ||
	! jq -e '.active.revision | type == "string" and length > 0' "$probe_dir/public-health.body" >/dev/null 2>&1; then
	pass "old hostname cannot return this library's health"
else
	fail "old hostname still returns this library's active revision"
fi

request public-admin "$public_base/admin"
if ! grep -q "Library administration" "$probe_dir/public-admin.body"; then
	pass "old hostname cannot return the admin workbench"
else
	fail "old hostname still returns the admin workbench"
fi

echo
if [ "$fail_total" -eq 0 ]; then
	echo "all checks passed"
else
	echo "$fail_total check(s) failed"
	exit 1
fi
