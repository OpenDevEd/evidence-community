# Evidence Library

A single Evidence Library image can run any validated library configuration.
Identity, theme, navigation, localization, search, features, integrations, and
service connections are loaded from one server-side JSON document at runtime.
Changing a library does not require rebuilding the application.

## Local development

```bash
npm install
cp config/library.example.json config/library.local.json
npm run config:validate -- config/library.local.json
npm run dev
```

Development reads `config/library.local.json` by default. Set
`LIBRARY_CONFIG_PATH` to use another document.

## Checks

Run focused tests while changing code:

```bash
npm test -- tests/unit/library-config-source.test.ts
```

Before pushing, run the fast branch checks on your machine:

```bash
npm run check:changed
```

This runs lint, TypeScript, generated-schema checks, all unit tests, and Fallow.
Fallow checks changed code for new dead code, complexity, duplication, and
styling problems.

Run the full local acceptance suite once when a change affects the browser,
runtime configuration, database, workers, search, files, or provider flows:

```bash
npm run test:acceptance
```

The acceptance command builds the production app and worker images together,
then starts two independently configured libraries with disposable PostgreSQL,
Meilisearch, Mailpit, workers, and local external-service fixtures. It runs
every desktop and mobile browser check, verifies live configuration activation
and rollback, then removes all test data and containers. The normal local run
keeps the large admin suite at one worker for stability; GitHub uses four on
Blacksmith. GitHub runs this complete suite before code can merge.

Use Blacksmith Testbox only to reproduce a failure that needs a clean Linux
machine or differs from GitHub. It is not the normal local development loop.

## Documentation

- [Runtime customization map](docs/evidence-library-customization-map.md)
- [Deployment and operations](docs/evidence-library-operations.md)
- [Configuration example](config/library.example.json)
- [Machine-readable JSON Schema](public/library-config.schema.json)
- [Machine-readable option catalogs](public/library-config.catalogs.json)
- [Current deployed architecture snapshot](docs/evidence-library-architecture.md)
