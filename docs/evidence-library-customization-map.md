# Evidence Library Customization Map

## Purpose

This document maps how an Evidence Library deployment is customized today. It records:

- what can be customized;
- where each value lives;
- when it takes effect;
- which code consumes it;
- where tenant-specific behavior is still hardcoded.

This is an inventory and migration map for making every existing
library-specific customization runtime-configurable. It does not depend on
OpenScholar.

## Current architecture at a glance

Customization is not controlled by one source. It is spread across five systems:

| Source | What it controls | When changes apply |
| --- | --- | --- |
| Build and runtime environment variables | Colors, layout style, locale behavior, search fields, tags, service connections, models, analytics | Most `NEXT_PUBLIC_*` values require a rebuild because Next.js inlines them into the browser bundle |
| PostgreSQL `status` row | Library name, logo sizing, navigation, footer, social links, legal links, export URLs | Runtime; cached by the app for 60 seconds |
| External navigation JSON | Navigation, footer sections, social links, contact details, legal links | Runtime; fetched and cached for 60 seconds |
| Runtime manifest feature switches | Visibility of optional UI and product features | Runtime; validated when the manifest is loaded |
| Repository files and hardcoded branches | Logos, favicons, manifests, translations, institution logos, tenant-specific layouts | Requires changing the repository and rebuilding |

### Effective precedence

The current precedence is:

1. Tailwind style and colors: environment variable, then `src/constants/config.json`, then a hardcoded default.
2. Identity, navigation, and footer: PostgreSQL `status` row.
3. Navigation and footer only: `EXTERNAL_NAV_SOURCE_URL` overrides the corresponding `status` fields when it returns successfully.
4. Feature availability: typed booleans under the runtime manifest's `features` object.
5. Tenant-specific component branches and bundled assets override the general rendering path where they exist.

## 1. Deployment environment

The deployment contract begins in `Dockerfile`.

The Docker build currently accepts 20 application configuration arguments in addition to `RUNTIME_IMAGE`. The build arguments matter because:

- Next.js inlines `NEXT_PUBLIC_*` values into the client bundle;
- `next.config.mjs` reads values while generating configuration and rewrites;
- cached server routes can execute during the Next.js build;
- icon generation runs before `next build`.

### Build arguments passed by Docker

#### Data and service selection

| Variable | Purpose | Main consumers |
| --- | --- | --- |
| `BASE_URL` | Public base URL and fallback canonical URL | `next.config.mjs`, site URL and metadata helpers |
| `EXTERNAL_NAV_SOURCE_URL` | Optional external navigation/footer JSON endpoint | `src/lib/external-nav.ts` |

The runtime manifest now selects the tenant data services without a rebuild:

| Manifest field | Purpose | Main consumers |
| --- | --- | --- |
| `services.database.url` | PostgreSQL database for this library revision | `src/db/index.ts` |
| `services.search.host` | Meilisearch server for this library revision | `src/lib/meilisearch.ts` |
| `services.search.key` | Meilisearch API key for this library revision | `src/lib/meilisearch.ts` |
| `services.search.index` | Tenant document index and shared-index namespace | Search, caches, redirects, sitemap, citations, and AI routes |

#### Identity and visual styling

| Variable | Purpose | Main consumers |
| --- | --- | --- |
| `NEXT_PUBLIC_COMPANY_NAME` | Legacy library identity fallback | Policy helpers that have not yet moved to the manifest |
| `NEXT_PUBLIC_STYLE` | `"small"` or `"wide"` layout variant | `tailwind.config.ts`, navbar, footer, main wrapper, map, base font |
| `NEXT_PUBLIC_ACCENT_COLOR` | Accent palette name or raw color | `tailwind.config.ts` |
| `NEXT_PUBLIC_LINK_COLOR` | Link palette | `tailwind.config.ts` |
| `NEXT_PUBLIC_COLLECTION_COLOR` | Collection palette | `tailwind.config.ts` |
| `NEXT_PUBLIC_DOI_COLOR` | DOI palette | `tailwind.config.ts` |
| `NEXT_PUBLIC_TERTIARY_COLOR` | Dark and optional light tertiary colors | `tailwind.config.ts` |
| `NEXT_PUBLIC_DEFAULT_THEME` | Initial theme; defaults to `dark` | `src/context/Providers.tsx` |
| `NEXT_PUBLIC_FORCED_THEME` | Locks the deployment to one theme | `src/context/Providers.tsx` |

#### Locale behavior

| Variable | Purpose | Main consumers |
| --- | --- | --- |
| `NEXT_PUBLIC_ONLY_LOCALE` | Restricts the deployment to one locale | `src/i18n/routing.ts` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | Default locale; defaults to `en-GB` | `src/i18n/routing.ts` |
| `NEXT_PUBLIC_LOCALE_DETECTION` | Enables or disables locale detection | `src/i18n/routing.ts` |
| `NEXT_PUBLIC_LOCALES_PRIORITY` | Orders locale choices | `src/hooks/useSortedLocales.ts` |

#### Search, filters, and content semantics

