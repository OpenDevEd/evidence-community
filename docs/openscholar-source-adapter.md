# Openscholar collection source

An Openscholar collection source follows one collection a person keeps in
Openscholar. The library reads which works the collection holds from
Openscholar, and reads the works themselves from OpenAlex through the same
import engine as an OpenAlex search.

## Configuration

Openscholar writes the source into `LIBRARY_CONFIG_JSON`:

- `key`: `openscholar-<collectionId>`;
- `provider`: `openscholar`;
- `collectionId`: the Openscholar collection;
- `apiKey`: the OpenAlex key that reads its works;
- `enabled`: whether the source is followed;
- `settings`: `name`, `apiKeyMode` and `downloadPdfs`, the settings every
  source of OpenAlex works has (`openAlexWorksConfigSchema`).

The collection is the scope, so a library holds each collection once. The
source takes its name from the collection on every sync.

## Openscholar endpoint

`POST /api/v1/evidence-libraries/source-collections/items` on the Openscholar
HTTP host, with the library's machine credential as a bearer token:

```json
{ "contractVersion": 1, "libraryId": "…", "collectionId": "…", "knownVersion": "7", "cursor": null }
```

It answers `{ contractVersion, version, name }` with either `unchanged: true`,
when the collection is still at `knownVersion`, or a page of up to 1,000
`items` (`itemId`, `openalexId` as `W…` or null, `doi` or null) and a
`nextCursor`. The version changes whenever an item is added or removed.

Refusals:

- `401 invalid_service_credential`: the credential does not belong to the library;
- `403 not_configured`: no owner of the collection ever connected it to this library;
- `403 owner_left`: the person who added the collection is no longer in the
  library's organisation;
- `404 collection_not_found`: the collection was deleted.

## Sync

1. Every sweep sends the version the last run read. An unchanged collection
   costs this one request and nothing else, unless tonight's refresh or owed
   PDFs are due.
2. A changed collection is read whole. Its pages must share one version, or it
   is read again.
3. The works are read from OpenAlex a hundred ids per request, the most one
   filter takes. A full scan reads the hundreds as parallel parts through the
   same slice machinery a large OpenAlex search uses.
4. The records stage, reconciliation, nightly incremental refreshes, weekly
   full scans and the PDF stage are the OpenAlex engine's
   (`syncOpenAlexWorks`). A new version is a full scan, so works taken out of
   the collection are withdrawn unless another source holds them.
5. `owner_left` and `collection_not_found` withdraw every work the source holds
   and forget its cursor, so the collection imports in full if access returns.
   The run fails with `owner_left` or `not_found`, which source status shows.

Items without an OpenAlex id are counted as `unresolved` in the run's result.
