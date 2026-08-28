# Runtime analytics modernization

Modernize analytics for every Evidence Library tenant while keeping the same consent rules. Visitors who consent get useful product analytics. Visitors who decline send only safe, same-origin aggregate events. No analytics vendor loads before consent or after rejection.

Grounded on **2026-08-27** against `origin/main` at `f4e4f2584842a79f0a7f8eea69681dec694a5455`. The approved compact consent dialog and the implementation notes in `new-el-coolify` are the starting point, but this plan adapts them to the runtime JSON configuration used by this repository.

## Gap

1. Consent is one flat cookie. It is not tied to the current library or policy version.
2. `posthog-js` is imported before consent and its useful product features are disabled.
3. Rejected visitors produce no safe aggregate analytics, while consented PDF and AI events include titles, filenames, links, IDs, or prompt text.
4. Browser and server events use separate rules. A request body can provide the PostHog ID without the server checking consent.
5. The consent dialog is duplicated, large, and does not offer separate replay control.

## Fixed decisions

| ID | Decision | Result |
|---|---|---|
| D1 | Consent has three states: pending, denied, granted. Pending loads no browser analytics vendor. | No pre-consent PostHog or Google request. |
| D2 | A consent record includes the normalized `identity.baseUrl`, `analytics.consentPolicyVersion`, time, product analytics choice, and replay choice. | A decision never leaks between tenants or policy versions. |
| D3 | Rejected tracking uses one same-origin route and a rotating aggregate key. It never stores a visitor or session identity. | Page, attachment, results-count, and copy/export totals remain available without cross-session tracking. |
| D4 | Consented tracking enables PostHog product analytics, anonymous person profiles, safe autocapture, performance, heatmaps, error types, attribution, and optional fully masked replay. Google Analytics uses basic consent mode. | Maximum useful tracking starts only after consent. |
| D5 | Prompts, chats, responses, abstracts, search text, PDFs, filenames, titles, auth values, form values, URLs with queries, and fragments never enter analytics. | AI telemetry contains only mode, model, status, duration, and token counts. |
| D6 | The browser SDK is loaded with a dynamic import. A runtime config or tenant change tears down the previous client before applying the new one. | One app image can safely serve different tenants. |
| D7 | Browser capture goes through `src/lib/analytics.ts`; server capture goes through `src/lib/server-analytics.ts`. Direct SDK calls outside those files are removed. | One rule set controls all events. |
| D8 | The consent dialog is one shared compact component used by both the banner and footer. | No duplicate modal or dead locale strings. |
| D9 | `posthog-js` becomes `^1.421.1`, `posthog-node` becomes `^5.51.3`, and unused `@vercel/analytics` is removed. | Current SDK behavior without dead analytics packages. |
| D10 | No database migration. Development and hosted data stay untouched. | This is runtime config, cookie, browser, and event code only. |

## Plan

1. `01-runtime-contract-and-consent.md` — config fields, scoped consent record, strict event schema, generated artifacts.
2. `02-browser-and-server-gateways.md` — current SDKs, consent-aware browser client, Google basic mode, rejected route, safe server capture.
3. `03-event-instrumentation-and-policies.md` — replace unsafe PDF and AI events, add results and content-action events, compact dialog, locales, policy text.
4. `04-browser-and-acceptance-proof.md` — focused checks, full acceptance suite, browser proof for every consent transition and tenant change.

Order is strict: 01 → 02 → 03 → 04.

## Existing code to reuse

- Runtime config: `src/config/library-config/schema.ts`, `public.ts`, `config/library.example.json`, `tests/fixtures/library-config.ts`.
- Revision-aware server client: `src/lib/posthog-factory.ts`, `src/lib/posthog.ts`.
- Consent and Google defaults: `src/lib/analytics-consent.ts`, `src/app/_components/ConsentDefaultsScript.tsx`, `GoogleAnalyticsManager.tsx`.
- Provider boundary: `src/components/features/analytics/AnalyticsConsentProvider.tsx`, `src/context/Providers.tsx`.
- Existing event callers: `Attachment.tsx`, AI routes and `src/lib/ai.ts`.
- Approved design and safe event shapes: the matching files and `docs/COOLIFY_ANALYTICS_MODERNIZATION_NOTES.md` in `new-el-coolify`.
- Runtime logo: `src/components/layout/Logo.tsx` and the public identity config.

## Tests

- Test plain consent parsing and event validation first.
- Test the route as HTTP behavior and server capture as consent behavior.
- Test the provider and SDK boundary, not SDK internals or CSS classes.
- Use Playwright for the real consent dialog, network requests, tenant scope, replay toggle, and revocation.

## Data migration choice

None. Old flat consent cookies are intentionally invalid and reopen the dialog once.

## Agent use

No delegated agents. Keep the contract, tests, code, and browser proof in this task.

## Sources

- Google basic consent mode: https://developers.google.com/tag-platform/security/concepts/consent-mode
- Google consent setup: https://developers.google.com/tag-platform/security/guides/consent
- Installed PostHog 1.421.1 SDK types for `person_profiles` and replay masking.
- `new-el-coolify/docs/COOLIFY_ANALYTICS_MODERNIZATION_NOTES.md`.