| Variable | Purpose | Main consumers |
| --- | --- | --- |
| `NEXT_PUBLIC_DISABLE_FULLTEXT` | Removes full-text fields from search | `src/lib/search.ts`, `src/lib/actions.ts` |
| `NEXT_PUBLIC_DISABLE_TAGS` | Removes tags from search | `src/lib/search.ts`, `src/lib/actions.ts` |
| `NEXT_PUBLIC_DISABLE_COUNTRY` | Disables item-country behavior | Search actions and item rendering |
| `NEXT_PUBLIC_DISABLE_AUTHOR_COUNTRY` | Disables author-country behavior | Search actions |
| `NEXT_PUBLIC_DISABLE_EMBEDDINGS` | Disables embeddings and related-resource paths | Item pages, AI wrapper, embeddings API |
| `NEXT_PUBLIC_DEFAULT_EXPANDED_COLLECTIONS` | Default collection expansion state | `src/components/features/collections/CollectionsList.tsx` |
| `NEXT_PUBLIC_CUSTOM_FILTER_INSTITUTION` | Selects a custom institution-filter mode/value | `src/constants/misc.ts` and filter UI |
| `NEXT_PUBLIC_INSTITUTIONS_NAME` | Re-labels institutions | `src/constants/misc.ts` consumers |
| `NEXT_PUBLIC_IS_COUNTRY_LIBRARY` | Enables country-library behavior and longer cache periods | `src/constants/misc.ts`, `src/app/api/cache.ts` |
| `NEXT_PUBLIC_FUNDING_PARTNER` | Funding-partner label/content | `src/constants/misc.ts` consumers |
| `NEXT_PUBLIC_ITEM_NOTES_DESCRIPTION` | Custom description for item notes | `src/constants/misc.ts` consumers |
| `NEXT_PUBLIC_SHOW_URL_IN_CITATION` | Includes the source URL in citations | Citation rendering |

#### Tag conventions

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_COMING_SOON_TAG` | `_comingsoon` | Marks coming-soon records |
| `NEXT_PUBLIC_INTERNAL_TAG` | `internal` | Marks internal records |
| `NEXT_PUBLIC_HIDE_TAG` | `hide` | Excludes records from results |
| `NEXT_PUBLIC_DESCRIPTION_TAG` | `_category_description` | Identifies collection description records |
| `NEXT_PUBLIC_PUBLISH_TAGS` | `_publish,publishPDF` | Controls publishing-related tags |

These are defined in `src/constants/items.tsx`.

`NEXT_PUBLIC_REDIRECTS_TAG` is also read there, with `_redirects` as its default, but it is not currently forwarded by `Dockerfile`.

#### AI, analytics, and contact

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_ANTHROPIC_MODEL` | Anthropic model selection |
| `NEXT_PUBLIC_DEEPSEEK_MODEL` | DeepSeek model selection |
| `NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_MODEL` | Google model selection |
| `NEXT_PUBLIC_MISTRAL_MODEL` | Mistral model selection |
| `NEXT_PUBLIC_OPENAI_MODEL` | OpenAI model selection |

PostHog, Google Analytics, and the UTM attribution duration are runtime
configuration fields: `analytics.posthog.host`, `analytics.posthog.key`,
`analytics.google.measurementId`, and `analytics.utmDurationSeconds`.

### Server-only environment customization

The source also reads server variables that are not all declared as Docker build arguments:

