# AI rate limiting

## What this fixes

The old limiter counted only by IP address and kept counters inside one Node.js
process. People behind the same router shared ten requests, while separate app
instances could apply different counters.

The new limiter gives each browser ten AI requests per minute, 250 per 24 hours,
1,000 per seven days, and 5,000 per 30 days. Redis stores the shared counters
for every app instance. A separate limit of 1,000 requests per IP per minute
stops a client from avoiding the browser limits by repeatedly deleting its
cookie.

## Request flow

1. The proxy reads the trusted `x-real-ip` value and the `ai_rate_limit_id`
   cookie.
2. If the cookie is missing or invalid, the proxy creates a random ID and sends
   it back as an HTTP-only cookie scoped to `/api/ai` that expires after one
   year.
3. One short Redis script checks and updates all browser windows and the network
   counter as one atomic operation.
4. An allowed request continues to the AI route. A blocked request returns 429
   with the limit, remaining, reset, and retry headers.
5. Missing or unavailable Redis returns a controlled 503 response. The request
   is never allowed without a working limiter.

Redis keys contain SHA-256 hashes of the browser ID and IP. Each counter expires
with its window, up to 30 days. Redis never receives AI prompts, answers,
searches, or PDFs.

## Counter separation

Every key identifies both the deployment and the library before the hashed
browser or network value:

```text
evidence-library:ai-rate-limit:v1:coolify:itemsEkitabu:client:day:<hash>
evidence-library:ai-rate-limit:v1:coolify:itemsEkitabu:network:minute:<hash>
```

The `coolify` branch uses its existing `MEILI_INDEX` as the library identity.
This keeps all 17 libraries separate even though they share one Redis service.
The future `main` implementation uses `main` as its deployment name and the
runtime configuration's stable `libraryId` as its library identity. The two
deployments therefore cannot consume each other's limits.

Changing this prefix needs no Redis migration. Existing counters expire on
their own.

## Coolify configuration

The application needs one server-only value:

```text
AI_RATE_LIMIT_REDIS_URL=redis://default:PASSWORD@REDIS_SERVICE_HOST:6379
```

The app and Redis must share a private Docker network. Redis does not need a
public port.

## Testing

Run the focused test against a disposable or development Redis instance:

```sh
AI_RATE_LIMIT_TEST_REDIS_URL=redis://default:PASSWORD@HOST:6379 npm run test:ai-rate-limit
```

The test uses two Redis clients to represent two app instances. It proves that
two browsers on one IP receive separate budgets, both app instances see the
same counters, separate libraries do not share counters, all four browser
windows work, the network safety limit works, and counters expire.

## Porting this to `main`

Reuse `src/lib/ai/rate-limit.ts` and its focused test. The runtime on `main`
should supply the private Redis URL through its validated server configuration,
use `main` as the deployment namespace, and use `config.libraryId` as the tenant
namespace. Do not copy Coolify-specific environment handling into the limiter.
Keep the cookie name, request flow, limits, error responses, privacy wording,
and Redis test unchanged unless the product decision changes.
