import type { RecordLicence } from "@/lib/licences";
import type { StudyTypeKey } from "@/lib/readings/study-types";
import {
	canonicalRecordKeyCheck,
	itemIdentity,
	sourceIdentityColumns,
} from "@opendeved/evidence-library-core";
import {
	bigint,
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	unique,
	varchar,
	type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { itemType } from "../enums/itemType";
import { creatorType } from "../enums/creatorType";

type Creator = {
	authorProfileId?: string;
	creatorType: (typeof creatorType.enumValues)[number];
	firstName?: string;
	lastName?: string;
	name?: string;
	institution?: string;
	institutions?: Array<{
		id?: string;
		country_code?: string;
		display_name?: string;
	}>;
};

/**
 * An abstract with words in it: empty once markup, entities for spaces and white space are taken out, as
 * `abstractPlainText` reads it. The sitemap query and the index that serves it (migration 0108) share this text.
 */
export function abstractHasText(abstractNote: AnyPgColumn) {
	return sql`regexp_replace(coalesce(${abstractNote}, ''), '<[^>]*>|&nbsp;|&#160;|[[:space:]]|\u00a0', '', 'g') <> ''`;
}

export const item = pgTable(
	"item",
	{
		key: varchar("key", { length: 8 }).primaryKey(),
		...sourceIdentityColumns(),

		itemType: itemType().notNull().default("Artwork"),
		revision: bigint("revision", { mode: "number" }).notNull().default(1),
		title: varchar(),
		abstractNote: varchar(),
		authority: varchar(),

		creators: jsonb().$type<Creator[]>(),
		topics: varchar().array().notNull().default([]),

		medium: varchar(),
		artworkSize: varchar(),
		date: varchar(),
		originalDate: varchar(),
		shortTitle: varchar(),
		archive: varchar(),
		archiveLocation: varchar(),
		libraryCatalog: varchar(),
		callNumber: varchar(),
		url: varchar(),
		accessDate: varchar(),
		rights: varchar(),
		extra: varchar(),
		seriesTitle: varchar(),
		numberOfVolumes: varchar(),
		volume: varchar(),
		place: varchar(),
		eventPlace: varchar(),
		originalPlace: varchar(),
		runningTime: varchar(),
		ISBN: varchar(),
		code: varchar(),
		section: varchar(),
		session: varchar(),
		history: varchar(),
		series: varchar(),
		seriesNumber: varchar(),
		edition: varchar(),
		publisher: varchar(),
		originalPublisher: varchar(),
		numPages: varchar(),
		pages: varchar(),
		reporter: varchar(),
		versionNumber: varchar(),
		system: varchar(),
		programmingLanguage: varchar(),
		conferenceName: varchar(),
		DOI: varchar(),
		PMCID: varchar(),
		PMID: varchar(),
		committee: varchar(),
		publicationTitle: varchar(),
		issue: varchar(),
		seriesText: varchar(),
		journalAbbreviation: varchar(),
		ISSN: varchar(),
		scale: varchar(),
		note: varchar(),
		annotationType: varchar(),
		annotationAuthorName: varchar(),
		annotationText: varchar(),
		annotationComment: varchar(),
		annotationColor: varchar(),
		annotationPageLabel: varchar(),
		annotationSortIndex: varchar(),
		annotationPosition: varchar(),
		country: varchar(),
		// Library-owned focus. Null derives from title/abstract; [] is explicitly empty.
		countryFocus: varchar().array(),
		// Library-owned. Null leaves open access to OpenAlex; true or false is an editor's choice and wins.
		openAccess: boolean(),
		// Library-owned. Null leaves the study type to the record's reading; a type is an editor's correction and wins.
		studyType: varchar().$type<StudyTypeKey>(),
		// Library-owned. The licence the record's DOI goes out under, on records made in the library. Null until a person
		// picks one or the record's import found one; a record with none can't get a DOI.
		licence: jsonb().$type<RecordLicence>(),
		assignee: varchar(),
		filingDate: varchar(),
		applicationNumber: varchar(),
		priorityNumbers: varchar(),
		references: varchar(),
		meetingName: varchar(),
		codeNumber: varchar(),
		linkMode: varchar(),
		contentType: varchar(),
		filename: varchar(),
		md5: varchar(),
		mtime: varchar(),
		charset: varchar(),
		type: varchar(),
		citationKey: varchar(),
		number: varchar(),
		status: varchar(),
		partNumber: varchar(),
		partTitle: varchar(),

		citation: varchar(),

		dateAdded: timestamp("dateAdded"),
		dateModified: timestamp("dateModified"),

		fullTextPDF: varchar(),
		PDFCoverPageImage: varchar(),
		PDFCoverPageWidth: integer(),
		PDFCoverPageHeight: integer(),

		deleted: integer("deleted").default(0),
		deletedAt: timestamp("deletedAt", { withTimezone: true }),

		languageName: varchar("languageName"),
		parentItem: varchar("parentItem", { length: 8 }),

		relations: jsonb(),

		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		canonicalRecordKeyCheck("item_key_format", table.key),
		unique("item_key_source_connection_unique").on(
			table.key,
			table.sourceConnectionKey,
		),
		foreignKey({
			name: "item_identity_fk",
			columns: [
				table.key,
				table.sourceConnectionKey,
				table.sourceRecordKey,
			],
			foreignColumns: [
				itemIdentity.key,
				itemIdentity.sourceConnectionKey,
				itemIdentity.sourceRecordKey,
			],
		}),
		foreignKey({
			name: "item_parent_fk",
			columns: [table.parentItem],
			foreignColumns: [table.key],
		}),
		index("item_source_connection_idx").on(table.sourceConnectionKey),
		index("item_parent_idx").on(table.parentItem),
		// The records the sitemaps list, in key order: public top-level records with an abstract.
		index("item_sitemap_key_idx").on(table.key).where(sql`coalesce(${table.deleted}, 0) <> 1 AND coalesce(${table.parentItem}, '') = '' AND ${abstractHasText(table.abstractNote)}`),
	],
);