| Area | Variables |
| --- | --- |
| Public URL | `NEXT_PUBLIC_CANONICAL_BASE_URL` |
| AI credentials | Provider SDK credentials such as `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, and `DEEPSEEK_API_KEY`; `tools/tl.js` separately reads `GEMINI_API_KEY` |
| Generation jobs | `SHOULD_GENERATE_SITEMAP`, `SHOULD_GENERATE_STATIC_PAGES`, `SHOULD_GENERATE_REDIRECTIONS` |

`.env.example` does not currently represent the full source-level environment contract.

Authentication is configured at runtime through
`authentication.secret`, `authentication.google.enabled`,
`authentication.google.clientId`, and
`authentication.google.clientSecret`.

Contact and takedown delivery are configured at runtime through
`email.contactRecipient`, `email.takedownRecipient`, and `email.smtp`.

## 2. PostgreSQL runtime status

The `status` table is defined in `src/db/schema/tables/status.ts`.

| Field | Current meaning | Main consumers |
| --- | --- | --- |
| `companyName` | Displayed library/company name and logo folder key | Navbar logo, footer, policy documents |
| `companyLogo` | Serialized logo style string, not an image URL | Navbar, footer, consent banner |
| `links` | Navigation links and fallback footer links | Navbar and footer |
| `externalLinks` | Social links keyed by provider | Footer |
| `docsLink` | Documentation URL | Status consumers |
| `style` | Stored style value | No active rendering consumer was found; layout uses `NEXT_PUBLIC_STYLE` instead |
| `allRISURL` | Full-library RIS export URL | Download/export UI |
| `allBibTeXURL` | Full-library BibTeX export URL | Download/export UI |
| `totalRecords`, `totalItems`, `databaseUpdatedAt` | Library statistics and freshness | Statistics/status UI |

`getCachedStatus()` in `src/app/api/cache.ts` caches this row for 60 seconds.

### Logo style serialization

`companyLogo` is parsed by `convertStringFromDatabaseToObject()` in `src/lib/utils.ts`.

Its current format is a comma-separated list of placement/style pairs:

```text
navbar|width: 180px; height: 42px, footer|width: 232px, splash|width: 180px
```

The supported placement keys are determined by component calls, currently `navbar`, `footer`, and `splash`. The CSS declarations are converted to inline React styles.

### Navigation link structure

Each entry in `status.links` uses the `LinkObject` type:

```ts
{
  label: string;
  href: string;
  icon?: string;
  dropdown?: LinkObject[];
  navExclude?: boolean;
  footerExclude?: boolean;
  id?: string;
  section?: string;
}
```

- `navExclude` hides the link from navigation.
- `footerExclude` hides it from the footer.
- `dropdown` creates nested navbar links.
- `section` groups fallback footer links.
- `id: "contact"` identifies the contact route.
- Known icons must exist in `src/constants/links.ts`.

## 3. External navigation and footer

`EXTERNAL_NAV_SOURCE_URL` is the only existing general-purpose external customization endpoint.

`src/lib/external-nav.ts` expects:

```json
{
  "links": [],
  "footerSections": [
    {
      "title": "Section title",
      "links": [{ "label": "Link", "href": "/path" }]
    }
  ],
  "externalLinks": {
    "github": "https://github.com/example",
    "linkedin": "https://linkedin.com/company/example"
  },
  "companyFooter": {
    "email": "hello@example.org",
    "address": "Address",
    "privacyPolicy": "/privacy",
    "termsOfService": "/terms"
  },
  "policyLinks": [
    { "label": "Cookie policy", "url": "/cookies" }
  ]
}
```

Behavior:

- relative links are resolved against the source endpoint's origin;
- the response is cached for 60 seconds;
- external `links`, `footerSections`, and `externalLinks` replace the database values;
- external `companyFooter` values merge over database footer values;
- a failed request falls back to the database `status` row;
- there is no runtime schema validation before the data is mapped.

The merge happens in `src/components/layout/Base.tsx`.

## 4. Styling and themes

### Color system

`tailwind.config.ts` builds Tailwind palettes for:

- `accent`;
- `link`;
- `collection`;
- `doi`;
- `tertiary` and `tertiary_light`.

Each configurable base color is expanded into numbered variants. A value can be:

- a preset name;
- a raw hex or `rgb(...)` color;
- a dark/light pair separated by `|`.

Preset names currently hardcoded in `tailwind.config.ts`:

`opendeved`, `edtechhub`, `ekitabu`, `openalex`, `jacob`, `kaleidoscopio`, `jimma`, `fcdo`, `unlockingdata`.

Because these palettes are generated by Tailwind, changing them requires rebuilding the application.

Background, card, primary, and secondary palettes are fixed in `tailwind.config.ts`; they are not tenant-configurable.

### Layout style

`NEXT_PUBLIC_STYLE` supports two declared values:

| Value | Effect |
| --- | --- |
| `small` | Card-like navbar, Ubuntu font, extra top spacing, compact map positioning |
| `wide` | Full-width navbar, Montserrat font, uppercase/smaller navigation treatment |

Consumers:

- `src/components/layout/Base.tsx`
- `src/components/layout/MainWrapper.tsx`
- `src/components/layout/Footer.tsx`
- `src/components/layout/navbar/index.tsx`
- `src/components/layout/navbar/NavLinks.tsx`
- `src/components/pages/Map.tsx`
- `src/types/navbar.ts`

`status.style` does not currently drive these components.

### Theme

`src/context/Providers.tsx` uses `next-themes` with:

- `NEXT_PUBLIC_DEFAULT_THEME`, defaulting to `dark`;
- `NEXT_PUBLIC_FORCED_THEME`, which prevents user choice when set;
- `features.themeSwitcher`, which controls whether the switcher is shown.

## 5. Logos, icons, manifests, and static assets

Tenant asset bundles live under:

```text
public/logos/<lowercase company name>/
```

There are currently 20 tenant directories:

`adapt dev`, `aime`, `climate change evidence library`, `edtech hub`, `edu-works`, `education in malawi`, `education sector evidence architecture`, `ekitabu`, `ethiopia`, `evidence fund`, `implementation science`, `jimma university`, `kaleidoscopio`, `kenya`, `mathematics education`, `openalex`, `opendeved`, `programa potenciar`, `technology in education`, `unlocking data`.

### Runtime logo lookup

Navbar and footer logos are derived from `status.companyName`:

```text
/logos/<lowercase company name>/logo.png
/logos/<lowercase company name>/logo_light.png
```

Consumers:

- `src/components/layout/navbar/Logo.tsx`
- `src/components/layout/Footer.tsx`

This means a new company name must exactly match a bundled directory name.

### Build-time icon generation

`npm run build` runs `tools/generateIcons.ts` before `next build`.

The script:

1. uses `NEXT_PUBLIC_COMPANY_NAME`, falling back to `status.companyName`;
2. reads `public/logos/<company>/app`;
3. copies selected favicon/app-icon files into `src/app`;
4. copies `public/logos/<company>/public` into `public`;
5. prefers SVG when duplicate icon formats exist.

Changing favicons or manifests therefore requires a rebuild and currently mutates the working tree during the build.

### Institution assets

Institution logos are separately hardcoded in:

- `public/institutions/`
- `src/constants/items.tsx` as `INSTITUTION_LOGOS`

Adding an institution logo currently requires a code and asset change.

## 6. Locales and copy

Locale routing is defined in `src/i18n/routing.ts`.

Bundled locales:

`en-GB`, `en-US`, `de`, `ar`, `hi`, `fr`, `cn`, `sw`, `pt`.

Translation messages live in:

```text
src/messages/*.json
```

Current constraints:

- locale availability is fixed by source code, except for restricting a deployment to one locale;
- adding a locale requires code, translation files, and a rebuild;
- navigation labels beginning with a lowercase letter are treated as translation keys;
- labels beginning with an uppercase letter are rendered literally;
- `features.languageSwitcher` controls whether the switcher is visible.

## 7. Runtime feature switches

Feature availability is read directly from the validated runtime library
manifest. Components use the typed selector in
`src/config/library-config/features.ts`; client components access it through
`useLibraryFeature`.

Approved feature IDs:

| Area | Manifest fields |
| --- | --- |
| Navigation and account | `themeSwitcher`, `languageSwitcher`, `login`, `navbarSearch`, `userCollections` |
| AI and related content | `ai`, `aiSearch`, `deepResearch`, `relatedResources` |
| Library structure | `collections`, `collectionNotes`, `yearsDropdown`, `countryFocus`, `authorFilter`, `authorLocation` |
| Exports | `downloads`, `atomFeed` |

Parent/child and service dependencies are enforced by the manifest schema.
Invalid combinations never activate. For example, `relatedResources` requires
embeddings and `userCollections` requires login.

The main consumers are:

- `src/config/navbar.config.ts`
- `src/hooks/useFilters.ts`
- `src/components/pages/EvidenceLibrary.tsx`
- `src/components/pages/Profile.tsx`
- `src/components/features/collections/CollectionsList.tsx`
- `src/components/features/resources/ResourcesView.tsx`
- `src/components/features/newlib/`
- `src/components/features/items/`

## 8. Bundled library configuration

`src/constants/config.json` is a repository-bundled configuration file used by both server and build code.

Top-level controls:

| Key | Purpose |
| --- | --- |
| `index` | Default Meilisearch index |
| `yearsDropDown` | Legacy/bundled year-filter configuration |
| `baseURL` | Default base URL |
| `style` | Fallback layout style |
| `accent` | Fallback accent |
| `structure_rules` | Structured content rules |
| `pdf_rules` | PDF processing rules |
| `shared_rules` | Shared processing rules |
| `prompts` | AI prompt templates/configuration |
| `collections` | Per-index collection definitions |

It currently contains collection profiles for 20 indexes:

`itemsAdaptdev`, `itemsAime`, `itemsClimate`, `itemsEdtech`, `itemsEef`, `itemsEkitabu`, `itemsEthiopia`, `itemsFCDO`, `itemsFull`, `itemsIs`, `itemsJacob`, `itemsKenya`, `itemsMalawi`, `itemsMathlib`, `itemsMaths`, `itemsOpenAlex`, `itemsOpenDeved`, `itemsPrograma`, `itemsTesting`, `itemsUnlockingData`.

Consumers include:

- `next.config.mjs`
- `tailwind.config.ts`
- `src/lib/search.ts`
- `src/lib/actions.ts`
- `src/lib/citations.ts`
- `src/lib/gapmaps.ts`
- `src/proxy.ts`
- sitemap, item, collection, citation, redirect, and AI API routes

Changing this file requires changing the repository and rebuilding.

## 9. Data, URLs, and generated outputs

### Library dataset

The combination of these values selects the library's data:

- `services.database.url`
- `services.search.host`
- `services.search.key`
- `services.search.index`

They are loaded from one validated runtime manifest revision. Each request
uses that same revision when resolving PostgreSQL, Meilisearch, and cached
collection data.

### Image hosting

`next.config.mjs` contains a fixed remote-image allowlist and a fixed `/images/:path*` rewrite to:

```text
https://ocivvlhqiwtxvnycqnia.supabase.co/storage/v1/object/public/new-kerko/:path*
```

The image store is not externally configurable.

### Exports

Per-library bulk export URLs come from:

- `status.allRISURL`
- `status.allBibTeXURL`

Visibility is controlled by `features.downloads` and `features.atomFeed`.

## 10. Hardcoded tenant behavior

The largest explicit tenant branch is in `src/components/layout/Footer.tsx`:

```ts
if (companyName === "EdTech Hub") {
  // Render a separate EdTech Hub footer.
}
```

That branch contains:

- a unique footer layout;
- EdTech Hub-specific funding and disclaimer copy;
- `/assets/edtechfooter.webp`;
- hardcoded EdTech Hub and OpenDevEd URLs;
- bundled OpenDevEd logo assets.

Other repository-bound customization includes:

- color preset names in `tailwind.config.ts`;
- company logo folder naming;
- institution logo mappings;
- locale names and message bundles;
- navbar icon mappings;
- fixed default background/card palettes;
- fixed image hosts and Supabase rewrite;
- the single current item page in `src/components/features/newlib/ItemPage.tsx`.

## 11. Current gaps and conflicts

These are present in the current customization system:

1. There is no single library configuration object or schema.
2. Visual changes are mostly build-time, while navigation and flags are runtime.
3. `status.style` exists but does not control the rendered style.
4. `companyLogo` stores CSS-like text while the logo image itself is inferred from a repository folder.
5. Remaining status-row identity and export data should move into the runtime manifest.
6. `EXTERNAL_NAV_SOURCE_URL` validates neither the response shape nor individual values.
7. `.env.example`, `Dockerfile`, and source-level environment reads have drifted apart.
8. `NEXT_PUBLIC_REDIRECTS_TAG` is used by source but omitted from the Docker build contract.
9. A quick-chat path reads the misspelled `NEXT_PUBLIC_NEXT_PUBLIC_DISABLE_EMBEDDINGS`.
10. Build-time icon generation copies tenant files into shared source/public locations.
11. The EdTech Hub footer bypasses the general customization model.
12. Several configuration systems overlap: environment disables, PostHog flags, `config.json`, and database values.

## 12. Intended runtime configuration

Every library-specific value will move into one external, versioned
`library-config.json` manifest. The Evidence Library will receive one
server-only bootstrap value:

```text
LIBRARY_CONFIG_URL=https://configuration.example.org/libraries/example/library-config.json
```

The manifest stays outside the repository and Docker image. Publishing a new
manifest revision changes the library without rebuilding it.

### Runtime configuration flow

1. A server module fetches `LIBRARY_CONFIG_URL` at request time.
2. A schema validates the complete manifest before it reaches application code.
3. The server retains the last valid revision and rejects invalid revisions.
4. Server Components read the complete configuration.
5. A safe browser projection is passed through `LibraryConfigProvider`.
6. CSS variables are written onto the root document for runtime styling.
7. A revision change invalidates the configuration cache.

The implementation seam should be concentrated in:

```text
src/config/library-config/schema.ts
src/config/library-config/server.ts
src/config/library-config/public.ts
src/context/LibraryConfigProvider.tsx
```

Application code must read library customization through this interface rather
than reading `process.env`, the `status` row, PostHog, or tenant files directly.

### Destination of every current customization system

| Current customization | Runtime destination | Required refactor |
| --- | --- | --- |
| `NEXT_PUBLIC_*` identity values | `identity` | Replace environment reads with the configuration interface |
| Tailwind colors | `theme.colors` | Define Tailwind color tokens using CSS variables and populate the variables at runtime |
| `NEXT_PUBLIC_STYLE` | `theme.layout` | Keep all layout classes in the shared image and select the variant from configuration |
| Default and forced theme | `theme.defaultMode`, `theme.forcedMode` | Feed runtime values into `ThemeProvider` |
| Company logos | `identity.assets.logoDark`, `logoLight` | Render configured URLs instead of deriving repository paths |
| Favicons and icons | `identity.assets.favicon`, `identity.assets.icons` | Serve configured stable public URLs through runtime metadata routes |
| Font selection | `theme.fonts` | Load supported fonts generically and select them with runtime CSS variables/classes |
| PostgreSQL `status` identity | `identity` | Stop using the status row as presentation configuration |
| `status.companyLogo` styles | `identity.assets.logoStyles` | Apply the configured raw CSS string directly |
| `status.links` | `navigation` | Read navigation from the manifest |
| Unused `status.docsLink` | None | Delete the unused field instead of exposing redundant configuration |
| `status.externalLinks` | `footer.socialLinks` | Read social links from the manifest |
| `status.companyFooter` | `footer`, `legal`, `contact` | Move footer data out of the status row |
| Bulk export URLs | `exports` | Read export endpoints from the manifest |
| `EXTERNAL_NAV_SOURCE_URL` | `navigation`, `footer`, `legal`, `contact` | Fold the existing external-nav fields into the full manifest and remove the separate fetcher |
| Runtime feature switches | `features` | Complete: typed manifest booleans with schema activation rules |
| Search disable variables | `search` | Read enabled fields and capabilities from the manifest |
| Filter variables | `filters` | Read labels, visibility, defaults, and modes from the manifest |
| Tag variables | `content.tags` | Read tag conventions from the manifest |
| Citation variables | `citations` | Read citation behavior from the manifest |
| AI model variables | `ai` | Select enabled providers and models from server runtime configuration |
| Locale variables | `localization` | Read enabled/default locales and ordering from the manifest |
| Bundled customer copy | Platform message bundles | Keep translations in the built container; customers select supported locales but cannot override messages |
| `config.json` tenant fields | Matching typed manifest sections | Keep only application-wide constants in source |
| `config.json` collection profiles | `collections` | Read collection names, visibility, and behavior from the manifest |
| Bundled gap maps and hardcoded labels | `gapMaps` | Read gap-map identity, labels, descriptions, and URLs from the manifest |
| Bundled tenant assets | Manifest asset URLs | Upload assets externally and remove tenant directories from the image |
| Institution logo mapping | `institutions` | Read institution names and asset URLs from the manifest |
| EdTech Hub footer branch | General footer schema | Model its sections, funders, disclaimer, attribution, and assets as data |
| Hardcoded image host/rewrite | Generic asset proxy | Render each configured stable asset URL directly or route it through one generic same-site endpoint |
| Database and Meilisearch selection | `services` in the server projection | Create clients from validated runtime configuration instead of build arguments |
| `ZOTERO_TRANSLATION_SERVER_URL` | `services.zotero.translationUrl` | Complete: citation translation uses the optional runtime service and remains disabled when absent |
| Contact, email, analytics, and authentication | Server/public manifest sections as appropriate | Initialize integrations from the runtime configuration interface |

### Example manifest shape

```json
{
  "schemaVersion": 1,
  "revision": "2026-07-27.1",
  "updatedAt": "2026-07-27T12:00:00Z",
  "identity": {
    "name": "Example Evidence Library",
    "assets": {
      "logoDark": "https://assets.example.org/logo-dark.svg",
      "logoLight": "https://assets.example.org/logo-light.svg",
      "favicon": "https://assets.example.org/favicon.svg"
    }
  },
  "theme": {
    "layout": "small",
    "defaultMode": "dark",
    "colors": {
      "accent": "#e68124",
      "link": "#e68124",
      "collection": "#e68124",
      "doi": "#e68124",
      "tertiary": "#5cacfd"
    }
  },
  "navigation": [],
  "footer": {
    "sections": [],
    "socialLinks": {}
  },
  "localization": {
    "defaultLocale": "en-GB",
    "locales": ["en-GB"]
  },
  "features": {},
  "search": {},
  "filters": {},
  "content": {
    "tags": {}
  },
  "collections": {},
  "exports": {},
  "services": {}
}
```

### Completion rule

The runtime-customization work is complete only when:

- the same built image can render every existing library;
- changing any mapped library-specific value requires publishing configuration,
  not rebuilding;
- no customer name, customer asset, customer color, customer copy, or
  customer-specific branch remains in the repository;
- `Dockerfile` no longer accepts customer-specific build arguments;
- every runtime configuration revision passes the schema before activation.

## 13. Validation constraints

Use the repository's existing Zod dependency for the manifest schema. Every
object must be `.strict()`: unknown keys are errors rather than silently
ignored.

### Manifest-wide rules

| Rule | Constraint |
| --- | --- |
| Manifest size | Maximum 1 MiB; larger message bundles and assets must be referenced by URL |
| `schemaVersion` | Integer enum; initially literal `1` |
| `revision` | Required, 1–64 characters, `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `updatedAt` | Required ISO 8601 UTC configuration-activation timestamp; never used as library-content freshness |
| Strings | Trimmed; control characters rejected; empty strings become validation errors rather than values |
| IDs | 1–64 characters, `^[A-Za-z0-9][A-Za-z0-9_-]*$` |
| Public URLs | Absolute `https:`; maximum 2,048 characters; credentials and fragments rejected |
| Internal links | Start with `/`; `javascript:`, `data:`, protocol-relative URLs, and path traversal rejected |
| Lists | Unique entries unless ordering explicitly permits duplicates; explicit maximum on every list |
| Rich content | Plain text by default; HTML accepted only by fields with a dedicated sanitized-rich-text schema |
| Secrets | Allowed only in the server projection and never serialized into `LibraryConfigProvider` |

### Identity and branding

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `identity.name` | Text input | 1–100 Unicode characters; single line | Required |
| `identity.shortName` | Text input | 1–40 characters; single line | Defaults to `identity.name` when the name is 40 characters or fewer; otherwise required |
| `identity.baseUrl` | URL input | Public URL rule; origin only, with `/` pathname and no query | Required |
| `identity.fundingPartners` | Ordered object list | 0–20 entries; unique `id`; each name 1–100 characters | `[]` |
| `identity.assets.logoDark` | URL input | Stable public HTTPS SVG, PNG, or WebP URL; credentials and fragments rejected | Required |
| `identity.assets.logoLight` | URL input | Same URL rule | Defaults to `logoDark` |
| `identity.assets.favicon` | URL input | Stable public HTTPS SVG, PNG, or ICO URL | Required |
| `identity.assets.icons` | URL list | 0–12 stable public HTTPS SVG, PNG, or ICO URLs | `[]` |
| `identity.assets.logoStyles` | CSS input | Raw CSS string applied directly to library logos | Empty |
| `institutions` | Object list | 0–200 entries; unique `id` and case-insensitive name; name 1–120 characters | `[]` |
| `institutions[].logoUrl` | URL input | Stable public HTTPS SVG, PNG, or WebP URL | Optional |

### Theme and layout

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `theme.layout` | Select | `small`, `wide` | `small` |
| `theme.colors.accent` | Color picker | `#RRGGBB` or `#RRGGBBAA`; no arbitrary CSS | Required |
| `theme.colors.link` | Color picker | Same color rule; must meet WCAG AA contrast against configured backgrounds | Defaults to accent |
| `theme.colors.collection` | Color picker | Same color rule | Defaults to accent |
| `theme.colors.doi` | Color picker | Same color rule | Defaults to accent |
| `theme.colors.tertiary` | Color picker | Same color rule | Required |
| `theme.colors.backgroundDark` | Color picker | Same color rule | Platform default |
| `theme.colors.backgroundLight` | Color picker | Same color rule | Platform default |
| `theme.colors.cardDark` | Color picker | Same color rule | Platform default |
| `theme.colors.cardLight` | Color picker | Same color rule | Platform default |
| `theme.defaultMode` | Select | `light`, `dark`, `system` | `dark` |
| `theme.forcedMode` | Optional select | `light`, `dark`, or `null` | `null` |
| `theme.fonts.heading` | Font picker | Family from the current Google Fonts catalog or stable HTTPS WOFF2 URL | Platform heading font |
| `theme.fonts.body` | Font picker | Same font rule | Platform body font |
| `theme.fonts.weights` | Multi-select | Unique subset of weights supported by the selected families; must include `400`; variable fonts allowed | `[400, 500, 700]` |

### Navigation, footer, contact, and legal

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `navigation.links` | Ordered list | 0–12 top-level links; unique IDs; one nested level only | `[]` |
| `navigation.links[].label` | Text/translation key | 1–80 characters | Required |
| `navigation.links[].href` | Link input | Internal link or public URL rule | Required |
| `navigation.links[].icon` | Icon picker/URL | ID from the platform icon catalog or stable HTTPS SVG, PNG, or ICO URL | Optional |
| `navigation.links[].children` | Ordered list | 0–12 links; nesting below this level rejected | `[]` |
| `navigation.links[].target` | Select | `self`, `blank`; `blank` only for HTTPS links | `self` |
| `navigation.links[].visible` | Toggle | Boolean | `true` |
| `footer.sections` | Ordered list | 0–6 sections; unique IDs | `[]` |
| `footer.sections[].title` | Text/translation key | 1–80 characters | Required |
| `footer.sections[].links` | Ordered list | 0–12 per section; same link rules as navigation | `[]` |
| `footer.socialLinks` | Provider list | Unique providers from `github`, `twitter`, `linkedin`, `youtube`, `bluesky` | `[]` |
| `footer.funders` | Ordered object list | 0–20; unique IDs; name 1–100 characters; optional validated logo/link | `[]` |
| `footer.disclaimer` | Multiline text | Plain text; 0–2,000 characters | Empty |
| `footer.attribution` | Multiline text | Plain text; 0–500 characters | Empty |
| `contact.email` | Email input | Valid email; maximum 254 characters | Optional |
| `contact.phone` | Phone input | E.164 format, `^\\+[1-9]\\d{1,14}$` | Optional |
| `contact.address` | Multiline text | 0–500 characters; maximum 8 lines | Optional |
| `legal.privacyPolicy` | Link input | Internal link or public URL rule | Defaults to `/privacy` |
| `legal.cookiePolicy` | Link input | Internal link or public URL rule | Defaults to `/cookie-policy` |
| `legal.termsOfService` | Link input | Internal link or public URL rule | Optional |

### Localization

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `localization.locales` | Locale multi-select | Non-empty unique subset of the platform-supported locale catalog | Required |
| `localization.defaultLocale` | Locale select | Must be a member of `localization.locales` | Required |
| `localization.detectLocale` | Toggle | Boolean | `false` |
| `localization.localePriority` | Ordered locale list | Unique subset of enabled locales | Defaults to `localization.locales` order |

Translation messages are fixed platform content shipped in the built container.
Customers can select supported locales but cannot upload or override message
bundles or individual message values.

### Search and filters

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `search.fullText` | Toggle | Boolean | `true` |
| `search.tags` | Toggle | Boolean | `true` |
| `search.country` | Toggle | Boolean | `true` |
| `search.authorCountry` | Toggle | Boolean | `true` |
| `search.embeddings` | Toggle | Boolean | `true` |
| `search.scopes` | Multi-select | Unique subset of `title_abstract_author_and_keywords`, `title_abstract_and_keywords`, `title_and_abstract`, `title`, `authors`, `fields`, `documents`, `everywhere`; at least one | All supported scopes |
| `search.defaultScope` | Select | Must be present in `search.scopes` | First configured scope |
| `filters.institution.mode` | Select | `hidden`, `facet`, `facet-with-featured-value` | `facet` |
| `filters.institution.label` | Text/translation key | 1–60 characters | Platform translation key |
| `filters.institution.featuredValue` | Text input | 1–120 characters; must match an indexed institution | Required only for `facet-with-featured-value` |
| `filters.countryLibrary` | Toggle | Boolean | `false` |
| `filters.collectionsExpanded` | Toggle | Boolean | `true` |
| `filters.years.enabled` | Toggle | Boolean | `true` |
| `filters.years.minimum` | Number input | Integer from 1900 through current year | `1900` |
| `filters.years.maximum` | Number input | Integer from minimum through current year | Current year |

### Content semantics and citations

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `content.tags.comingSoon` | Tag list | 0–10 unique user-defined tags; every tag follows the tag rule | `["_comingsoon"]` |
| `content.tags.internal` | Tag list | Same list and tag rules | `["internal"]` |
| `content.tags.hidden` | Tag list | Same list and tag rules | `["hide"]` |
| `content.tags.description` | Tag list | Same list and tag rules | `["_category_description"]` |
| `content.tags.redirects` | Tag list | Same list and tag rules | `["_redirects"]` |
| `content.tags.publish` | Tag list | 1–10 unique tags using the same rule | `["_publish", "publishPDF"]` |
| Tag semantics | Cross-field rule | Coming-soon, internal, hidden, description, and redirects lists must be pairwise disjoint; publish tags cannot equal hidden or internal tags | Required |
| `citations.showUrl` | Toggle | Boolean | `false` |

The item-notes description is fixed translated platform copy and is not
customer configuration.

### Feature switches

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `features.themeSwitcher` | Toggle | Boolean | Must be `false` when `theme.forcedMode` is set |
| `features.languageSwitcher` | Toggle | Boolean | Can be `true` only with two or more enabled locales |
| `features.login` | Toggle | Boolean | `false` |
| `features.navbarSearch` | Toggle | Boolean | `true` |
| `features.userCollections` | Toggle | Boolean | Requires `features.login` |
| `features.ai` | Toggle | Boolean | Requires at least one enabled AI provider |
| `features.aiSearch` | Toggle | Boolean | Requires `features.ai` |
| `features.deepResearch` | Toggle | Boolean | Requires `features.ai` and a catalog-approved large model |
| `features.relatedResources` | Toggle | Boolean | Requires `search.embeddings` |
| `features.collections` | Toggle | Boolean | `true` |
| `features.collectionNotes` | Toggle | Boolean | Requires `features.collections` |
| `features.countryFocus` | Toggle | Boolean | Requires `search.country` |
| `features.authorFilter` | Toggle | Boolean | `true` |
| `features.authorLocation` | Toggle | Boolean | Requires `search.authorCountry` |
| `features.yearsDropdown` | Toggle | Boolean | Requires `filters.years.enabled` |
| `features.downloads` | Toggle | Boolean | Requires at least one configured export |
| `features.atomFeed` | Toggle | Boolean | Requires `exports.atom` |
| Resource-page implementation | Fixed capability | Only the current supported resource page is retained; the legacy page is not exposed as configuration | No manifest field |

### Collections and exports

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `collections` | Ordered object list | 0–500 configured collection overrides; unique IDs | `[]` |
| `collections[].id` | Collection picker | Must match an existing collection key; ID rule applies | Required |
| `collections[].title` | Text/translation key | 1–100 characters | Existing collection title |
| `collections[].enabled` | Toggle | Boolean | `true` |
| `collections[].order` | Number input | Integer 0–9,999; duplicate order values allowed and resolved by ID | List order |
| `gapMaps` | Ordered object list | 0–50 entries; unique IDs and slugs | `[]` |
| `gapMaps[].slug` | Text input | 1–80 lowercase characters, `^[a-z0-9][a-z0-9-]*$` | Required |
| `gapMaps[].label` | Text/translation key | 1–100 characters | Required |
| `gapMaps[].description` | Multiline text | Plain text; 0–500 characters | Optional |
| `gapMaps[].sourceUrl` | URL input | Stable external HTTPS HTML URL; credentials and fragments rejected | Required |
| `exports.ris` | URL input | Public URL rule; endpoint must return an approved RIS content type | Optional |
| `exports.bibtex` | URL input | Public URL rule; endpoint must return an approved BibTeX/text content type | Optional |
| `exports.atom` | URL input | Public URL rule; endpoint must return Atom XML | Optional |

### Runtime services and assets

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `services.database.url` | Secret text | `postgres:` or `postgresql:` URL; maximum 4,096 characters | Required, server-only |
| `services.search.host` | URL input | `http:` or `https:` URL; no credentials, query, or fragment | Required, server-only |
| `services.search.key` | Secret text | 1–512 characters | Required, server-only |
| `services.search.index` | Text input | 1–128 characters, `^[A-Za-z0-9_-]+$` | Required |
| `services.zotero.translationUrl` | URL input | `http:` or `https:` URL; no credentials, query, or fragment | Optional, server-only |

The application owns PostgreSQL pool sizing. Assets use their own complete
stable URLs, so there is no customer-facing asset base URL or host list.

### AI

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `ai.providers` | Provider list | Unique subset of `openai`, `google`, `anthropic`, `mistral`, `deepseek`; maximum 5 | `[]` |
| `ai.providers[].enabled` | Toggle | Boolean | `false` |
| `ai.providers[].apiKey` | Secret text | 1–512 characters | Required when enabled; server-only |
| `ai.providers[].defaultModel` | Model select | Must be an active model ID in that provider's platform-owned model catalog | Required when enabled |
| `ai.providers[].largeModel` | Model select | Must be an active large-model ID for the same provider | Required by deep research |
| `ai.providers[].smallModel` | Model select | Must be an active small-model ID for the same provider | Optional |
| AI model ID | Catalog reference | 1–128 characters, `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`; free-form model IDs rejected by the configuration UI | Catalog-controlled |

### Analytics, authentication, and email

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `analytics.posthog.host` | URL input | Public URL rule; origin only | Required when PostHog is enabled |
| `analytics.posthog.key` | Secret/text input | 20–200 characters; `^phc_[A-Za-z0-9_-]+$` | Required when enabled |
| `analytics.google.measurementId` | Text input | `^G-[A-Z0-9]{4,20}$` | Optional |
| `analytics.utmDurationSeconds` | Number input | Integer 60–7,776,000 seconds | `2,592,000` |
| `authentication.google.enabled` | Toggle | Boolean; requires `features.login` | `false` |
| `authentication.google.clientId` | Secret text | 10–255 characters | Required when login and Google authentication are enabled; server-only |
| `authentication.google.clientSecret` | Secret text | 20–512 characters | Required when login and Google authentication are enabled; server-only |
| `authentication.secret` | Secret text | 32–512 characters | Required when `features.login` is enabled; server-only |
| `email.contactRecipient` | Email input | Valid email; maximum 254 characters | Optional |
| `email.takedownRecipient` | Email input | Valid email; maximum 254 characters | Optional |
| `email.smtp.host` | Host input | Valid hostname or IP literal; maximum 253 characters | Required when either recipient is configured |
| `email.smtp.port` | Number input | Integer 1–65,535 | `587` |
| `email.smtp.security` | Select | `tls`, `starttls`, `none` | `starttls` |
| `email.smtp.username` | Secret text | 1–255 characters | Required when SMTP authentication is used |
| `email.smtp.password` | Secret text | 1–512 characters | Required when SMTP authentication is used |
| `email.smtp.from` | Email input | Valid email; maximum 254 characters | Required when email is enabled |

### Runtime generation and processing

| Manifest field | Type/control | Constraints | Default/dependency |
| --- | --- | --- | --- |
| `generation.sitemap` | Toggle | Boolean | `true` |
| `generation.staticPages` | Toggle | Boolean; runtime rendering only; cannot trigger a customer-specific build | `false` |
| `generation.redirects` | Toggle | Boolean; redirects must be served from runtime configuration | `true` |
| `processing.structureRules` | Typed rule list | 0–100 rules; unique IDs; conditions/actions selected from platform catalogs; arbitrary code rejected | `[]` |
| `processing.pdfRules` | Typed rule list | 0–100 rules; unique IDs; platform-catalog conditions/actions only | `[]` |
| `processing.sharedRules` | Typed rule list | 0–100 rules; unique IDs; platform-catalog conditions/actions only | `[]` |
| Rule priority | Number input | Integer 0–9,999; ties resolved by rule ID | List order |
| `ai.prompts` | Prompt-slot map | Maximum 20 entries; keys must be platform-defined prompt-slot IDs | Platform defaults |
| Prompt value | Multiline text | 1–20,000 characters; variables must come from the slot's allowlist; unknown variables rejected | Required when overriding a slot |

### Cross-field activation rules

| Rule | Validation |
| --- | --- |
| Theme switching | Forced mode and visible theme switcher cannot both be active |
| Language switching | Switcher requires at least two enabled platform-supported locales |
| Authentication | Google authentication requires login; login requires a complete authentication configuration; user collections require login |
| AI | AI features require an enabled provider, credential, and catalog-valid model |
| Embeddings | Related resources require `search.embeddings`; the configured search backend owns its embedder |
| Collections | Collection notes require collections; referenced collection IDs must exist |
| Exports | Download/feed features require their corresponding validated endpoint |
| Email | Contact/takedown recipients require a complete SMTP configuration |
| Assets | Every external asset must use a stable public HTTPS URL; expiring signed URLs are rejected |
| Activation | The entire revision is atomic: any failed field or cross-field rule rejects the revision |
