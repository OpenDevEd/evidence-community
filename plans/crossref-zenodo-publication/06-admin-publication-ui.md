# 06 — Admin activation and progress UI

## Goal

Add a compact publication panel to the item inspector where an administrator manually activates Crossref or Zenodo, watches persisted progress, resolves validation failures, retries dead letters, and opens or copies provider links.

## Scope

- Item-level publication status contract and SWR client.
- Manual activation controls and confirmation UI.
- Crossref and Zenodo progress, validation, receipts, retry, copy, and open actions.
- Browser, accessibility, responsive, dark/light, and computed-style verification.

## Design

Add a `Publication` section to `AdminInspector`, near the existing item/file publication actions. Keep it collapsed or compact when neither provider is activated.

Crossref states:

- Available / unsupported / blocked validation
- Reserving
- Queued
- Submitting
- Verifying
- Active
- Retrying
- Failed / needs attention

Zenodo states:

- Available
- Waiting for Crossref
- Waiting for PDF
- Queued
- Creating draft
- Uploading
- Publishing
- Active
- Creating version / correcting files
- Retrying
- Failed / needs attention

Crossref and Zenodo have separate activation controls. Zenodo defaults to `reuse-crossref`; the explicit `mint-zenodo` choice is shown before activation with a concise consequence. Once published, policy appears as read-only identity information.

Use SWR for conditional status polling and mutation invalidation. Fast refresh is enabled only for active transitional states; stable states use slow revalidation or event-driven invalidation. Do not add effects for polling or prop/state mirroring.

Activation responses immediately seed the SWR cache with the returned durable receipt. UI status always comes from the API contract. Errors identify the field or provider action in plain language.

## TDD sequence

1. Add contract tests for every state and transition.
2. Add component tests for supported/unsupported items, both activation choices, duplicate click prevention, pending progress, active identifiers, failure, and retry.
3. Add accessible-name, keyboard, focus-return, live-region, and disabled-state tests.
4. Implement SWR status/mutation hook and presentation components.
5. Add Playwright flows against the local full stack and deterministic fake-provider control endpoints.
6. Inspect screenshots and computed styles at desktop and narrow widths in dark and light themes.
7. Fix all overflow, popover/dialog width, spinner-size, alignment, and layout-shift defects before acceptance.

## Files touched

- `src/components/admin/AdminInspector.tsx`
- new `src/components/admin/AdminPublicationStatus.tsx`
- new `src/components/admin/AdminPublicationActivation.tsx`
- new `src/components/admin/useAdminPublication.ts`
- `src/components/admin/admin-api.ts`
- `src/components/admin/admin-schema.ts`
- new/updated admin component tests
- new `tests/e2e/admin-publication.spec.ts`
- `tests/acceptance/compose.yaml`, `tests/acceptance/fixture/publication-provider-fake.mjs`, and `playwright.config.ts` when needed to expose the deterministic full-stack harness
- `docs/admin-item-list.md`

## Migration stance

No hidden legacy controls and no automatic activation checkbox on item creation. Publication is available only through the new provider-specific controls.

## Exact test plan

```sh
npm run test:unit
npm run test:e2e -- --grep "publication"
npm run test:acceptance
npx tsc --noEmit
npm run lint
```

Browser verification must record:

- computed width, padding, height, alignment, overflow, and spinner/icon dimensions for the panel and confirmation surface;
- screenshots for unactivated, transitional, active, validation-error, and failed states;
- keyboard-only completion of both activation paths.

## Deployability/runtime gate

- The entire local stack, including the publication worker and deterministic provider fakes, is running.
- Progress survives page reload and worker restart.
- No browser path can represent production provider configuration.

## Acceptance criteria

- An administrator must explicitly activate each provider.
- Progress corresponds exactly to durable worker state.
- Users can copy/open active DOI and Zenodo links.
- Unsupported types explain why Crossref activation is unavailable.
- Retry is offered only for retryable/attention states.
- The interface is accessible, responsive, visually stable, and verified from computed CSS.

## Pitfalls

- Do not expose provider secrets or raw provider payloads.
- Do not use optimistic “Active” labels.
- Do not hide validation failures in toast-only feedback.
- Do not copy the existing effect-based writeback polling hook; use SWR.
