# 01 — Runtime contract and consent

## Goal

Make analytics configuration and consent tenant-aware before any SDK code changes.

## Scope

1. Add `analytics.consentPolicyVersion` and optional `analytics.posthog.uiHost` to the runtime schema, example, fixture, and generated public schema.
2. Replace the flat consent cookie with a strict record scoped to normalized `identity.baseUrl` and the configured policy version.
3. Add shared path sanitizing and a strict allowlist for browser-to-server analytics events.
4. Delete compatibility parsing for the old cookie.

## Test-first steps

1. Change `tests/unit/analytics-consent.test.ts` to reject old, wrong-tenant, wrong-version, expired, malformed, and replay-without-analytics records.
2. Add event-schema tests that reject extra fields, free-text query fields, titles, filenames, prompts, and unsafe paths.
3. Update config tests for valid and incomplete PostHog settings and the new policy version.
4. Implement the smallest code needed to pass.

## Files

- `src/config/library-config/schema.ts`
- `config/library.example.json`
- `tests/fixtures/library-config.ts`
- `public/library-config.schema.json`
- `src/lib/analytics-consent.ts`
- `src/lib/analytics-shared.ts`
- `src/lib/analytics-event-schema.ts`
- focused unit tests

## Exact tests

```sh
npm test -- tests/unit/analytics-consent.test.ts tests/unit/library-config-schema.test.ts tests/unit/analytics-event-schema.test.ts
npm run schema:generate:library-config
npm run schema:check
```

## Runtime check

Load two runtime configs with different `identity.baseUrl` values and confirm one cookie is accepted for only its own scope and version.

## Completion rules

- No old cookie value is accepted.
- Session replay cannot be true when product analytics is false.
- Unsafe or unknown event properties fail validation.
- Generated runtime schema matches TypeScript.

## Risks

- Using config revision as the scope would reopen consent after harmless config edits. Use stable `identity.baseUrl` instead.
- A permissive event object would allow content to leak later. Use strict discriminated schemas.
