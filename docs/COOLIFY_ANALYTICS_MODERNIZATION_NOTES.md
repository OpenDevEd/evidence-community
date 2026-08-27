# Coolify analytics modernization notes

This is the implementation journal for the consent-aware analytics rewrite on
`codex/coolify-analytics-modernization`. It exists so that the later `main`
branch implementation can reuse verified decisions and avoid repeating defects.

## Scope and base

- Started: 2026-08-27
- Base branch: `codex/ai-modernization`
- Base commit: `ad03f9634ec33731ee3b2444ed3ae8bc72d0a49d`
- Target in this branch: the Coolify/environment-configured application only
- Explicitly untouched: `main`, deployments, live vendor settings, commits, and
  pushes

## Confirmed product boundary

The implementation has three privacy states:

1. **Pending:** no browser analytics vendor is initialized.
2. **Rejected:** Google Analytics remains unloaded. The application may emit
   allowlisted, content-free aggregate operational events without a browser,
   user, or session identifier.
3. **Granted:** PostHog product analytics and consented Google Analytics are
   enabled. Session replay is a separate preference and remains subject to
   strict masking and blocking.

PostHog's daily-hash `cookieless_mode: "on_reject"` is not the default rejected
mode. It processes IP address and user-agent to derive same-day identity and is
reserved for a future explicitly approved legal/configuration mode.

## Non-negotiable data rules

- Never send AI prompts, chat contents, model responses, abstracts, search
  bodies, PDF contents, filenames, authentication values, or form values to
  analytics.
- AI telemetry is metadata only: feature, selected model, token usage, cost,
  duration, tool counts, success/failure, cache metadata, and a safe error
  category.
- Query strings and URL fragments are removed from analytics paths.
- Rejected aggregate events do not contain a browser distinct ID, session ID,
  OpenRouter generation ID, IP address, user-agent, referrer, UTM data, raw URL,
  item title, or filename.
- PostHog feature-flag evaluation is operational configuration, not user
  analytics, and stays isolated from consented event capture.

## Initial Coolify defects found

- `AnalyticsConsentProvider` initialized PostHog before reading the consent
  cookie.
- The browser SDK used `cookieless_mode: "on_reject"`, contradicting the policy
  and cookie inventory, which said PostHog did not load before consent.
- `ChatModal`, `InlineLibraryChat`, `AiWrapper`, and `useAIStream` imported
  `posthog-js` directly and read a distinct ID outside the consent gateway.
- `Attachment` sent overlapping Google and PostHog events through two different
  paths and included filenames, titles, URLs, account IDs, and a PostHog ID in
  the payload.
- `clearAnalyticsStorage` opted out but did not fully reset PostHog identity and
  persistence or explicitly stop session replay.
- Server AI telemetry used one static `anonymous-ai-user` identity for all
  requests without a client ID and forwarded OpenRouter generation IDs.
- The consent cookie held only `pending`, `granted`, or `denied`; it had no
  policy version, decision timestamp, or separate replay preference.
- The PostHog UI host was hardcoded to the US while the ingest host was
  configurable.
- `@vercel/analytics` is installed but no active application integration was
  found.

## Reusable implementation decisions

- All browser event capture must go through one browser analytics module. Direct
  `posthog-js` imports outside that module are forbidden.
- All server event capture must go through one server analytics module. Feature
  flag fetching may reuse the low-level PostHog client but must not emit user
  analytics.
- Server routes verify the consent cookie before linking an event to a
  client-provided distinct ID. A distinct ID in a request body is never proof of
  consent.
- Rejected operational metrics use `$process_person_profile: false` and a
  rotating aggregate key that cannot represent an individual visitor.
- Google remains in Basic Consent Mode: consent defaults are set to denied
  before any Google tag, and the tag itself is rendered only after consent.
- Revocation stops replay, disables capture, resets PostHog identity/persistence,
  clears Google cookies and attribution storage, and changes Google consent back
  to denied.

## Main branch port notes

When this work later moves to `main`:

- Preserve `main`'s runtime, per-library analytics configuration and
  revision-aware PostHog client factory. Do not port Coolify's environment
  adapter as the architecture.
- Add the privacy-mode and consent-policy fields to the library configuration
  schema rather than introducing new public environment variables.
- Consent must be namespaced/versioned per library so a changed controller,
  processor, or purpose can trigger a new choice.
- The browser and server event contracts from this branch should remain the
  behavioral authority, but tenant lifecycle and isolation should use `main`'s
  existing factories.
- Remove the raw AI prompt currently captured by `main`'s `src/lib/ai.ts`.
- Key the Google script lifecycle to the current tenant measurement ID and tear
  down the previous tenant's state when runtime configuration changes.

## Verification ledger

### Package and SDK findings

- Upgraded `posthog-js` from `1.266.0` to `1.421.1` and `posthog-node` from
  `4.3.2` to `5.51.3`.
- Removed unused `@vercel/analytics` and `@next/third-parties` dependencies and
  the stale Vercel Analytics package override.
