/** A part of the admin that someone else, or a worker, can change while the page is open. */
export const ADMIN_LIVE_TOPICS = ["records", "reviews", "collections", "sources", "publishing", "digests", "import"] as const;
export type AdminLiveTopic = (typeof ADMIN_LIVE_TOPICS)[number];

/** Where the admin page listens. */
export const ADMIN_LIVE_PATH = "/api/admin/events";

/** The Postgres channel each watched table's triggers notify, with the table's name (drizzle/0106_admin-live-updates.sql). */
export const ADMIN_LIVE_CHANNEL = "admin_changed";

/**
 * The parts of the admin a change to each table shows in. A new table goes here with an `admin_changed` trigger in its
 * migration, or in ADMIN_LIVE_UNWATCHED: tests/unit/admin-live-tables.test.ts refuses one that is in neither.
 */
export const ADMIN_LIVE_TABLES: Readonly<Record<string, readonly AdminLiveTopic[]>> = {
	// A record as the list and the inspector show it: its fields, draft, PDF, links, tags and DOI choice.
	item: ["records"],
	itemIdentity: ["records"],
	itemDraft: ["records"],
	itemFileDraft: ["records"],
	itemFilePublication: ["records"],
	itemFileRemoval: ["records"],
	itemFieldOverride: ["records"],
	itemSourceFileChoice: ["records"],
	itemSourceLink: ["records"],
	itemSourceValue: ["records"],
	itemLink: ["records"],
	itemInstitution: ["records"],
	itemToTag: ["records"],
	itemToCollection: ["records"],
	// A version sent, published, returned or taken back. Its own part, so the answer to a submission is read at once
	// however much typing and importing the records part is slowed down for.
	itemReview: ["reviews"],
	itemReviewFile: ["reviews"],
	itemPublishingChoice: ["records"],
	itemImportCheck: ["records"],
	addedPaper: ["records"],
	adminItemListProjection: ["records"],
	sourceTopicAssignment: ["records"],
	tag: ["records"],
	collection: ["collections"],
	collectionIdentity: ["collections"],
	collectionSourceLink: ["collections"],
	sourceConnection: ["sources"],
	sourceSyncState: ["sources"],
	sourceSyncRun: ["sources"],
	sourceRecordIssue: ["sources"],
	publicationIdentifier: ["publishing"],
	publicationSyncJob: ["publishing"],
	publicationTarget: ["publishing"],
	zenodoFileCorrectionApproval: ["publishing"],
	notificationEdition: ["digests"],
	notificationEditionEvent: ["digests"],
	notificationDelivery: ["digests"],
	// The digests view counts confirmed subscribers.
	notificationSubscriber: ["digests"],
	pdfImport: ["import"],
	pdfImportFile: ["import"],
};

/**
 * Tables the admin doesn't show, or shows on a timer of its own. The search and publication workers write
 * `searchIndexWorker` and `publicationSyncRun` every few seconds to say they're alive, and the admin reads those on a
 * timer because a worker that stopped writes nothing.
 */
export const ADMIN_LIVE_UNWATCHED: readonly string[] = [
	"authorAssociationDelivery",
	"collectionSourceSnapshot",
	"computedCache",
	"doiNamespace",
	"embeddings",
	"institutionCountry",
	"itemCitationMetric",
	"itemGrade",
	"itemOpenAccessLookup",
	"itemReading",
	"itemReadingQueue",
	"itemRedirect",
	// Written with its review, whose own row tells the admin.
	"itemReviewSender",
	"language",
	"notificationItem",
	"notificationState",
	"openAlexQueryApproval",
	"outbox",
	"publicationSyncRun",
	"publicationSyncState",
	"reader_account",
	"reader_bookmark",
	"reader_collection",
	"reader_collection_invitation_use",
	"reader_collection_item",
	"reader_collection_member",
	"reader_session",
	"reader_user",
	"reader_verification",
	"readingSpend",
	"searchIndexWorker",
	"sourceFileCleanup",
	"sourceRecordAlias",
	"sourceReference",
	"sourceScreening",
	"sourceSnapshot",
	"sourceWritebackJob",
	"status",
	"submissionStatusDelivery",
	"topicAssociationDelivery",
	"topicCatalogCache",
	"topicDeliveryConfiguration",
	"zenodoPublishJournal",
];

/** One message on the page's stream: the parts to read again, or everything after the stream missed changes. */
export type AdminLiveMessage = { topics: readonly AdminLiveTopic[] } | { all: true };
