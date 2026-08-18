# Execution prompt

## Plan 01

```text
Implement plans/manifest-owned-zotero-sources/01-manifest-contract-and-live-proof.md after reading plans/manifest-owned-zotero-sources/00-README.md. Estimate 4 to 8 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse the existing sourceConnection model, Zotero connection parser, worker loops, config projection, and real verifiers before adding code.
2. Delete credentialRef, the environment credential resolver, manual source seeding, and all old docs/tests. Do not keep compatibility behavior.
3. Use red, green, cleanup for the manifest, registry, and reconciliation logic. Add integration coverage with the implementation.
4. Read current Zotero API documentation and installed library source whenever a contract is unclear.
5. Do not delegate this step or run a reviewer unless the user asks.
6. Keep the API key server-only and prove it is absent from public config and admin responses.
7. Do not touch any Evidence Library other than docs-pen during the live gate.

EXECUTION RHYTHM
Write failing manifest and registry tests, implement the smallest shared contract, clean it up, and commit the green unit. Add failing real PostgreSQL reconciliation coverage, implement it, and commit it. Update the workers and real verifiers, run the complete local gate, then push and verify docs-pen.

COMMIT DISCIPLINE
Use allowed prefixes and add [plan-01] to every commit. Never bypass hooks. Do not commit failing tests. Stage named files and preserve unrelated work.

WHEN TO STOP
Stop only for a missing required API, an unsafe live target, or a plan error that cannot be corrected from evidence. Do not stop for an answer already in the plan. All local and live gates must be green.

DEVIATIONS
Commit safe work, revise the plan in Git with docs: [plan-01] revise <section> — <reason>, then continue. Write a blocker file only when no safe path exists.

START NOW
Read AGENTS.md, the README, and Plan 01. Check git status. Add the first failing manifest tests. Continue through the full local gate, then deploy only docs-pen and complete the live proof.

Go.
```
