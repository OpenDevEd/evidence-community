# 04 — Browser and acceptance proof

## Goal

Prove the new analytics behavior in the real runtime and leave no abandoned test environment.

## Scope

1. Run all focused unit and route tests.
2. Run changed-file checks and the full acceptance suite once.
3. Use the browser against the local runtime to inspect cookies, storage, script loads, event payloads, tenant switching, and revocation.
4. Record the verified behavior in `docs/analytics.md` and update the Coolify notes with main-runtime differences.

## Exact tests

```sh
npm run check:changed
npm run test:acceptance
npm run test:acceptance:cleanup
git diff --check
```

## Browser proof

1. Pending: dialog visible; no PostHog or Google script or request.
2. Denied: scoped cookie saved; only same-origin strict aggregate events; no vendor storage.
3. Granted without replay: both vendors work; PostHog profile and safe events exist; replay stays off.
4. Granted with replay: masked replay starts; inputs and page text are not present in payloads.
5. Revoked and tenant-changed: tracking stops, identity and vendor storage clear, and a different scope requires a new decision.

## Completion rules

- All required checks pass.
- Browser proof matches every line above.
- Acceptance cleanup reports no abandoned analytics test environment.
- The diff contains only this plan and implementation.

## Risks

- A passing unit test cannot prove that a browser SDK chunk was not downloaded. Check real network requests.
- A passing build cannot prove masked replay. Inspect the real replay payload.
