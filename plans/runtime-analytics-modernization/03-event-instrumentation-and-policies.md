# 03 — Events, consent dialog, and policies

## Goal

Track useful actions without sending library content, then make the choices clear in every locale.

## Scope

1. Replace PDF events with safe attachment metadata.
2. Replace AI usage events with model, mode, status, duration, and token counts only.
3. Add results-loaded events with counts, page, search-present, scope, sort, and consented categorical filters. Never send free-text search.
4. Add copy and export events for AI output, chat transcripts, generated content, library records, and screening results.
5. Replace the two old consent dialogs with one compact shared dialog using the runtime library logo.
6. Add product analytics and replay choices to all nine locales; remove dead chip text.
7. Rewrite stale analytics wording in the privacy and cookie policies.

## Test-first steps

1. Change AI analytics tests so prompt or response content makes the test fail.
2. Change attachment tests so filenames, titles, URLs, hashes, and user IDs are absent.
3. Add focused behavior tests for results and content actions.
4. Add consent-provider tests for save, accept all, decline, replay dependency, and tenant switch.
5. Implement shared UI and delete the duplicate old markup and unused locale keys.

## Files

- `src/lib/ai.ts` and AI route callers
- `src/components/features/items/Attachment.tsx`
- current results and copy/export controls found during implementation
- `src/components/layout/Banner.tsx`, `Footer.tsx`
- shared analytics consent components
- `src/messages/*.json`
- privacy and cookie policy pages
- focused tests

## Exact tests

```sh
npm test -- tests/unit/ai-usage-analytics.test.ts tests/unit/analytics-consent-provider.test.tsx tests/unit/runtime-analytics.test.ts
```

Run any existing focused tests for each results or content-action component changed.

## Runtime check

On desktop and mobile, use every consent button, change replay separately, search, open and download a file, use an AI action, copy and export. Inspect each request payload and verify it contains no content.

## Completion rules

- One consent dialog implementation is used everywhere.
- All nine locales show complete controls without scrolling in a normal mobile frame.
- No analytics call contains library content or free-text search.
- The policy pages describe the real pending, denied, granted, replay, and revocation behavior.

## Risks

- Autocapture can collect text unless it is blocked and sanitized. Mask text and inputs, block sensitive areas, and keep `before_send` as a final guard.
- Categorical filters must use a fixed allowlist; arbitrary query parameters are still content.
