# Evidence Library runtime customization map

The Evidence Library uses one validated JSON document at runtime. A customer
does not require a custom build, bundled logo directory, database branding row,
or `NEXT_PUBLIC_*` variables.

## Runtime contract

| Concern | Source of truth | Runtime consumer |
| --- | --- | --- |
| Configuration path | `LIBRARY_CONFIG_PATH` | `src/config/library-config/source.ts` |
| Validation and defaults | `src/config/library-config/schema.ts` | Server startup and config health route |
| JSON Schema | `/library-config.schema.json` | External editors and structural validation |
| Option catalogs | `/library-config.catalogs.json` | External forms, selectors, and secret handling |
| Public projection | `src/config/library-config/public.ts` | `LibraryConfigProvider` |
| Example document | `config/library.example.json` | Operators and tests |
| Health check | `/api/library-config/health` | Deployment health checks |
| OpenScholar read API | `/api/openscholar/collections`, `/api/openscholar/institutions` | OpenScholar configuration pickers; bearer token is `authentication.openScholar.machineCredential`; both answer one page at a time (see below) |

`LIBRARY_CONFIG_PATH` selects the document. It is deployment plumbing, not a
library customization value. In production the path is required. The same
container image can be started repeatedly with different mounted documents.

## Configurable sections

| Section | What it controls | Main constraints |
| --- | --- | --- |
| `schemaVersion`, `revision`, `updatedAt` | Contract version and revision identity | Schema version `1`; bounded revision; UTC timestamp |
| `identity` | Name, short name, tagline, description, canonical origin, funding partners | HTTPS origin; tagline is one line up to 160 characters; description up to 300 characters and used for page and social previews; bounded unique partner IDs |
| `identity.assets` | Dark/light logos, favicon, app icons, logo CSS, share image | Stable public URLs; share image is a PNG, JPG, or WebP HTTPS URL without a query string; CSS declarations only |
| `institutions` | Institution names and optional logos | Up to 200; unique IDs and case-insensitive names |
| `theme` | Layout, colors, mode, fonts, weights | Catalog values and validated colors/font URLs |
| `navigation` | Internal and external navbar entries and icons | Bounded lists; platform icons or validated asset URLs |
| `footer` | Sections, links, social links, attribution, disclaimer, "Powered by OpenScholar" link | Bounded unique IDs and validated links; `poweredBy` defaults to `true` |
| `contact` | Review email, phone, address, PayPal link | Valid email/URL and bounded plain text |
| `legal` | Privacy, cookie, and terms links; optional owner-written page text (`privacyMarkdown`, `cookieMarkdown`, `termsMarkdown`) | Internal paths or stable external URLs; page text is Markdown up to 200 000 characters, `{{SITE_HOST}}` is replaced with the library host, and `termsOfService` defaults to `/terms` when `termsMarkdown` is set |
| `localization` | Enabled locales, default, detection, priority | Platform locale catalog; default and priority must be enabled |
| `search` | Search fields, semantic search, scopes, default scope | Platform scope catalog; default scope must be enabled |
| `filters` | Institution mode/label, country mode, collection expansion, years | Explicit modes; valid year range |
| `content.tags` | Coming-soon, internal, hidden, description, redirects, publish tags | User-defined unique tag lists |
| `citations` | Citation display behavior | Boolean switches |
| `features` | Theme/language/login/search/AI/download and related UI switches | Dependency validation in the schema |
| `collections` | Enabled collection IDs, labels, ordering | Unique IDs and bounded order |
| `gapMaps` | Runtime gap-map routes and source URLs | Unique IDs/slugs and stable URLs |
| `exports` | One switch each for RIS, BibTeX, and the Atom feed | Booleans; the library builds every file from its own records |
| `services` | PostgreSQL, Meilisearch, Zotero translation | Valid service URLs and bounded credentials/index |
| `ai` | Providers, models, keys, prompts | Platform provider/model catalogs and feature dependencies |
| `analytics` | PostHog, Google Analytics, UTM retention | Valid hosts/IDs and bounded retention |
| `authentication` | Required OpenScholar service access and session signing; optional Google login | OpenScholar site, library, login page, machine credential, and signing secret are required; Google credentials are complete when enabled |
| `email` | Contact/takedown recipients and SMTP | Complete credential pairs and valid transport settings |
| `generation` | Sitemap and legacy-redirect route availability | Runtime booleans |
| `processing` | Structure, PDF, and shared processing rules | Platform condition/action catalogs |

The generated JSON Schema exposes nested fields, defaults, structural limits,
and selectable values. The catalog adds rich option metadata, extensible-choice
markers, and write-only paths. Custom refinements and cross-field dependencies
remain authoritative in `src/config/library-config/schema.ts`; external tools
must run `npm run config:validate -- <path>` before activation.

## OpenScholar read API

Both routes need `Authorization: Bearer <authentication.openScholar.machineCredential>`
and answer one page at a time. A request without parameters returns the first
page.

| Route | Parameters | Answer |
| --- | --- | --- |
| `GET /api/openscholar/collections` | `query`, `cursor`, `pageSize` (1 to 100, default 50) | `{ "items": [{ "count", "id", "parentId", "source", "title" }], "nextCursor" }` |
| `GET /api/openscholar/institutions` | `query`, `cursor`, `pageSize` (1 to 200, default 50, a larger number is reduced to 200), `sort` = `count` or `name` | `{ "items": [{ "count", "name" }], "nextCursor" }` |

`query` matches anywhere in the name and ignores case. Institutions are
ordered by record count, highest first, then by name; `sort=name` orders by
name alone. `nextCursor` is `null` on the last page. Send it back unchanged to
read the next page: it is opaque, and it only works with the same search and
sort. A cursor that cannot be read, or that belongs to a different search,
returns 400.

## Runtime assets

Logos, favicons, institution logos, navigation assets, profile images, document
previews, and flags are served from their source URLs. Next.js image
optimization is disabled because the host allowlist cannot be known when the
shared image is built.

There are no customer assets under `public/logos` or `public/assets`, and there
is no customer-dependent `/images` rewrite.

## Database boundary

The `status` table contains content/import status only:

| Column | Purpose |
| --- | --- |
| `totalRecords` | Imported record count |
| `totalItems` | Imported item count |
| `databaseUpdatedAt` | Content database update time |
| `createdAt`, `updatedAt` | Status-row timestamps |

Fresh migrations create the one required status row with zero counts. Runtime
code updates that row; deployments do not need a separate database seed step.

Branding, layout, and export URLs are not database fields. The versioned
Drizzle migrations can bootstrap the current schema on an empty database and
also destructively remove the superseded customer columns from an existing
database.

## Build boundary

The Docker build has no customer build arguments. `next.config.mjs` contains no
customer environment injection, asset hosts, or customer rewrites. Runtime
identity, metadata, policy hostnames, feature behavior, services, and generation
routes all read the active validated configuration.

Platform-only environment reads remain for framework/build detection and for
rejecting conflicting legacy auth-origin variables. They do not customize a
library.
