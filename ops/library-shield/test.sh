#!/usr/bin/env bash
# Local contract test for the forwardAuth decision endpoint.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image_tag="new-el-library-shield-test:local"
container_name="new-el-library-shield-test-$$"
body_file=$(mktemp)
generated_policy=$(mktemp)

cleanup() {
	docker rm -f "$container_name" >/dev/null 2>&1 || true
	rm -f "$body_file" "$generated_policy"
}
trap cleanup EXIT

"$script_dir/forwardauth/sync-radar-bots.sh" \
	--source "$script_dir/forwardauth/radar-bots.snapshot.json" \
	--output "$generated_policy"

grep -Fq '"~*GPTBot" 1;' "$generated_policy"
grep -Fq '"~*OAI-SearchBot" SEARCH_ENGINE_CRAWLER;' "$generated_policy"
grep -Fq '"~*ChatGPT-User" AI_ASSISTANT;' "$generated_policy"
if awk '/map \$http_user_agent \$ode_training_crawler/,/^}/' "$generated_policy" | grep -F 'CloudVertexBot' >/dev/null; then
	printf 'FAIL %-42s still classified as training\n' 'policy override removes Vertex crawler'
	exit 1
fi
awk '/map \$http_user_agent \$ode_allowed_crawler/,/^}/' "$generated_policy" | grep -F 'CloudVertexBot' >/dev/null
printf 'ok   %-42s generated\n' 'Radar policy snapshot'

docker build --quiet -t "$image_tag" "$script_dir/forwardauth" >/dev/null
docker run --rm -d --name "$container_name" -p 127.0.0.1::8080 "$image_tag" >/dev/null

