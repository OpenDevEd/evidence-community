# Analytics

Each Evidence Library controls analytics through its runtime JSON. Browser
analytics starts only after the visitor chooses it. Session replay is a
separate choice.

## Runtime configuration

```json
{
	"analytics": {
		"posthog": {
			"host": "https://analytics.example.org",
			"uiHost": "https://analytics-ui.example.org",
			"key": "phc_1234567890123456"
		},
		"consentPolicyVersion": 1,
		"google": {
			"measurementId": "G-ABCD1234"
		},
		"utmDurationSeconds": 2592000
	}
}
```

- `posthog.host` is the browser and server ingestion origin.
- `posthog.uiHost` is the PostHog dashboard origin. Omit it when it is the same
  as the ingestion origin.
- `posthog.key` and `posthog.host` must be set together.
- `google.measurementId` enables Google Analytics after consent.
- `consentPolicyVersion` starts at `1`. Increase it only when the analytics
  purpose, controller, processor, or data use changes enough to require a new
  choice.
- `utmDurationSeconds` controls how long consented campaign attribution stays
  in local storage.

Run `npm run config:validate -- /path/to/library.json` before activating a
changed configuration.

## Consent states

### No choice yet

PostHog and Google Analytics stay unloaded. The site creates no analytics
identity, analytics cookie, or analytics session.

### Declined

The browser vendors stay unloaded. The application may send these strict,
same-origin aggregate events:

- page path without a query string or fragment;
- attachment action, source type, record type, locale, and signed-in state;
- result counts, page, search presence, filter count, scope, and sort;
- successful copy or download action, context, and format.

The server validates every field. It sends accepted events to PostHog with
geolocation disabled, person profiles disabled, and one tenant-specific daily
aggregate ID. It does not create a visitor profile or link activity across
days.

### Product analytics allowed

PostHog and Google Analytics start after consent. PostHog receives safe page,
attachment, result, copy, download, performance, heatmap, interaction, and
error-category events. Google advertising storage, advertising user data, and
personalisation remain disabled.

PostHog uses a random pseudonymous browser profile. The application does not
attach a name or email address to it.

### Session replay allowed

Replay starts only when both product analytics and session replay are enabled.
The bundled recorder masks text, input values, element IDs, links, images and
other content attributes. It keeps styles, classes, SVG geometry and visual
state attributes so the recording retains its layout, while removing CSS URLs.
It does not record request or response bodies, headers, canvas content, console
logs, or cross-origin frames.

## Data that analytics must never receive

- search words or full URLs with query strings;
- AI prompts, chat messages, model responses, or transcripts;
- abstracts, PDF text, titles, filenames, or link text;
- form values, authentication credentials or tokens, names, or email addresses.

AI events contain only the model, status, finish reason, duration, and token or
cache counts. A server event uses the browser's PostHog ID only when the request
has a valid consent record for the current library and both policy versions.

## Changing or withdrawing consent

The **Cookie settings** control opens the same preferences dialog used for the
first choice. Withdrawing product analytics:

1. Stops session replay.
2. Resets and opts out the PostHog client.
3. Removes known PostHog and Google cookies and browser storage.
4. Changes Google consent back to denied.
5. Keeps only the necessary, tenant-scoped consent record for 180 days.

A consent record is valid only for the configured library origin, the library's
`consentPolicyVersion` and the application's built-in `runtimePolicyVersion`.
Moving between libraries or changing either policy version asks the visitor
again. A record without the built-in version is also invalid.

## Deployment checks

Before enabling analytics for a library, verify all four states in the real
browser network and storage panels:

1. No choice: no PostHog or Google request, script, or storage.
2. Declined: only valid same-origin aggregate requests; no browser vendor.
3. Product analytics: PostHog and Google requests work; replay stays off.
4. Replay enabled, then revoked: snapshot events arrive only while enabled and
   vendor storage is cleared after revocation.

Also verify PostHog event retention, replay retention, Google data retention,
the PostHog ingest and dashboard regions, and the Google property location in
their dashboards. Runtime configuration cannot prove those vendor settings.

Use `npm run test:acceptance` for the configured runtime checks. Always finish
with `npm run test:acceptance:cleanup` so no abandoned test environment remains.
