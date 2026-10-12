# Record reading: study types and per-source screening

Milestones: EL-27 in `OpenDevEd/new-el` (#587 to #592), OS-22 in
`OpenDevEd/openalex-count` (#898, #899).
Mocks: new-el `mock/record-types` (library pages), OpenScholar
`mock/source-screening` (source settings). The mocks are the agreed design;
port every commit of them.

## Problem

A library cannot tell a meta-analysis from a commentary, and every record a
source finds enters the library whether or not it is about the library's
subject. The digest's "meta-analyses and reviews" count mixed 9 meta-analyses
with 255 reviews, and its 300-a-digest review reading missed 12 real
meta-analyses in AIED's September edition. Researchers will read these numbers.

## Decisions (the user, 2026-10-12)

- Every record that comes into a library is read once by Jev when it comes in,
  from every kind of source, screening or not. No cap. The read runs on the
  library's own OpenRouter key; a library without one gets no reading.
  - Changed 2026-10-12. The first decision read only the records a screening
    source brings in. Types, the Study types filter and the per-type digest
    counts cover the whole library, so a record from a source that does not
    screen needs a type too. Proof: the reader slice (#589, PR #598) reads
    every record of a library that has a key.
- One call answers everything, since Jev charges only for input: the grade
  against the subject of each screening source that holds the record (score,
  four levels), the study type (choice, 13
  types in three levels), whether the authors pooled results themselves
  (noul), the region studied (choice), and whether the abstract reports
  quantitative results (noul).
- Screening is per source: each source row has a Screening switch, its own
  subject and its own kept-out grades. Every kind of source can screen
  (OpenAlex searches, Zotero groups, OpenScholar collections).
- The old screening verdicts become the grade plus the type: "not a research
  publication" is a type, "can't tell" is low confidence.
- Hiding is by grade only and reversible, the way duplicates are.
- Records already in a library are read too (the owner starts it, see below).
- Datasets, software, corrections, editorials and registry DOIs (10.37766
  INPLASY, 10.17605 OSF) are typed from the record, without AI.
- A low-confidence answer is asked again once the record's PDF arrives.
- Types show beside the date on cards and the item page, as a sidebar filter
  (the "reviews only" view), as per-type digest counts, and with one methods
  paragraph wherever they appear.
- Accuracy is measured before it is quoted: PubMed's own publication types on
  the biomedical records, plus a hand-checked sample per library.
- Digests keep counting publications by publication date.
- The grading card in the source settings appears only when something needs
  grading: an edited subject, or records not graded against the current one.

Measured on ECCAR (2,910 records, 2026-10-12): a full read costs $0.0000746 a
record and a grade-only read 42% of that; 13% of types came back under 0.6
confidence. Backfill estimate: AIED about $25, TVET $21, ECCAR $12.

## Design

### Configuration (new-el owns the schema, OpenScholar re-pins it)

`sources[].screening = {enabled, subject, keptOut}` with `keptOut` a list of
grades (`not-about` by default). Additive with defaults, so no owner
configuration migration. The question set is code, versioned by a constant.

### Storage

- `itemReading` (one row per record): the study type, its confidence and who
  set it (`metadata`, `ai`), pooled, region, effects, what Jev read (`abstract`,
  `title`, `pdf`), the model, the question-set version, a hash of the title and
  abstract it read, cost and time.
- `itemGrade` (one row per record and screening source): the score, the rounded
  grade, the subject hash it was graded against, and a pending score and hash
  while the source is graded again.
- `itemReadingQueue`: the lease, generation, attempts and retry columns
  `topicAssociationDelivery` uses, with what the job asks (`read` or `grade`).
- `itemReading.screenedOut`: true when every source that holds the record
  screens it and keeps its grade out. A source with screening off brings its
  records in unscreened, and a record not graded yet stays in.
- `sourceScreening` (one row per screening source): the subject hash and
  kept-out grades the configuration last set, so the database alone decides
  `screenedOut`, and how many records the owner asked to grade.

### Reading worker

A reading cycle in the publication worker loop, beside the topic and author
association cycles, reusing `runAssociationDeliveryCycle`'s claim, lease and
backoff. It claims a batch, calls Jev about 16 at a time, and writes the answers
and an outbox row in one transaction, so the search indexer picks the change up.

- New and changed records enter the queue from an outbox trigger, as topic
  deliveries do. A record whose title, abstract, subjects and question set are
  unchanged is skipped without a call.
- Records already in a library, and records left ungraded after a subject
  change, enter the queue only when the owner asks (OpenScholar's "Grade them"
  or "Grade again"), because that spend is the owner's to start.
- A subject change grades only. New scores land in the pending columns; when the
  source's last record is done, one transaction swaps them in and recomputes
  `screenedOut`, so grades never flip one by one.
- A failed read is retried with backoff and never hides a record.
- A configuration signature, as `topicDeliveryConfiguration` keeps, detects a
  changed subject, kept-out list or question set.

### Status and actions for OpenScholar

- The source-status report each library already pushes gains, per screening
  source: counts by grade, records not graded against the current subject,
  progress while grading, and spend. OpenScholar stores and shows it.
- `POST /api/openscholar/sources/{key}/screening/grade` queues what needs
  grading, beside the existing `.../sync`. `POST .../screening/trial` with
  `{subject}` reads 200 of the source's records with a
  proposed subject, stores nothing, and returns the grade counts now and with
  it. Both use the library's machine credential, as the digest endpoint does.

### Public library

The search projection gains the study type and its level, and drops screened-out
records; `SEARCH_PROJECTION_VERSION` goes up. The label, the Study types card
and filter (with exports and the AI context carrying `study`), and the methods
paragraph come from the mock.

### Digests

Ranking puts reviews and syntheses first by study type and stores each
edition's counts by type when its list is made, so they add up to its count.
`notificationItemKind`, `LIKELY_REVIEWS_READ`, the `candidate` and `kind`
fields of the digest request, and OpenScholar's `kinds.ts` and
`MAX_DIGEST_KINDS` are removed. The writer receives each publication's study
type.

### Editors

The study type is an editable record field through the existing draft and
publish flow. An editor's value wins, and a later read never overwrites it.

## Migration

New tables and a new optional config field; no existing row changes shape.
`notificationItemKind`'s answers are not carried over: every record is read
again with the new questions. The removal of `notificationItemKind` ships in the
digest slice, after the reading has filled `itemReading` on AIED, TVET and
ECCAR. Rollback drops the new tables and trigger.

## Slices

Each slice is one PR with its focused tests; the issue carries the checks.

1. Reading: config field, tables, queue trigger, Jev call, metadata rules,
   worker cycle. (new-el #587)
2. Grades and visibility: `screenedOut`, kept-out grades, regrade with the
   pending swap, status report, grade and trial endpoints, and the PDF read of
   low-confidence types. (new-el #588)
3. Settings: re-pin the contract, the per-source band from the mock, with real
   counts, Try on 200, Grade them and Grade again. (OpenScholar #898)
4. Readers: projection, labels, Study types filter, methods text. (new-el #589)
5. Digests by type, and the kinds code removed in both repositories. (new-el
   #590, OpenScholar #899)
6. Editors correct a type. (new-el #591)
7. Accuracy: PubMed tags and a hand-checked sample; the methods text states
   the result. (new-el #592)

## Checks

- Unit: the question set and answer parsing, metadata rules, the screened-out
  rule, the pending swap.
- Integration (real PostgreSQL): queue entry from the outbox, claim and retry,
  regrade swap, visibility of screened-out records, search projection.
- Browser: `npm run verify -- shift` on `/lib`, an item page and a digest
  edition; OpenScholar's configuration page signed in.
- Live: one library (ECCAR) read end to end on its own key before AIED and TVET.

## Completion

Every record of AIED, TVET and ECCAR carries a study type, the three libraries'
sources screen against a subject their owner wrote, the digest counts types,
the accuracy figures are published, and no kinds code remains in either
repository.

## Risks

- Jev changes behind the `~typesafe/jev-latest` alias. The model id is stored
  per read; pin `typesafe/jev-1.13` and move deliberately.
- 13% low-confidence types. They show as uncertain, and the PDF read retries
  them.
- Backfill load on the shared host: read in leased batches, one library at a
  time.
