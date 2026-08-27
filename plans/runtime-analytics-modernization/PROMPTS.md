# Execution prompts

Run these prompts in order on branch `codex/runtime-analytics-modernization` in `/Users/mcharrad/Documents/Github/new-el-analytics-modernization`.

## Plan 01

```text
Implement plans/runtime-analytics-modernization/01-runtime-contract-and-consent.md after reading 00-README.md. Start with failing consent and event-schema tests. Reuse the runtime config and consent code named in the plan. Delete the old flat-cookie behavior. Run the exact tests and generated-config checks before committing. Do not push.
```

## Plan 02

```text
Implement plans/runtime-analytics-modernization/02-browser-and-server-gateways.md after Plan 01. Start with failing browser and server boundary tests. Preserve the revision-aware server factory. Load PostHog dynamically only after scoped consent, use basic Google consent mode, and delete direct SDK paths. Run the exact tests before committing. Do not push.
```

## Plan 03

```text
Implement plans/runtime-analytics-modernization/03-event-instrumentation-and-policies.md after Plan 02. Start with tests that fail if content enters analytics. Reuse the approved compact dialog and translations from new-el-coolify, adapted to runtime identity. Delete duplicate dialog markup and dead locale keys. Run focused tests and inspect real payloads. Do not push.
```

## Plan 04

```text
Implement plans/runtime-analytics-modernization/04-browser-and-acceptance-proof.md after Plans 01-03. Run the full checks once, clean the acceptance environment, and verify every consent state in the real browser. Fix failures at their source. Document only behavior that was actually proved. Do not push unless the user explicitly asks.
```