published_address=$(docker port "$container_name" 8080/tcp)
published_port=${published_address##*:}
base="http://127.0.0.1:$published_port"

for _ in $(seq 1 50); do
	if curl -fsS "$base/healthz" >/dev/null 2>&1; then
		break
	fi
	sleep 0.1
done
curl -fsS "$base/healthz" >/dev/null

last_code=$(curl -sS -o "$body_file" -w '%{http_code}' "$base/forbidden")
if [ "$last_code" != 403 ]; then
	printf 'FAIL %-42s got %s, expected 403\n' 'confirmed source response is forbidden' "$last_code"
	exit 1
fi
printf 'ok   %-42s %s\n' 'confirmed source response is forbidden' "$last_code"

browser_ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
last_code=""

request_decision() {
	local method="$1"
	local request_uri="$2"
	local accept="$3"
	local user_agent="$4"
	local cookie="${5:-}"
	local rsc="${6:-}"
	local -a headers=(
		-H "X-Forwarded-Method: $method"
		-H "X-Forwarded-Uri: $request_uri"
		-H 'X-Forwarded-Host: docs.edtechhub.org'
		-H "Accept: $accept"
		-H "User-Agent: $user_agent"
	)

	if [ -n "$cookie" ]; then
		headers+=(-H "Cookie: $cookie")
	fi
	if [ -n "$rsc" ]; then
		headers+=(-H "Rsc: $rsc")
	fi

	last_code=$(curl -sS -o "$body_file" -w '%{http_code}' "${headers[@]}" "$base/decide")
}

assert_code() {
	local description="$1"
	local expected="$2"
	if [ "$last_code" != "$expected" ]; then
		printf 'FAIL %-42s got %s, expected %s\n' "$description" "$last_code" "$expected"
		exit 1
	fi
	printf 'ok   %-42s %s\n' "$description" "$last_code"
}

request_decision GET '/lib/MI3J6SZH' 'text/html' "$browser_ua"
assert_code 'uncookied HTML gets challenge' 401
grep -q 'Checking your browser' "$body_file"

for banned_ip in \
	43.119.100.34 \
	43.119.104.34 \
	47.82.201.34 \
	47.82.202.34 \
	116.179.33.34 \
	202.46.62.34
do
	last_code=$(curl -sS -o "$body_file" -w '%{http_code}' \
		-H 'X-Forwarded-Method: GET' \
		-H 'X-Forwarded-Uri: /lib/MI3J6SZH' \
		-H 'X-Forwarded-Host: docs.edtechhub.org' \
		-H "X-Forwarded-For: $banned_ip" \
		-H 'Accept: text/html' \
		-H "User-Agent: $browser_ua" \
		"$base/decide")
	assert_code "banned network contains $banned_ip" 403
done

last_code=$(curl -sS -o "$body_file" -w '%{http_code}' \
	-H 'X-Forwarded-Method: GET' \
	-H 'X-Forwarded-Uri: /lib/MI3J6SZH' \
	-H 'X-Forwarded-Host: docs.edtechhub.org' \
	-H 'X-Forwarded-For: 172.18.0.1' \
	-H 'CF-Connecting-IP: 43.119.100.34' \
	-H 'Accept: text/html' \
	-H "User-Agent: $browser_ua" \
	"$base/decide")
assert_code 'Cloudflare source IP ban is enforced' 403

last_code=$(curl -sS -o "$body_file" -w '%{http_code}' \
	-H 'X-Forwarded-Method: GET' \
	-H 'X-Forwarded-Uri: /lib/MI3J6SZH' \
	-H 'X-Forwarded-Host: docs.edtechhub.org' \
	-H 'X-Forwarded-For: 43.119.101.34' \
	-H 'Accept: text/html' \
	-H "User-Agent: $browser_ua" \
	"$base/decide")
assert_code 'adjacent network is not banned' 401

last_code=$(curl -sS -o "$body_file" -w '%{http_code}' \
	-H 'X-Forwarded-Method: GET' \
	-H 'X-Forwarded-Uri: /lib/MI3J6SZH' \
	-H 'X-Forwarded-Host: docs.edtechhub.org' \
	-H 'X-Forwarded-For: 202.46.63.34' \
	-H 'Accept: text/html' \
	-H "User-Agent: $browser_ua" \
	"$base/decide")
assert_code 'new ban does not cover adjacent network' 401

request_decision GET '/lib/MI3J6SZH' 'text/html' "$browser_ua" 'ode_browser_check=1'
assert_code 'cookied HTML passes' 204

request_decision GET '/api/collections' '*/*' "$browser_ua"
assert_code 'uncookied API is forbidden' 403

request_decision POST '/api/items/batch' 'application/json' "$browser_ua"
assert_code 'uncookied API POST is forbidden' 403

request_decision GET '/lib/MI3J6SZH?_rsc=probe' 'text/x-component' "$browser_ua" '' 1
assert_code 'uncookied RSC is forbidden' 403

request_decision GET '/lib/MI3J6SZH' '*/*' "$browser_ua"
assert_code 'uncookied non-HTML page is forbidden' 403

request_decision GET '/api/collections' '*/*' "$browser_ua" 'ode_browser_check=1'
assert_code 'cookied API passes' 204

request_decision GET '/_next/static/app.js' '*/*' "$browser_ua"
assert_code 'static asset passes without cookie' 204

request_decision GET '/robots.txt' 'text/plain' "$browser_ua"
assert_code 'robots.txt passes without cookie' 204

request_decision GET '/api/unapi?id=MI3J6SZH' 'application/xml' "$browser_ua"
assert_code 'unAPI passes without cookie' 204

request_decision POST '/api/feature-flags/sync' 'application/json' 'Coolify-Scheduled-Task/1.0'
assert_code 'authenticated sync route reaches app' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'GPTBot/1.0'
assert_code 'training crawler is forbidden' 403

request_decision GET '/robots.txt' 'text/plain' 'GPTBot/1.0'
assert_code 'training crawler can read robots.txt' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'OAI-SearchBot/1.4'
assert_code 'ChatGPT search crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'ChatGPT-User/1.0'
assert_code 'ChatGPT user fetch passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'ClaudeBot/1.0'
assert_code 'Claude training crawler is forbidden' 403

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Claude-SearchBot/1.0'
assert_code 'Claude search crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'meta-externalagent/1.1'
assert_code 'Meta training crawler is forbidden' 403

request_decision GET '/lib/MI3J6SZH' 'text/html' 'meta-webindexer/1.1'
assert_code 'Meta AI search crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'PerplexityBot/1.0'
assert_code 'Perplexity search crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Google-Agent/1.0'
assert_code 'Google user agent passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'facebookexternalhit/1.1'
assert_code 'Meta link preview passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Claude-User/1.0'
assert_code 'Claude user fetch passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'CCBot/2.0 (https://commoncrawl.org/faq/)'
assert_code 'unverified training crawler is forbidden' 403

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'
assert_code 'ByteDance training crawler is forbidden' 403

for preview in \
	'Discord|Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' \
	'X|Twitterbot/1.0' \
	'Slack|Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' \
	'LinkedIn|LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)' \
	'WhatsApp|WhatsApp/2.23.20.0' \
	'Bluesky|Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)'
do
	request_decision GET '/lib/MI3J6SZH' 'text/html' "${preview#*|}"
	assert_code "${preview%%|*} link preview passes" 204
done

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)'
assert_code 'Internet Archive passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'
assert_code 'non-AI search crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'
assert_code 'SEO crawler passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; scraping@nytimes.com)'
assert_code 'Radar regex-escaped pattern matches' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)'
assert_code 'bot Radar lists without patterns passes' 204

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Googlebot/2.1'
assert_code 'recognized search crawler passes' 204

crawler_rejections=0
for crawler_index in $(seq 1 25); do
	request_decision GET "/lib/crawler-$crawler_index" 'text/html' "Googlebot/2.1 variant-$crawler_index"
	if [ "$last_code" = 429 ]; then
		crawler_rejections=$((crawler_rejections + 1))
	fi
done
if [ "$crawler_rejections" -eq 0 ]; then
	printf 'FAIL %-42s no requests were limited\n' 'crawler variants share category budget'
	exit 1
fi
printf 'ok   %-42s %s rejected\n' 'crawler variants share category budget' "$crawler_rejections"

request_decision GET '/lib/MI3J6SZH' 'text/html' 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
assert_code 'search crawl leaves preview budget alone' 204

printf '\nshield contract passed\n'