- `npm install` still reports the repository's existing 19 dependency
  vulnerabilities (1 low, 4 moderate, 10 high, 4 critical). No broad or
  breaking `npm audit fix` was applied as part of the analytics scope.
- The current PostHog browser SDK accepts the `2026-06-25` defaults bundle.
- A static `posthog-js` import still downloads the SDK chunk before consent even
  if `posthog.init` is delayed. The browser gateway therefore uses a dynamic
  import that begins only after product-analytics consent. First-page captures
  wait on that initialization instead of being dropped.
- PostHog opt-out does not itself remove existing identity and persistence. The
  correct revocation sequence for this application is: stop replay, reset the
  identity/persistence, opt out, then clear remaining PostHog/Google storage.
- `posthog-node` v5 supports per-event `disableGeoip` and
  `$process_person_profile: false`. The persistent Coolify runtime keeps one
  buffered client rather than flushing synchronously on every request.

### Implemented event contract

- Consented browser events: sanitised page views, attachment actions, library
  result loads, successful copy/export actions, masked autocapture, performance,
  heatmaps, dead/rage clicks, safe client error categories, attribution, and
  optional fully masked replay.
- Rejected browser events: only the same-origin, schema-validated aggregate
  subset for page paths, attachment actions, result counts/search presence,
  and successful copy/export format/context.
- Server AI telemetry is always content-free. It links to a browser distinct ID
  only when both the versioned consent cookie and a valid ID are present;
  otherwise it uses the daily library aggregate identity.
- Library result telemetry keeps the full query/filter context only in a local
  React de-duplication key. Emitted properties include only search presence,
  filter count, scope/sort codes, page, and result counts.

### Legal and configuration findings

- The old policies referred to Clerk even though the application uses Auth.js.
  The rewritten policies and inventory now describe the active implementation.
- The policy retention values are targets, not proof of current vendor
  configuration. Before deployment, verify PostHog event retention (14 months),
  PostHog replay retention (30 days), Google Analytics retention (2 months), and
  aggregate-event retention (13 months) in their respective dashboards.
- Verify the configured PostHog ingest/UI region and Google Analytics property
  location before deployment. No live vendor setting was changed in this work.

### Automated verification so far

- All nine locale files now include the complete consent-preference copy:
  product analytics, optional session replay, saving selected preferences,
  declining, and accepting all. The accept action is explicitly labelled
  “Accept All & Continue” and translated in every supported locale.
- A complete locale-key audit found 11 pre-existing filter and citation-chart
  strings missing only from `en-US.json`. They were restored from the matching
  `en-GB` entries. After the repair, every locale has the full `en-GB` key set;
  Swahili retains one additional existing `rateLimitedMessage` key.
- `npm run test:analytics`: 10/10 tests passed on 2026-08-27. The suite includes
  import-boundary enforcement, consent parsing, server identity linking, strict
  rejected-event allowlisting, and URL sanitisation.
- `npm run test:ai`: 30/30 tests passed after the telemetry migration.
- `npx tsc --noEmit`: passed after the consent, gateway, server telemetry, and
  event-instrumentation changes.
- Targeted ESLint for the modified analytics, controls, result view, and chat
  files: passed.
- Production `npm run build`: passed. Static generation logged the pre-existing
  `No institutions found` message but generated all 188 pages and exited
  successfully.
- Full `npm run lint` remains blocked by 23 pre-existing errors in collections,
  statistics, unrelated hooks, and `tools/buildGapMap.js`; none were in the
  analytics modernization files.
- React Doctor could not calculate an uncommitted changed-file baseline and ran
  its full scan instead (existing repository score 34/100). Its two relevant
  findings were fixed: consent-form draft synchronisation no longer uses a
  state-setting effect, and record-download object URLs are revoked.

### Browser network and storage verification

Verified locally at `http://localhost:3300/lib` with isolated browser sessions:

- Pending: consent dialog visible; no consent cookie, PostHog/Google storage,
  PostHog SDK chunk, PostHog network request, or Google tag request.
- Rejected: only the versioned necessary consent cookie remained. Page and
  result events posted to the same-origin `/api/analytics/events` endpoint and
  returned `202`; captured bodies contained only path, search presence,
  filter/result counts, and fixed scope/sort codes. No vendor browser request or
  vendor storage was created.
- Product analytics only: the PostHog SDK and Google tag were requested only
  after saving consent. PostHog created its random browser identity and applied
  `session_replay_enabled: false`; no recorder script was loaded.
- Product analytics plus replay: the recorder script loaded only after “Accept
  all”, and the consent record stored replay as enabled.
- Revocation: replay stopped; PostHog cookies, `ph_*`, `__ph_*`, and session
  storage were cleared; Google was disabled; only the denied consent record and
  unrelated application storage remained.

The configured PostHog project labels localhost as an internal/test user, so it
returned feature configuration but suppressed local event ingestion. The
Google tag request also did not complete in the headless browser environment.
Consent state, initialization timing, data-layer updates, replay loading, local
event payloads, and storage cleanup were verified; live vendor receipt still
needs confirmation after deployment or with vendor test-user filtering changed.
