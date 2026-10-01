# Sign readers and admins in with OpenScholar

Status: decided on 2026-10-01, spike passed, ready to implement.

Issues: OpenDevEd/new-el#93 (Evidence Library) and
OpenDevEd/openalex-count#375 (OpenScholar). Work rules come from the root [`AGENTS.md`](../../AGENTS.md) and
[`docs/agents/project.md`](../../docs/agents/project.md).

## Problem

Libraries carry two separate login systems and neither is right:

- Reader login is a per-library email and password account on Auth.js v5 beta
  (`src/lib/auth-options.ts`, `src/lib/auth-service.ts`, `LoginModal.tsx`). It
  has no email verification, no password reset and no rate limit. Other
  readers' public profiles return their email. OpenScholar has no switch for
  `features.login`, so it has never been on in a library made by the new
  product.
- Admin login is a hand-written handoff: OpenScholar mints a one-time `elc_`
  code, the library redeems it and signs its own HMAC cookie
  (`src/lib/admin/access.ts`, `src/app/api/admin/session/route.ts`).

## Fixed decisions

1. OpenScholar's Clerk instance is the only account system for readers and
   admins. Clerk is the OAuth 2.1 and OIDC server through Clerk OAuth
   applications. Verification emails, password reset, Google sign-in, passkeys,
   optional MFA and bot protection come from Clerk. Passkeys, authenticator-app
   MFA and backup codes were turned on (optional) for production and
   development on 2026-10-01.
2. Each library has its own Clerk OAuth application: confidential client,
   consent screen off, PKCE required, scopes
   `openid email profile offline_access`. Its redirect URIs are
   `<origin>/api/auth/callback/openscholar` for every platform and custom
   origin of the library.
3. new-el uses Better Auth with the Generic OAuth plugin (provider
   `openscholar`, Clerk discovery URL), the Drizzle adapter and database
   sessions: 30-day sliding sessions (`expiresIn` 30 days, `updateAge` 1 day),
   a 5-minute `cookieCache`, `account.encryptOAuthTokens: true` and Better
   Auth's rate limiting. Auth.js, `@auth/drizzle-adapter`, `bcrypt`, password
   login and `authentication.google` are deleted.
4. Public pages never redirect. Only the "Sign in with OpenScholar" button,
   with the OpenScholar logo, starts sign-in. The button is mocked and
   approved before it is built. `/admin` without a session answers a 307 to
   the library's own `/api/admin/sign-in?return=<path>`, a GET route that
   starts the OAuth flow. OpenScholar's readiness check relies on that exact
   path (added 2026-10-01, see phase 1).
5. Background check: while a reader is active, the server refreshes the Clerk
   token at most every 15 minutes (`auth.api.getAccessToken`) and updates the
   stored name and avatar from Clerk's userinfo. Better Auth reports every
   refresh failure the same way, so on failure the library asks OpenScholar
   (machine credential) whether the Clerk user still exists. A deleted user is
   signed out and their reader data is deleted. An unreachable OpenScholar or
   Clerk keeps the session.
   Deletion does not wait for the reader to come back: OpenScholar's Clerk
   `user.deleted` webhook (already handled by `markUserDeletedFromClerk`)
   queues a durable, retried call to every active library's machine-credential
   endpoint `DELETE /api/v1/openscholar/readers/{clerkUserId}`, which removes the
   reader's user row, sessions, likes and collections. The background check is
   the second path for a library that missed the call.
6. Admins use the same session. The role still comes from OpenScholar's
   `/api/v1/evidence-libraries/admin-session/check` by Clerk user ID
   (`account.accountId`), cached for about one minute. Admin records keep
   storing the Clerk user ID (`submittedBy`, `requestedBy`, author profiles).
7. new-el shows the "no access" answer on `/admin` itself, reusing
   OpenScholar's copy: "You cannot open this admin area. Ask an admin of
   {organisation} to add you to the team that runs this library." The 403 from
   `admin-session/check` returns the organisation name. "Not set up yet" stays
   on OpenScholar's Open admin button.
