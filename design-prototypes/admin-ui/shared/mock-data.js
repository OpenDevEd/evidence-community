/*
 * Seed data shaped after the real backend:
 *  - itemType values: src/db/schema/enums/itemType.ts (all 40 types).
 *  - creator roles:   src/db/schema/enums/creatorType.ts, constrained per
 *    item type like the vendored Zotero schema in native-item-validation.ts.
 *  - sources mirror sourceConnection (native / zotero / openalex providers,
 *    read-only imports in v1 — no Zotero writeback).
 *  - items carry published snapshot + optional itemDraft
 *    (draftRevision/baseRevision optimistic concurrency) and tombstones.
 *  - attachments are child items (itemType "Attachment" + parentItem) with
 *    independent itemFileDraft / itemFilePublication state
 *    (native-file-service.ts).
 *  - collections are hierarchical canonical records
 *    (src/db/schema/tables/collection.ts); membership may cross connections.
 */
window.ProtoData = (function () {
	/*
	 * Mirrors config/library.local.json → identity, rendered the way the real
	 * frontend does it: <img data-library-logo> (LibraryLogoImages.tsx) with
	 * identity.assets.logoStyles applied via buildLibraryLogoCss(). forcedMode
	 * is "dark", so only logoDark is used.
	 */
	const identity = {
		name: "Purple Runtime Library",
		assets: {
			logoDark: "https://edu-works.org/logos/opendeved/logo.png",
			logoStyles: "max-width: 11rem;\nheight: auto;",
		},
	};

	const sources = [
		{
			key: "native",
			provider: "native",
			scopeKind: "library",
			label: "Native library",
			status: "active",
			detail: "records authored in this admin",
			readOnly: false,
		},
		{
			key: "zotero-opendeved",
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "2129771",
			label: "OpenDevEd Evidence",
			status: "active",
			detail: "Zotero group 2129771, synced 14 min ago",
			readOnly: true,
		},
		{
			key: "zotero-heart",
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "2405685",
			label: "HEART Collection",
			status: "paused",
			detail: "Zotero group 2405685, sync paused",
			readOnly: true,
		},
		{
			key: "openalex-edtech",
			provider: "openalex",
			scopeKind: "query",
			label: "OpenAlex sweep",
			status: "active",
			detail: "query import, ran 2 days ago",
			readOnly: true,
		},
	];

	const ITEM_TYPES = [
		"Artwork", "AudioRecording", "Bill", "BlogPost", "Book", "BookSection",
		"Case", "ComputerProgram", "ConferencePaper", "Dataset",
		"DictionaryEntry", "Document", "Email", "EncyclopediaArticle", "Film",
		"ForumPost", "Hearing", "InstantMessage", "Interview",
		"JournalArticle", "Letter", "MagazineArticle", "Manuscript", "Map",
		"NewspaperArticle", "Patent", "Podcast", "Preprint", "Presentation",
		"RadioBroadcast", "Report", "Standard", "Statute", "Thesis",
		"TvBroadcast", "VideoRecording", "Webpage",
	];
	/* Attachment, Note and Annotation exist but are child/system types. */
	const CHILD_TYPES = ["Attachment", "Note", "Annotation"];

	const FIELD_LABELS = {
		publicationTitle: "Publication", volume: "Volume", issue: "Issue",
		pages: "Pages", date: "Date", DOI: "DOI", ISSN: "ISSN", ISBN: "ISBN",
		url: "URL", accessDate: "Access date",
		journalAbbreviation: "Journal abbr.", language: "Language",
		rights: "Rights", extra: "Extra", reportNumber: "Report number",
		reportType: "Report type", seriesTitle: "Series title", place: "Place",
		institution: "Institution", repository: "Repository",
		archiveID: "Archive ID", thesisType: "Thesis type",
		university: "University", numPages: "Number of pages",
		identifier: "Identifier", versionNumber: "Version", format: "Format",
		repositoryLocation: "Repository location", publisher: "Publisher",
		edition: "Edition", proceedingsTitle: "Proceedings",
		conferenceName: "Conference", websiteTitle: "Website title",
		websiteType: "Website type", presentationType: "Type",
		meetingName: "Meeting name", shortTitle: "Short title",
		bookTitle: "Book title", series: "Series", section: "Section",
		blogTitle: "Blog title", medium: "Medium", runningTime: "Running time",
		episodeNumber: "Episode", programmingLanguage: "Language (code)",
		system: "System", company: "Company", scale: "Scale",
		mapType: "Map type", patentNumber: "Patent number",
		assignee: "Assignee", filingDate: "Filing date",
		issueDate: "Issue date", interviewMedium: "Medium",
		manuscriptType: "Manuscript type", artworkMedium: "Medium",
		artworkSize: "Size", audioRecordingFormat: "Format",
		videoRecordingFormat: "Format", studio: "Studio",
		network: "Network", distributor: "Distributor", genre: "Genre",
		standardNumber: "Standard number", organization: "Organization",
		committee: "Committee", type: "Type",
	};

	const COMMON_TAIL = ["shortTitle", "url", "accessDate", "language", "rights", "extra"];
	const typeFields = {
		JournalArticle: ["publicationTitle", "volume", "issue", "pages", "date", "journalAbbreviation", "DOI", "ISSN"].concat(COMMON_TAIL),
		Report: ["reportNumber", "reportType", "seriesTitle", "institution", "place", "date", "pages", "DOI"].concat(COMMON_TAIL),
		Preprint: ["repository", "archiveID", "date", "DOI", "series"].concat(COMMON_TAIL),
		Thesis: ["thesisType", "university", "place", "date", "numPages"].concat(COMMON_TAIL),
		Dataset: ["identifier", "versionNumber", "repository", "repositoryLocation", "format", "DOI", "date"].concat(COMMON_TAIL),
		Book: ["publisher", "place", "edition", "series", "numPages", "ISBN", "date"].concat(COMMON_TAIL),
		BookSection: ["bookTitle", "publisher", "place", "edition", "pages", "ISBN", "date"].concat(COMMON_TAIL),
		ConferencePaper: ["proceedingsTitle", "conferenceName", "place", "publisher", "pages", "DOI", "date"].concat(COMMON_TAIL),
		Webpage: ["websiteTitle", "websiteType", "date"].concat(COMMON_TAIL),
		Document: ["publisher", "place", "date"].concat(COMMON_TAIL),
		Presentation: ["presentationType", "meetingName", "place", "date"].concat(COMMON_TAIL),
		BlogPost: ["blogTitle", "websiteType", "date"].concat(COMMON_TAIL),
		MagazineArticle: ["publicationTitle", "volume", "issue", "pages", "date", "ISSN"].concat(COMMON_TAIL),
		NewspaperArticle: ["publicationTitle", "place", "edition", "section", "pages", "date", "ISSN"].concat(COMMON_TAIL),
		Manuscript: ["manuscriptType", "place", "date", "numPages"].concat(COMMON_TAIL),
		Map: ["mapType", "scale", "seriesTitle", "edition", "publisher", "place", "date", "ISBN"].concat(COMMON_TAIL),
		Patent: ["patentNumber", "assignee", "place", "filingDate", "issueDate", "pages"].concat(COMMON_TAIL),
		Podcast: ["seriesTitle", "episodeNumber", "medium", "runningTime"].concat(COMMON_TAIL),
		Interview: ["interviewMedium", "date"].concat(COMMON_TAIL),
		ComputerProgram: ["versionNumber", "system", "place", "company", "programmingLanguage", "date", "ISBN"].concat(COMMON_TAIL),
		Film: ["distributor", "genre", "videoRecordingFormat", "runningTime", "date"].concat(COMMON_TAIL),
		Standard: ["organization", "committee", "type", "standardNumber", "versionNumber", "publisher", "date", "DOI"].concat(COMMON_TAIL),
		Attachment: ["url", "accessDate"],
	};
	const GENERIC_FIELDS = ["date", "medium", "place"].concat(COMMON_TAIL);
	function fieldsForType(t) {
		return typeFields[t] || GENERIC_FIELDS;
	}

	const CREATOR_ROLES = {
		JournalArticle: ["author", "contributor", "editor", "reviewedAuthor", "translator"],
		Report: ["author", "contributor", "seriesEditor", "translator"],
		Preprint: ["author", "contributor", "editor", "reviewedAuthor", "translator"],
		Book: ["author", "contributor", "editor", "seriesEditor", "translator"],
		BookSection: ["author", "bookAuthor", "contributor", "editor", "seriesEditor", "translator"],
		ConferencePaper: ["author", "contributor", "editor", "seriesEditor", "translator"],
		Thesis: ["author", "contributor"],
		Dataset: ["author", "contributor"],
		Presentation: ["presenter", "contributor"],
		Webpage: ["author", "contributor", "translator"],
		BlogPost: ["author", "commenter", "contributor"],
		Film: ["director", "contributor", "producer", "scriptwriter"],
		Podcast: ["podcaster", "contributor", "guest"],
		Interview: ["interviewee", "contributor", "interviewer", "translator"],
		Patent: ["inventor", "attorneyAgent", "contributor"],
		ComputerProgram: ["programmer", "contributor"],
		Map: ["cartographer", "contributor", "seriesEditor"],
		Standard: ["author", "contributor"],
	};
	const GENERIC_ROLES = ["author", "contributor", "editor", "translator"];
	function rolesForType(t) {
		return CREATOR_ROLES[t] || GENERIC_ROLES;
	}

	/*
	 * Collections: canonical hierarchical records. Parent must stay within
	 * the same source connection; membership may cross connections (a native
	 * curated collection may hold imported items).
	 */
	const collections = [
		{ key: "CFEATURD", sourceKey: "native", name: "Featured evidence", parentCollection: null, description: "Hand-picked records surfaced on the library home page.", visibility: "published", deleted: false, revision: 3 },
		{ key: "CSPTLT26", sourceKey: "native", name: "2026 spotlight", parentCollection: "CFEATURD", description: "", visibility: "published", deleted: false, revision: 1 },
		{ key: "CREVIEWQ", sourceKey: "native", name: "Review queue", parentCollection: null, description: "Records waiting for an editorial pass before publication.", visibility: "private", deleted: false, revision: 5 },
		{ key: "CRETIRED", sourceKey: "native", name: "Retired highlights", parentCollection: "CFEATURD", description: "", visibility: "private", deleted: true, revision: 2 },
		{ key: "CZEDTECH", sourceKey: "zotero-opendeved", name: "EdTech & Learning Outcomes", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 11 },
		{ key: "CZPERSNL", sourceKey: "zotero-opendeved", name: "Personalised learning", parentCollection: "CZEDTECH", description: "", visibility: "published", deleted: false, revision: 4 },
		{ key: "CZASSESS", sourceKey: "zotero-opendeved", name: "Assessment at scale", parentCollection: "CZEDTECH", description: "", visibility: "published", deleted: false, revision: 2 },
		{ key: "CZTPDEVT", sourceKey: "zotero-opendeved", name: "Teacher Professional Development", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 7 },
		{ key: "CZCSTEFB", sourceKey: "zotero-opendeved", name: "Cost-Effectiveness", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 6 },
		{ key: "CZGIRLSE", sourceKey: "zotero-opendeved", name: "Girls' Education", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 3 },
		{ key: "CZEMERGE", sourceKey: "zotero-opendeved", name: "Education in Emergencies", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 5 },
		{ key: "CHREADNG", sourceKey: "zotero-heart", name: "HEART reading list", parentCollection: null, description: "", visibility: "published", deleted: false, revision: 2 },
	];

	/*
	 * Items. published = full editable snapshot (null for unpublished
	 * shells). draft mirrors itemDraft. Attachments carry fileDraft
	 * (itemFileDraft) and filePublication (itemFilePublication).
	 */
	function creator(role, last, first) {
		return { creatorType: role, firstName: first, lastName: last };
	}
	function corp(role, name) {
		return { creatorType: role, name: name };
	}

	const items = [
		/* ---- imported, published, with a published imported PDF ---------- */
		{
			key: "Q3JV8KND", sourceKey: "zotero-opendeved", sourceRecordKey: "Q3JV8KND",
			itemType: "JournalArticle", parentItem: null,
			revision: 6, deleted: false,
			dateAdded: "2025-04-02", dateModified: "2026-06-12",
			published: {
				itemType: "JournalArticle",
				title: "Technology-Supported Personalised Learning and Foundational Numeracy: A Randomised Trial in Malawi",
				abstractNote: "A cluster-randomised trial across 124 primary schools in Malawi's Southern Region evaluating a tablet-based personalised learning programme. After two terms, treated pupils gained 0.24 SD in foundational numeracy; effects were largest for the bottom tercile.",
				creators: [creator("author", "Kaliati", "Fatima"), creator("author", "Mwale", "Limbani"), creator("author", "Banda", "Chikondi")],
				tags: ["numeracy", "RCT", "Malawi", "personalised learning"],
				collections: ["CZEDTECH", "CZPERSNL", "CFEATURD"],
				fields: {
					publicationTitle: "Journal of Development Effectiveness",
					volume: "17", issue: "2", pages: "144-168", date: "2025-03",
					DOI: "10.1080/19439342.2025.1148329", ISSN: "1943-9342",
					url: "https://doi.org/10.1080/19439342.2025.1148329",
					accessDate: "2025-04-02", language: "English",
				},
			},
			draft: null,
			history: [
				{ at: "2025-04-02 09:14", event: "Imported from OpenDevEd Evidence" },
				{ at: "2026-06-12 16:02", event: "Source update applied", detail: "revision 6" },
			],
		},
		{
			key: "QATTKNDE", sourceKey: "zotero-opendeved", sourceRecordKey: "QATTKNDE",
			itemType: "Attachment", parentItem: "Q3JV8KND",
			revision: 3, deleted: false,
			dateAdded: "2025-04-02", dateModified: "2025-04-02",
			published: {
				itemType: "Attachment", title: "Full text PDF",
				creators: [], tags: [], collections: [], fields: {},
			},
			draft: null,
			fileDraft: null,
			filePublication: {
				uploadRevision: 1, filename: "Kaliati_2025_PersonalisedLearning.pdf",
				sizeBytes: 1834722, sha256: "b4c1d9e2a77f0c34d16e8b90ff21a6c3d5e47a1908b2c6d4e0f13a57c8b9d201",
				pageCount: 25, publishedAt: "2025-04-02",
				publicUrl: "https://files.example.org/zotero/Q3JV8KND/file.pdf",
				coverFrom: "#3b2d5e", coverTo: "#171226",
			},
			history: [{ at: "2025-04-02 09:14", event: "Imported with parent record" }],
		},

		/* ---- native, published with unpublished draft edits + pub. PDF --- */
		{
			key: "N4KD7WPU", sourceKey: "native", sourceRecordKey: "N4KD7WPU",
			itemType: "Report", parentItem: null,
			revision: 7, deleted: false,
			dateAdded: "2024-11-20", dateModified: "2026-07-18",
			published: {
				itemType: "Report",
				title: "EdTech in Senegal: A Rapid Scan",
				abstractNote: "Country scan of Senegal's EdTech ecosystem: policy, infrastructure, key programmes (PAQUET, Sunukaddu), donor landscape, and gaps in the evidence base.",
				creators: [creator("author", "Barry", "Mariama"), creator("author", "Haßler", "Björn")],
				tags: ["Senegal", "country scan"],
				collections: ["CZEDTECH", "CFEATURD"],
				fields: {
					reportNumber: "12", reportType: "Rapid Evidence Scan",
					seriesTitle: "OpenDevEd Rapid Scans",
					institution: "Open Development & Education", place: "London",
					date: "2024-11", DOI: "10.53832/opendeved.1112",
					url: "https://doi.org/10.53832/opendeved.1112", language: "English",
				},
			},
			draft: {
				draftRevision: 4, baseRevision: 7, savedAt: "2026-07-18 11:40",
				payload: {
					itemType: "Report",
					title: "EdTech in Senegal: A Rapid Scan (2nd edition)",
					abstractNote: "Country scan of Senegal's EdTech ecosystem: policy, infrastructure, key programmes (PAQUET, Sunukaddu), donor landscape, and gaps in the evidence base. Second edition adds 2025-2026 programme updates.",
					creators: [creator("author", "Barry", "Mariama"), creator("author", "Haßler", "Björn")],
					tags: ["Senegal", "country scan"],
					collections: ["CZEDTECH", "CFEATURD", "CSPTLT26"],
					fields: {
						reportNumber: "12", reportType: "Rapid Evidence Scan",
						seriesTitle: "OpenDevEd Rapid Scans",
						institution: "Open Development & Education", place: "London",
						date: "2024-11", DOI: "10.53832/opendeved.1112",
						url: "https://doi.org/10.53832/opendeved.1112", language: "English",
					},
				},
			},
			history: [
				{ at: "2024-11-20 10:01", event: "Created" },
				{ at: "2024-11-21 09:30", event: "Published", detail: "revision 1" },
				{ at: "2026-07-18 11:40", event: "Draft saved", detail: "draft revision 4" },
			],
		},
		{
			key: "NATTWPUA", sourceKey: "native", sourceRecordKey: "NATTWPUA",
			itemType: "Attachment", parentItem: "N4KD7WPU",
			revision: 4, deleted: false,
			dateAdded: "2024-11-21", dateModified: "2026-07-11",
			published: {
				itemType: "Attachment", title: "Report PDF (v2)",
				creators: [], tags: [], collections: [], fields: {},
			},
			draft: null,
			fileDraft: null,
			filePublication: {
				uploadRevision: 2, filename: "OpenDevEd_RapidScan12_Senegal_v2.pdf",
				sizeBytes: 2417093, sha256: "8e1f5a2b90c4d7e6f3a8b1c2d9e0f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1",
				pageCount: 42, publishedAt: "2026-07-11",
				publicUrl: "https://files.example.org/native/NATTWPUA/8e1f5a2b/file.pdf",
				coverFrom: "#1f4a3d", coverTo: "#0e1f1a",
			},
			history: [
				{ at: "2024-11-21 09:31", event: "Attachment published" },
				{ at: "2026-07-11 14:20", event: "PDF replaced and published", detail: "upload revision 2" },
			],
		},

		/* ---- native draft shell (never published) + staged-ready PDF ----- */
		{
			key: "R8KM5AWQ", sourceKey: "native", sourceRecordKey: "R8KM5AWQ",
			itemType: "Report", parentItem: null,
			revision: 0, deleted: false,
			dateAdded: "2026-06-02", dateModified: "2026-07-29",
			published: null,
			draft: {
				draftRevision: 6, baseRevision: 0, savedAt: "2026-07-29 18:12",
				payload: {
					itemType: "Report",
					title: "Solar-Powered Offline Servers for School Content Delivery: Field Trial Results from Amhara",
					abstractNote: "Twelve-month field trial of solar-powered Raspberry Pi content servers in 40 schools in Amhara, Ethiopia: uptime, maintenance burden, content usage telemetry, and unit economics.",
					creators: [creator("author", "Haßler", "Björn"), creator("author", "Khalayleh", "Abdullah")],
					tags: ["offline-first", "Ethiopia", "hardware"],
					collections: ["CZEDTECH", "CREVIEWQ"],
					fields: {
						reportNumber: "TR-31", reportType: "Technical Report",
						institution: "Open Development & Education", place: "London",
						date: "2026-05", DOI: "10.53832/opendeved.1187", language: "English",
					},
				},
			},
			history: [
				{ at: "2026-06-02 08:55", event: "Created" },
				{ at: "2026-07-29 18:12", event: "Draft saved", detail: "draft revision 6" },
			],
		},
		{
			key: "NATTAWQB", sourceKey: "native", sourceRecordKey: "NATTAWQB",
			itemType: "Attachment", parentItem: "R8KM5AWQ",
			revision: 0, deleted: false,
			dateAdded: "2026-07-28", dateModified: "2026-07-29",
			published: null,
			draft: {
				draftRevision: 1, baseRevision: 0, savedAt: "2026-07-28 17:03",
				payload: {
					itemType: "Attachment", title: "Draft report PDF",
					creators: [], tags: [], collections: [], fields: {},
				},
			},
			fileDraft: {
				uploadRevision: 1, filename: "TR31_solar_offline_servers_draft.pdf",
				sizeBytes: 3145160, status: "ready", progress: 100,
				sha256: "5d0a9c8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
				pageCount: 58, textExtracted: true,
				coverFrom: "#4a3a1f", coverTo: "#1f180e",
			},
			filePublication: null,
			history: [
				{ at: "2026-07-28 17:03", event: "Attachment created" },
				{ at: "2026-07-29 18:15", event: "PDF staged and verified", detail: "upload revision 1" },
			],
		},

		/* ---- native, published, PDF upload failed checksum --------------- */
		{
			key: "W2PL9JQF", sourceKey: "native", sourceRecordKey: "W2PL9JQF",
			itemType: "Preprint", parentItem: null,
			revision: 3, deleted: false,
			dateAdded: "2026-02-11", dateModified: "2026-07-25",
			published: {
				itemType: "Preprint",
				title: "Large Language Models as Tutors in Low-Resource Classrooms: Early Evidence and Open Questions",
				abstractNote: "Reviews eleven early deployments of LLM-based tutoring in LMIC classrooms. Discusses cost per learner-hour, hallucination risk in local-language instruction, and evaluation design gaps.",
				creators: [creator("author", "Adam", "Taskeen"), creator("author", "Mitchell", "Joel")],
				tags: ["LLM", "tutoring", "preprint"],
				collections: ["CZEDTECH"],
				fields: {
					repository: "EdArXiv", archiveID: "edarxiv/8kq2v",
					date: "2026-02", DOI: "10.35542/osf.io/8kq2v",
					url: "https://edarxiv.org/8kq2v", language: "English",
				},
			},
			draft: null,
			history: [
				{ at: "2026-02-11 12:40", event: "Created" },
				{ at: "2026-02-12 10:05", event: "Published", detail: "revision 1" },
			],
		},
		{
			key: "NATTJQFC", sourceKey: "native", sourceRecordKey: "NATTJQFC",
			itemType: "Attachment", parentItem: "W2PL9JQF",
			revision: 1, deleted: false,
			dateAdded: "2026-07-25", dateModified: "2026-07-25",
			published: {
				itemType: "Attachment", title: "Preprint PDF",
				creators: [], tags: [], collections: [], fields: {},
			},
			draft: null,
			fileDraft: {
				uploadRevision: 3, filename: "LLM_tutors_draft3.pdf",
				sizeBytes: 1266005, status: "error", progress: 100,
				error: "Uploaded PDF does not match its declared size and SHA-256",
				sha256: null, pageCount: null, textExtracted: false,
			},
			filePublication: null,
			history: [
				{ at: "2026-07-25 15:44", event: "Attachment published" },
				{ at: "2026-07-25 15:52", event: "PDF verification failed", detail: "upload revision 3" },
			],
		},

		/* ---- native with stale draft (conflict demo) --------------------- */
		{
			key: "J4NS9BTL", sourceKey: "native", sourceRecordKey: "J4NS9BTL",
			itemType: "Document", parentItem: null,
			revision: 5, deleted: false,
			dateAdded: "2025-10-06", dateModified: "2026-01-15",
			published: {
				itemType: "Document",
				title: "Ministry of Education Tablet Programme: Mid-Term Review (Internal)",
				abstractNote: "",
				creators: [corp("author", "Directorate of Planning, Ministry of Education")],
				tags: ["internal", "mid-term review"],
				collections: ["CREVIEWQ"],
				fields: { place: "Kigali", date: "2025-09", language: "English", rights: "Internal, do not redistribute" },
			},
			draft: {
				draftRevision: 2, baseRevision: 3, savedAt: "2026-01-09 09:20",
				payload: {
					itemType: "Document",
					title: "Ministry of Education Tablet Programme: Mid-Term Review",
					abstractNote: "",
					creators: [corp("author", "Directorate of Planning, Ministry of Education")],
					tags: ["internal", "mid-term review"],
					collections: ["CREVIEWQ"],
					fields: { place: "Kigali", date: "2025-09", language: "English", rights: "Internal, do not redistribute" },
				},
			},
			history: [
				{ at: "2025-10-06 11:22", event: "Created" },
				{ at: "2025-10-08 09:00", event: "Published", detail: "revision 1" },
				{ at: "2026-01-15 13:45", event: "Published from another session", detail: "revision 5, draft is stale" },
			],
		},

		/* ---- tombstoned native item (restore demo) ----------------------- */
		{
			key: "H6VN2SBM", sourceKey: "native", sourceRecordKey: "H6VN2SBM",
			itemType: "Thesis", parentItem: null,
			revision: 2, deleted: true, deletedAt: "2026-06-30",
			dateAdded: "2026-06-01", dateModified: "2026-06-30",
			published: {
				itemType: "Thesis",
				title: "Community Participation and School Governance in Rural Morocco",
				abstractNote: "",
				creators: [creator("author", "El Amrani", "Yasmine")],
				tags: ["Morocco", "governance"],
				collections: [],
				fields: { thesisType: "PhD dissertation", university: "Mohammed V University", place: "Rabat", date: "2023", numPages: "214", language: "French" },
			},
			draft: null,
			history: [
				{ at: "2026-06-01 10:12", event: "Created" },
				{ at: "2026-06-02 09:40", event: "Published", detail: "revision 1" },
				{ at: "2026-06-30 16:20", event: "Unpublished", detail: "tombstoned, revision 2" },
			],
		},

		/* ---- remaining imported records ----------------------------------- */
		{
			key: "B7MX2QRT", sourceKey: "zotero-opendeved", sourceRecordKey: "B7MX2QRT",
			itemType: "Report", parentItem: null,
			revision: 2, deleted: false,
			dateAdded: "2021-09-14", dateModified: "2025-11-03",
			published: {
				itemType: "Report",
				title: "The Effect of Mobile Phone-Based Tutoring During School Closures: Evidence from Sierra Leone",
				abstractNote: "Randomised evaluation of low-tech phone tutoring plus SMS nudges during COVID-19 school closures. No detectable learning gains on average, but enrolment on reopening rose by 3 percentage points.",
				creators: [creator("author", "Crawfurd", "Lee"), creator("author", "Hares", "Susannah"), creator("author", "Minardi", "Ana Luiza")],
				tags: ["Sierra Leone", "tutoring", "COVID-19"],
				collections: ["CZEMERGE"],
				fields: { reportNumber: "591", reportType: "Working Paper", institution: "Center for Global Development", place: "Washington, DC", date: "2021-08", pages: "38", url: "https://www.cgdev.org/publication/effect-mobile-phone-based-tutoring", language: "English" },
			},
			draft: null,
			history: [{ at: "2021-09-14 09:00", event: "Imported from OpenDevEd Evidence" }],
		},
		{
			key: "T8RC3HXV", sourceKey: "zotero-opendeved", sourceRecordKey: "T8RC3HXV",
			itemType: "JournalArticle", parentItem: null,
			revision: 3, deleted: false,
			dateAdded: "2022-07-01", dateModified: "2025-02-19",
			published: {
				itemType: "JournalArticle",
				title: "Teacher Professional Development in Low-Connectivity Settings: A Systematic Review",
				abstractNote: "Systematic review of 170 studies on technology-mediated teacher professional development in low- and middle-income countries, with attention to sustainability and cost.",
				creators: [creator("author", "Hennessy", "Sara"), creator("author", "D'Angelo", "Sophia"), creator("author", "Koomar", "Saalim")],
				tags: ["TPD", "systematic review"],
				collections: ["CZTPDEVT"],
				fields: { publicationTitle: "Computers and Education Open", volume: "3", pages: "100080", date: "2022-06", DOI: "10.1016/j.caeo.2022.100080", url: "https://doi.org/10.1016/j.caeo.2022.100080", language: "English" },
			},
			draft: null,
			history: [{ at: "2022-07-01 09:00", event: "Imported from OpenDevEd Evidence" }],
		},
		{
			key: "K7TB6RDJ", sourceKey: "zotero-opendeved", sourceRecordKey: "K7TB6RDJ",
			itemType: "ConferencePaper", parentItem: null,
			revision: 5, deleted: false,
			dateAdded: "2025-08-02", dateModified: "2026-07-11",
			published: {
				itemType: "ConferencePaper",
				title: "Adaptive Assessment at Scale: Deployment Lessons from Tanzania",
				abstractNote: "Reports on a national-scale deployment of computerised adaptive testing across 1,900 Tanzanian schools, including item-bank calibration in Kiswahili and offline-first sync design.",
				creators: [creator("author", "Mrisho", "Amani"), creator("author", "Kimaro", "Honest")],
				tags: ["assessment", "Tanzania", "at scale"],
				collections: ["CZEDTECH", "CZASSESS", "CFEATURD"],
				fields: { proceedingsTitle: "Proceedings of the 12th ACM Conference on Learning @ Scale", conferenceName: "L@S 2025", place: "Toronto", publisher: "ACM", pages: "211-220", date: "2025-07", DOI: "10.1145/3657604.3662031", url: "https://doi.org/10.1145/3657604.3662031" },
			},
			draft: null,
			history: [{ at: "2025-08-02 09:00", event: "Imported from OpenDevEd Evidence" }],
		},
		{
			key: "M3XZ4CVW", sourceKey: "zotero-heart", sourceRecordKey: "M3XZ4CVW",
			itemType: "Report", parentItem: null,
			revision: 2, deleted: false,
			dateAdded: "2023-05-22", dateModified: "2024-10-30",
			published: {
				itemType: "Report",
				title: "Keeping Girls in School: Cash Transfers and Digital Attendance Registers in Punjab",
				abstractNote: "",
				creators: [creator("author", "Zubairi", "Asma"), creator("author", "Rose", "Pauline")],
				tags: ["girls' education", "cash transfers", "Pakistan"],
				collections: ["CZGIRLSE", "CZCSTEFB", "CHREADNG"],
				fields: { reportType: "Policy Brief", institution: "REAL Centre, University of Cambridge", place: "Cambridge", date: "2023-04", pages: "24", url: "https://www.educ.cam.ac.uk/centres/real/", language: "English" },
			},
			draft: null,
			history: [{ at: "2023-05-22 09:00", event: "Imported from HEART Collection" }],
		},
		{
			key: "D9QW5TKC", sourceKey: "zotero-heart", sourceRecordKey: "D9QW5TKC",
			itemType: "Dataset", parentItem: null,
			revision: 2, deleted: false,
			dateAdded: "2024-02-08", dateModified: "2024-02-08",
			published: {
				itemType: "Dataset",
				title: "Harmonised Learning Outcomes (HLO) Panel, 2000-2023",
				abstractNote: "Panel of harmonised, comparable learning outcomes covering 164 countries, 2000-2023.",
				creators: [creator("author", "Angrist", "Noam"), creator("author", "Djankov", "Simeon"), creator("author", "Goldberg", "Pinelopi"), creator("author", "Patrinos", "Harry A.")],
				tags: ["learning outcomes", "panel data"],
				collections: ["CHREADNG"],
				fields: { identifier: "hdl:10986/38001", versionNumber: "3.1", repository: "World Bank Microdata Library", format: "CSV, Stata", date: "2024-01", url: "https://datacatalog.worldbank.org/search/dataset/0038001" },
			},
			draft: null,
			history: [{ at: "2024-02-08 09:00", event: "Imported from HEART Collection" }],
		},
		{
			key: "F5GY8ZLN", sourceKey: "openalex-edtech", sourceRecordKey: "W4390812345",
			itemType: "JournalArticle", parentItem: null,
			revision: 1, deleted: false,
			dateAdded: "2026-07-27", dateModified: "2026-07-27",
			published: {
				itemType: "JournalArticle",
				title: "Radio Instruction and Learning Continuity in Emergencies: Evidence from Twelve Programmes",
				abstractNote: "",
				creators: [creator("author", "Damani", "Kalifa"), creator("author", "Mitchell", "Joel")],
				tags: ["radio instruction", "emergencies"],
				collections: ["CZEMERGE"],
				fields: { publicationTitle: "International Journal of Educational Development", volume: "96", pages: "102690", date: "2023-01", DOI: "10.1016/j.ijedudev.2022.102690", url: "https://doi.org/10.1016/j.ijedudev.2022.102690", language: "English" },
			},
			draft: null,
			history: [{ at: "2026-07-27 03:30", event: "Imported from OpenAlex sweep" }],
		},
		{
			key: "V6FJ3MYE", sourceKey: "openalex-edtech", sourceRecordKey: "W4381276890",
			itemType: "JournalArticle", parentItem: null,
			revision: 1, deleted: false,
			dateAdded: "2026-07-27", dateModified: "2026-07-27",
			published: {
				itemType: "JournalArticle",
				title: "How Cost-Effective Are Structured Pedagogy Programmes? A Meta-Analysis",
				abstractNote: "",
				creators: [creator("author", "Evans", "David K."), creator("author", "Yuan", "Fei")],
				tags: ["structured pedagogy", "meta-analysis"],
				collections: ["CZCSTEFB"],
				fields: { publicationTitle: "The World Bank Research Observer", volume: "37", issue: "1", pages: "73-106", date: "2022-02", DOI: "10.1093/wbro/lkab005", url: "https://doi.org/10.1093/wbro/lkab005", language: "English" },
			},
			draft: null,
			history: [{ at: "2026-07-27 03:30", event: "Imported from OpenAlex sweep" }],
		},
		{
			key: "P2ZQ8HRY", sourceKey: "native", sourceRecordKey: "P2ZQ8HRY",
			itemType: "Presentation", parentItem: null,
			revision: 3, deleted: false,
			dateAdded: "2024-09-30", dateModified: "2025-01-09",
			published: {
				itemType: "Presentation",
				title: "Evidence Standards for EdTech: What Should Count?",
				abstractNote: "",
				creators: [creator("presenter", "Haßler", "Björn")],
				tags: ["evidence standards", "keynote"],
				collections: ["CFEATURD"],
				fields: { presentationType: "Keynote", meetingName: "mEducation Alliance Symposium", place: "Washington, DC", date: "2024-09" },
			},
			draft: null,
			history: [
				{ at: "2024-09-30 10:00", event: "Created" },
				{ at: "2024-10-01 09:00", event: "Published", detail: "revision 1" },
			],
		},
		{
			key: "S7HD2NPG", sourceKey: "zotero-opendeved", sourceRecordKey: "S7HD2NPG",
			itemType: "Webpage", parentItem: null,
			revision: 1, deleted: false,
			dateAdded: "2026-05-14", dateModified: "2026-05-14",
			published: {
				itemType: "Webpage",
				title: "ICT in Education Policy Toolkit",
				abstractNote: "",
				creators: [corp("author", "UNESCO")],
				tags: ["policy", "toolkit"],
				collections: [],
				fields: { websiteTitle: "UNESCO", websiteType: "Toolkit", date: "2024", url: "https://ict-edu-toolkit.unesco.org", accessDate: "2026-05-14", language: "English" },
			},
			draft: null,
			history: [{ at: "2026-05-14 09:00", event: "Imported from OpenDevEd Evidence" }],
		},
	];

	return {
		identity, sources, collections, items,
		ITEM_TYPES, CHILD_TYPES, FIELD_LABELS,
		typeFields, fieldsForType, rolesForType,
	};
})();
