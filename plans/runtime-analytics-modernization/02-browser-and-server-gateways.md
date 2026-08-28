# 02 — Browser and server gateways

## Goal

Load analytics only when allowed and apply the same privacy rules on the browser and server.

## Scope

1. Upgrade PostHog packages and remove unused `@vercel/analytics`.
2. Dynamically load one PostHog browser client after consent, keyed by runtime config and tenant scope.
3. Enable anonymous profiles, safe autocapture, web vitals, heatmaps, dead clicks, safe error types, attribution, and optional fully masked replay.
4. Keep Google in basic consent mode: denied defaults first, tag after consent, disabled and cleared on revocation.
5. Add a same-origin rejected-event route and a server gateway that validates the cookie before accepting a browser identity.
6. Preserve the revision-aware `posthog-node` factory.

## Test-first steps

1. Update `runtime-analytics.test.ts` so the PostHog module is not loaded before consent and teardown happens on rejection or tenant change.
2. Add server-gateway tests for pending, denied, granted, wrong scope, wrong version, spoofed distinct ID, and content-free properties.
3. Add route tests for valid aggregate events, rejected extra fields, and malformed bodies.
4. Implement and clean up old direct SDK paths.

## Files

- `package.json`, `package-lock.json`
- `src/lib/analytics.ts`
- `src/lib/server-analytics.ts`
- `src/lib/posthog-factory.ts`
- `src/lib/posthog.ts`
- `src/app/api/analytics/events/route.ts`
- `src/components/features/analytics/AnalyticsConsentProvider.tsx`
- `src/components/features/analytics/GoogleAnalyticsManager.tsx`
- `src/app/_components/ConsentDefaultsScript.tsx`
- focused unit and route tests

## Exact tests

```sh
npm test -- tests/unit/runtime-analytics.test.ts tests/unit/server-analytics.test.ts tests/unit/posthog-factory.test.ts tests/unit/analytics-events-route.test.ts
```

## Runtime check

Use the browser network panel to prove no PostHog or Google request while pending or denied, PostHog and Google requests after consent, replay only after its switch is enabled, and no further requests after revocation.

## Completion rules

- No static `posthog-js` import remains.
- A runtime config change cannot keep the previous tenant client alive.
- Rejected events have no stable person or session ID.
- Server events link to the browser only after valid scoped consent.

## Risks

- A dynamic import can finish after consent is withdrawn. Recheck the current signature before initialization.
- The PostHog singleton can retain the first tenant. Use a separately named or new client and tear it down on config changes.
