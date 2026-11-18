# Evidence Community

The public site of an [Openscholar](https://openscholar.ai) Evidence Community: a research library a team curates, with search, filters, maps, answers linked to their sources, record pages with DOIs, and an admin for its editors.

Teams set a community up from [Openscholar](https://github.com/Openscholar-ai/openscholar), which publishes it as this runtime. A single runtime image can run any validated community configuration.
Identity, theme, navigation, localization, search, features, integrations, and
service connections are loaded from one server-side JSON document at runtime.
Changing a community does not require rebuilding the application.

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
keeps the large admin suite at one worker for stability; GitHub uses four on an
isolated self-hosted runner. `EVIDENCE_LIBRARY_ACCEPTANCE_SCOPE=smoke` runs what a
pull request runs: Amber alone, its API checks and the browser tests tagged
`@smoke`. Read the aggregate `CI` result for the exact head before merging, and
the full run on `main` after it.

## Documentation

- [Runtime customization map](docs/evidence-library-customization-map.md)
- [Deployment and operations](docs/evidence-library-operations.md)
- [Self-hosted CI](docs/self-hosted-ci.md)
- [Analytics and consent](docs/analytics.md)
- [Configuration example](config/library.example.json)
- [Machine-readable JSON Schema](public/library-config.schema.json)
- [Machine-readable option catalogs](public/library-config.catalogs.json)
- [Current deployed architecture snapshot](docs/evidence-library-architecture.md)

## Contributing

See the [contributing guide](https://github.com/Openscholar-ai/.github/blob/main/CONTRIBUTING.md). To report a security problem, see the [security policy](https://github.com/Openscholar-ai/.github/blob/main/SECURITY.md).

## Licence

Evidence Community is free software under the [GNU Affero General Public License v3.0](LICENSE). If you run a changed version for other people, for example as a website, you must offer them its source code under the same licence.
