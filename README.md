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

```bash
npm run lint
npx tsc --noEmit
npm run schema:check
npm run quality:fallow -- --base origin/main
npm run test:unit
npm run test:e2e
```

Fallow checks changed code for new dead code, complexity, duplication, and
styling problems. Run every check through Blacksmith Testbox rather than on the
local machine.

The E2E command builds one production image and starts two independently
configured libraries with disposable PostgreSQL, Meilisearch, Mailpit, workers,
and local external-service fixtures. It runs every desktop and mobile browser
check, verifies live configuration activation and rollback, then removes all
test data and containers.

## Documentation

- [Runtime customization map](docs/evidence-library-customization-map.md)
- [Deployment and operations](docs/evidence-library-operations.md)
- [Configuration example](config/library.example.json)
- [Machine-readable JSON Schema](public/library-config.schema.json)
- [Machine-readable option catalogs](public/library-config.catalogs.json)
- [Current deployed architecture snapshot](docs/evidence-library-architecture.md)
