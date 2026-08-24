# Prompts

## Plan 01

Read AGENTS.md, plans/optional-doi/00-README.md and 01-identifiers-view-model.md. On branch `main`, add the `identifiers` view to `buildAdminPublicationViewFromSnapshot` test-first as described. Do not change the provider views or the UI. Run the exact checks in the plan. Commit with a conventional prefix.

## Plan 02

Read AGENTS.md, plans/optional-doi/00-README.md and 02-identifiers-card.md. On branch `main`, build `AdminIdentifiersCard` test-first, mount it in the inspector in place of the provider rows, update the header chip, and remove the dead provider row code. Run the exact checks and runtime cases in the plan. Commit in small steps.

## Plan 03

Read AGENTS.md, plans/optional-doi/00-README.md and 03-zenodo-reuse-external.md. On branch `main`, add the `reuse-external` Zenodo policy test-first, including the locked DOI, local collision check, worker mismatch failure, and Sandbox qualification step. Run the exact checks in the plan against docs-pen's configured Zenodo Sandbox only. Commit in small steps.
