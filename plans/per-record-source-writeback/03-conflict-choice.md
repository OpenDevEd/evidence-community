# Plan 03 — Conflict choice on re-check

## Goal

When an admin turns a paused source back on and that source changed in the meantime, stop, show the conflict, and let the admin choose which side wins. Never overwrite silently in either direction.

## Scope and design

1. **Detect.** The version-check job created by the sources route (Plan 02) asks the source adapter for the remote item’s current version (reuse `remoteItem` in `src/lib/source-writeback/zotero/adapter.ts:80` through a new adapter method `readRemoteVersion(link)` on the writeback adapter contract in `src/lib/source-writeback/adapter.ts`). If it equals `itemSourceLink.lastAcknowledgedRemoteVersion` (or the link has no remote yet), the link simply resumes and the pending job continues. If it is newer, the job records `conflict` for that link and sends nothing.
2. **State.** Add `conflict` to `adminSourceWritebackStateSchema` in `src/lib/admin/source-writeback-contract.ts`. Prefer deriving it in `getAdminSourceWritebackStatus` (`source-writeback-service.ts:97-155`) from the job’s terminal `conflict` outcome plus `remoteVersion !== lastAcknowledgedRemoteVersion`. Add a column only if the job table cannot hold the outcome; then add migration 0036.
3. **Choice.** The status popover (`AdminSourceWritebackStatus.tsx`) shows, in the `conflict` state, the text “{source} changed while updates were paused.” and two buttons:
   - **Send this record to {source}** — helper text “Replaces the {source} copy with this record. Changes made in {source} since {date} are lost there.” Calls `POST /api/admin/items/[key]/writeback/resolve` with `{ sourceKey, choice: "send-local" }`, which sets `lastAcknowledgedRemoteVersion = remoteVersion` and re-enqueues the normal writeback job.
   - **Load {source}’s version** — helper text “Replaces this record with the {source} copy. Unpublished local changes are lost.” Calls the same route with `choice: "load-remote"`, which runs one targeted import of that item through the existing ingestion writer (`writeSourceIngestionBatch`, `transactional-writer.ts:753`) using the source adapter’s single-item read, then marks the link synced.
   Both actions need a confirm step in the popover (second click “Confirm”) because they are destructive on one side. `data-admin-writeback-resolve="send-local|load-remote"` on the buttons.
4. **Ordinary in-flight 412.** Leave `zotero/adapter.ts:69-76` as is: a 412 during a normal send still reloads and retries. This plan only covers the pause → change → re-check path (D5b).
5. **Collections.** Out of scope (D10). Collections cannot be paused per record today, so the pause → change → re-check path does not exist for them.
6. **Wording.** Provider-neutral. Never “Zotero” outside the source label. Dates in the helper text come from the link’s `updatedAt` for the paused moment.

## Test-first steps

1. Red: `tests/unit/writeback-version-check.test.ts` — check job resumes when versions match, sets `conflict` when remote is newer, and never enqueues a send in the conflict case. Green. Commit.
2. Red: `tests/unit/admin-source-writeback.test.ts` — the state machine exposes `conflict` and its two allowed actions; no other state exposes them. Green. Commit.
3. Red: `tests/unit/admin-writeback-resolve-route.test.ts` — `send-local` acknowledges the remote version and enqueues; `load-remote` writes the remote item locally and marks synced; wrong state returns 409. Green. Commit.
4. Green: popover UI with confirm step. Extend `tests/e2e/admin.spec.ts` with a mocked `conflict` status showing both buttons, the confirm step, and the resulting call. Commit.

## Files

- `src/lib/source-writeback/adapter.ts`, `zotero/adapter.ts`, `consumer.ts` (version-check job handling), `queue.ts`
- `src/lib/admin/source-writeback-contract.ts`, `source-writeback-service.ts`
- new `src/app/api/admin/items/[key]/writeback/resolve/route.ts`
- `src/components/admin/AdminSourceWritebackStatus.tsx`, `admin-api.ts`
- tests named above; `drizzle/0036_*` only if needed

## Exact tests

```sh
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:acceptance
```

## Deployment gate

Local only. Real proof runs in Plan 04 against Zotero: pause, edit the Zotero item, re-check, see `conflict`, take each choice once.

## Completion rules

- A re-check after a remote edit shows `conflict` and sends nothing until the admin chooses.
- Both choices end in the documented local and remote state (unit-tested here, live-proven in Plan 04).
- Ordinary sends still handle 412 as before.
- All commands pass; commits tagged `[plan-03]`.

## Risks

- “Load remote” reuses the ingestion writer, which may reset local-only fields (files, publication data). The unit test must show attachments and publication rows survive; if they do not, limit the import to metadata fields and say so in the helper text.
- Zotero returns item versions as integers; store as the existing string `remoteVersion` and compare through the adapter, not with `<`.