8. Public profiles and `/api/user/items/[id]` stay public and show the name and
   avatar only. No response ever sends one reader's email to anyone else. An
   empty name shows as "Reader". The reader's own menu shows "Add your name",
   linking to the Clerk account page of the instance the library signs in
   with. OpenScholar writes it as `authentication.openScholar.accountUrl`
   (`https://accounts.openscholar.ai/user` in production, the development
   instance's Account Portal for dev and preview libraries).
9. Account settings (name, avatar, email, password, MFA, deletion) live in
   OpenScholar's Clerk account page. A library keeps only likes and personal
   collections. Following other readers is removed.
10. Reader accounts are one configuration switch, `features.readerAccounts`,
    replacing `features.login` and `features.userCollections`. OpenScholar's
    configuration page shows it. Admin sign-in does not depend on it.
11. Old reader data is dropped (user decision, 2026-10-01). Better Auth's
    tables get their own names through its `modelName` options
    (`reader_user`, `reader_session`, `reader_account`, `reader_verification`)
    so they never share a name with the old `user`, `account` and `session`.
    The rollback recreates the old tables empty beside them and leaves the
    Better Auth tables and the reader data saved on them in place, so rolling
    forward again finds it intact. Nothing written after the migration is
    discarded.

## Decisions from the approved mock (2026-10-01)

The mock lives on new-el branch `mock/openscholar-sign-in` (last commit
`86291c97`). It uses a fake session in `localStorage`; the shipped code takes
its components and wires them to Better Auth.

12. Decision 4's button changes. Old: a "Sign in with OpenScholar" button with
    the OpenScholar logo. New (user, 2026-10-01): a plain accent-filled "Sign
    in" button with a standard sign-in icon, icon-only with a tooltip on narrow
    screens. Reason: the branded pill clashed with every library theme. The
    OpenScholar mark appears only in the account menu ("Signed in with
    OpenScholar"), drawn in the text colour. Decision 4's no-redirect rule is
    unchanged.
13. Header: the navigation links, theme and language controls and the account
    control are laid out from server-measured widths written as container
    queries (`src/lib/navbar-fit.ts`, `NavbarFitStyles`). Theme and language
    always sit in a settings menu; languages open as a step inside it. The
    account menu holds the reader's name ("Reader" when empty), "Add your
    name" when empty, Profile, OpenScholar account (external) and Sign out.
14. Profile page: a card with a band of the reader's bookmark covers, the
    avatar, name, counts and first-bookmark month, "Share profile" (copies the
    link) and, on the reader's own profile, "Edit profile" ("Add your name"
    when empty) opening the OpenScholar account page. Below it the bookmarks
    use the library's own list (`ItemsList`) with the same search, scope, sort
    and help placement as `/lib`. Collections sit in a card in the filter
    column: each shows its first three covers as a stack; the chosen one fans
    out and shows its description and, for its owner, Edit. On phones a picker
    replaces the column. Changing collection or page returns to the top of
    the list, not the page.
15. Collections can be edited: name (24 characters), description (200) and
    private. A new collection starts private, because profiles are public.
    Deleting asks first and keeps the bookmarks. new-el adds
    `PATCH /api/user/collections/[id]` beside the existing create and delete.
16. The AI chat on a profile works on the list the reader is looking at: the
    profile sends its reader and collection as the chat's result set, and the
    chat's result tool applies the same filter as the list. The chat stays a
    dialog on profiles.
17. A private collection is visible only to its owner, in the list and in the
    chat. Today `getItems` ignores the 403 from `getProfileSearchFilter` and
    lists the whole library for someone else's private collection; that
    defect is fixed on its own, before phase 2.

## Spike evidence (2026-10-01)

Better Auth 1.7.7, Next 16.3.5 and drizzle-orm 0.45.2 against the development
Clerk instance, in a real browser:

- Public page stayed signed out with no redirect, with and without a live
  Clerk session. The button returned the reader signed in.
- `/admin` answered 307 to Clerk's authorize URL with PKCE (S256) and a state
  cookie, through `auth.api.signInSocial({ disableRedirect: true,
  returnHeaders: true })`.
- A forced token expiry refreshed server-side. Clerk rotated the refresh
  token. Three parallel refreshes all succeeded.
- Clerk rejected an unregistered redirect URI ("does not match any of the
  OAuth 2.0 Client's pre-registered redirect urls"). `PATCH
  /v1/oauth_applications/{id}` changed the URIs.
- `account.accountId` is the Clerk user ID. Email arrives verified.
- A user with no name arrives with an empty name.
- After deleting the Clerk user, refresh failed with "Failed to get a valid
  access token" and the Better Auth session stayed.
- Production accepted a throwaway OAuth application (HTTP 200, deleted at
  once), so the feature is available on the Pro plan.

Better Auth 1.7 notes: Generic OAuth providers use the core
`signIn.social` endpoint and `/api/auth/callback/<providerId>`.
`getAccessToken` takes Better Auth's account row `id`, not the provider's
account ID.

## Code to reuse

- `src/lib/admin/access.ts` `authorizeAdminSession`: the live role check stays;
  only the token source changes.
- `src/lib/admin/openscholar-bearer.ts` and the machine credential: unchanged
  service-to-service authentication.
- `src/proxy.ts` `getAdminRequestResponse`: keeps the method check and locale
  handling; the redirect target changes.
- OpenScholar `convex/evidenceLibraries/applicationSetupActions.ts`: already
  generates and encrypts per-library secrets; the OAuth application is created
  beside them and stored in `evidenceLibraryCredentials`.
- OpenScholar `convex/evidenceLibraries/configurationDeploymentActions.ts`:
  already computes `platformOrigins` and `customOrigins`; redirect URIs are
  synced there.
- OpenScholar `convex/lib/invitationDelivery.ts`: existing Clerk Backend API
  call pattern with `CLERK_SECRET_KEY`.
- OpenScholar `components/evidence-libraries/admin-panels.tsx`: no-access copy.
- Better Auth `test-utils` plugin (`createUser`, `login`, `getAuthHeaders`)
  replaces the faked admin cookies in tests.

## Phases and owners

### 1. OpenScholar: OAuth applications (OpenDevEd/openalex-count#375)

- Create, update and delete the library's Clerk OAuth application in setup,
  deployment (every origin change) and teardown. An origin change adds the new
  callback URI while keeping the old one, switches and verifies the runtime,
  and only then removes the old callback, so sign-in works on both origins
  during the cutover.
- Provisioning is recoverable. The application name carries the library ID.
  OpenScholar records the intent before calling Clerk and saves the
  application ID and encrypted secret in the same step that receives them. A
  retry first lists the instance's OAuth applications and adopts the one with
  this library's name instead of creating a second. Teardown deletes by the
  saved ID, or by name when the ID was never saved. Every Clerk failure logs
  the library ID, HTTP status, Clerk error code and `clerk_trace_id`.
- `admin-session/check` returns the organisation name with its 403.
- A machine-credential endpoint answers whether a Clerk user is active,
  deleted or unknown. Only "deleted" lets a library remove reader data.
- The Clerk `user.deleted` webhook queues the reader deletion call to every
  active library (decision 5), retried until each library confirms. A library
  that answers 404 has no such reader or runs software without readers, and
  counts as done.
- Readiness accepts both `/admin` answers (307 to the OpenScholar login page,
  or 307 to the library's own `/api/admin/sign-in`) until phase 3 ends,
  because libraries update their runtime one at a time.
- Existing dev libraries get an OAuth application.

Phase 1 changes nothing a running library receives, so it ships before
phase 2.

Correction on 2026-10-01: the earlier text had assembly choose the
authentication shape by each library's runtime commit. OpenScholar already
solves this: it pins one new-el commit as its configuration contract
(`lib/evidence-libraries/configuration/contract-lock.json`), and a publish to
a library whose runtime does not include that commit updates the runtime in
the same step (`publishRuntime` in `convex/evidenceLibraries/updates.ts`). The
new shape therefore arrives with the contract sync in phase 2b, and each
library takes it with its next publish.

### 2b. OpenScholar: contract sync (OpenDevEd/openalex-count#375)

After phase 2 merges:

- Sync OpenScholar's configuration contract to the phase 2 commit.
- Assembly writes `authentication.openScholar.oauth: { issuer, clientId,
  clientSecret }` and `accountUrl`, and no longer writes `google` or
  `loginPageUrl`.
- The configuration page shows `features.readerAccounts`.
- Each dev library is published once, which moves it to the phase 2 runtime.

Owner of the OAuth application and its redirect URIs: OpenScholar.

### 2. new-el: Better Auth (OpenDevEd/new-el#93)

- Better Auth module and `/api/auth/[...all]` route; Auth.js files and
  packages deleted; `drizzle-orm` raised to ^0.45.2.
- Reader UI moves to Better Auth's `useSession`; server routes use
  `auth.api.getSession`; follows removed; email never leaves the server for
  other readers; "Reader" fallback and "Add your name".
- Header from the mock (decisions 12 and 13): Sign in button, account menu,
  settings menu and measured layout. `LoginModal.tsx` is deleted.
- Admin on the same session; HMAC cookie, `/api/admin/session` routes,
  `src/lib/admin/open-scholar.ts` and `AdminSessionProvider` deleted;
  no-access page on `/admin`.
- Background check, and `DELETE /api/v1/openscholar/readers/{clerkUserId}`
  behind `requireOpenScholarBearer` (decision 5).
- The remote verification tools (`tools/adminSession.ts` and its callers:
  `verifyAdminItemBatchHttp`, `verifyAdminZoteroWriteback`,
  `verifyLinkedItemDraftLifecycle`, `verifyNativeFileHttp`,
  `verifySearchIndexerWorker`, `publicationSandboxQualification`,
  `runRuntimeAcceptance`) sign in through the real flow: a browser signs a
  development Clerk test user in with a Clerk sign-in token and testing token
  (`@clerk/testing`), and the tool reuses the library session cookie it gets
  back. This works against a deployed preview before `/api/admin/session` is
  deleted. Better Auth `test-utils` is for local tests only.
- Schema: `authentication.openScholar.oauth`, `accountUrl`,
  `features.readerAccounts`;
  `authentication.google`, `loginPageUrl`, `features.login` and
  `features.userCollections` removed. Regenerate OpenScholar's catalogs.
- Migration: drop the tables `user`, `account`, `session`,
  `verificationToken`, `authenticator`, `userCollection`,
  `itemToUserCollection`, `userToLikes` and `userToFollow`; create Better
  Auth's `reader_user`, `reader_session`, `reader_account`,
  `reader_verification` and the likes and collection tables on
  `reader_user`. Rollback: decision 11.
- `src/lib/emails/preview.ts` links to the library's `/admin`.
- Docs: `docs/cookie-inventory.md`, the public `docs/cookie-policy.md`,
  `docs/evidence-library-customization-map.md`,
  `docs/evidence-library-operations.md`.

Owner of sessions, reader data and the profile privacy rule: new-el.

### 2c. new-el: profile, collections and chat (OpenDevEd/new-el#93)

After phase 2, on the same session:

- The profile page from the mock (decision 14) replaces `Profile.tsx`. Its
  data lists a private collection only to its owner (today
  `getProfileForConfig` returns every collection's name to visitors).
- `PATCH /api/user/collections/[id]` and the collection dialog
  (decision 15); create and delete move to the new session.
- The chat's result set gains an optional reader list (reader ID and
  collection). The chat's result tool applies `getProfileSearchFilter` to it
  and refuses a private collection the asker cannot see (decisions 16
  and 17).

Before phase 2, as its own fix: `getItems` honours the 403 from
`getProfileSearchFilter` (decision 17).

### 3. Cleanup (OpenDevEd/openalex-count#375)

After every dev library runs the phase 2 runtime: delete `adminHandoff.ts`,
`adminHandoffActions.ts`, `adminLoginCodes.ts`, the redeem route, the
`evidenceLibraryAdminLoginCodes` table, the admin route and status page,
`lib/evidence-libraries/admin-handoff.ts`, `buildEvidenceLibraryLoginPageUrl`
and the old readiness answer. Open admin links straight to the library's
`/admin`.

## Checks

- new-el unit tests: session and role resolution, no-access answer, profile
  responses without email, the "Reader" fallback, deleted-user cleanup,
  unreachable-OpenScholar keeps the session, collection edits by the owner
  only, someone else's private collection refused in the list and in the
  chat, and the chat's reader result set.
- new-el e2e: admin and reader specs sign in through Better Auth `test-utils`;
  the fake OpenScholar keeps only `admin-session/check` and the user-exists
  endpoint.
- OpenScholar tests: OAuth application create, adoption after a create whose
  result was lost, redirect sync on domain change, delete on teardown, and the deletion fan-out with one library
  failing then retried, with the Clerk API faked at the HTTP boundary; one
  live create and delete against the development Clerk instance.
- One remote verification tool signs in through the Clerk test-user flow
  against a deployed preview.
- Final gate: CI green in both repositories, then a preview library against
  development Clerk in a real browser: sign in from the button, `/admin`
  redirect through `/api/admin/sign-in`, no-access page, rename in OpenScholar reaches the library, delete
  the Clerk user while they are away and the reader data disappears from the
  library without them visiting it. Sign-up is checked once by a
  person because Clerk's captcha blocks automation.

## Done when

- Readers and admins sign in only through OpenScholar in every dev library.
- No Auth.js, password, HMAC admin cookie or `elc_` code remains in either
  repository.
- No response exposes another reader's email.
- The final gate passed on a preview library.

## Risks

- Clerk publishes no price for OAuth applications. Creation works on Pro;
  the next invoice confirms there is no charge.
- Clerk refresh tokens never expire. The 30-day sliding session is the only
  lifetime limit.
- A custom-domain change that reaches the library before its redirect URI is
  registered breaks sign-in on that domain.
- Readers count toward Clerk's monthly retained users (50,000 free per
  application).
- Clerk Organizations are still off on production; turning them on belongs to
  the OpenScholar organisations release, not this plan.
