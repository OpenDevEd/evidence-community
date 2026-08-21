# Prompts

## Plan 01

Read AGENTS.md, plans/optional-doi/00-README.md and 01-identifiers-view-model.md. On branch `feat/optional-doi`, add the `identifiers` view to `buildAdminPublicationViewFromSnapshot` test-first as described. Do not change the provider views or the UI. Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`. Commit with a conventional prefix.

## Plan 02

Read AGENTS.md, plans/optional-doi/00-README.md and 02-identifiers-card.md. On branch `feat/optional-doi`, build `AdminIdentifiersCard` test-first, mount it in the inspector in place of the provider rows, update the header chip, and remove the dead provider row code. Prove it in the real browser on the local stack for the three cases and keep the screenshots in the PR. Commit in small steps.

## Plan 03

Read AGENTS.md, plans/optional-doi/00-README.md and 03-zenodo-reuse-external.md. On branch `feat/optional-doi`, add the `reuse-external` Zenodo policy test-first, including the resolve check and the sandbox qualification step. Run the sandbox tool against docs-pen's configured Zenodo Sandbox only. Commit in small steps.
