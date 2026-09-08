# Caitlin editorial implementation

Use the approved editorial components from the editorial preview worktree. Replace mock state and transport with the runtime APIs; preserve their markup and styles. Only the checkbox and surrounding text beneath the identifier tabs may be redesigned.

## Stored review

One pending review per top-level item. Submission captures the root, attachments, metadata, categories, citations, author associations, exact file revisions and identifier choice. Later draft edits do not change it. Editor corrections are stored separately from the submitted snapshot. Only an Editor or Owner can publish the reviewed version.

Approval changes public records immediately in the existing PostgreSQL publication transaction. Provider work follows through the existing outbox and publication jobs. A provider failure must not undo library publication. Rebase newer drafts on the approved values using the existing field merge helpers; retain conflicting newer values privately and require resolution before the next submission.

## Files

Reuse the private source objects already retained by published native files. Reviews retain their exact object paths. Replacing or removing a working file must not delete anything a draft, review, publication or provider job still references. Prepare public copies before approval, commit record/file changes together, and clean unreferenced objects only after the transaction commits.

## Identifiers and provenance

Created and Imported are item kinds. Source remains separate, including DOI import. Zotero sync publishes directly and does not enter review.

Created items choose Zenodo or Crossref + Zenodo. Crossref reservation is available to Creators; activation is Editor/Owner-only. Neither library publication nor Crossref activation requires a PDF. Zenodo remains a draft until approved files and its metadata requirements are available. Later approved files automatically continue the same archive workflow. Zenodo-only uses its own DOI; the combined route offers the agreed DOI policy choice.

## Checks

- Exercise submission followed by more edits, Editor correction, exact snapshot publication, return and withdrawal.
- Verify draft replacement and removal leave submitted/public files intact, including failed approval and retries.
- Verify role enforcement at every mutation and provider boundary.
- Check the approved screens in Zen with real interactions and enough records for scrolling.
- One Fable 5.1 review after this part is ready; fix findings without a second review.

This branch builds on the access PR. Product documentation and payments are outside this work.
