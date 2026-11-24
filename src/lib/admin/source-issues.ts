import "server-only";

import { sourceConnection } from "@opendeved/evidence-library-core";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getLibraryConfig } from "@/config/library-config/server";
import type { Database } from "@/db/database-schema";
import { adminItemListProjection } from "@/db/schema/tables/adminItemListProjection";
import { item } from "@/db/schema/tables/item";
import { itemSourceLink, sourceRecordIssue, sourceSnapshot } from "@/db/schema/source";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

import { adminFieldLabel } from "./errors";
import { ItemNotFoundError } from "./native-item-service";
import type {
	AdminSourceIssue,
	AdminSourceIssueKind,
	AdminSourceIssueLink,
	AdminSourceIssuePage,
	AdminSourceIssueType,
} from "./types";

type IssueType = {
	key: string;
	kind: AdminSourceIssueKind;
	title: string;
	next: string;
	codes: string[];
	/** Narrows a code that covers several causes, as a SQL LIKE pattern on the message. */
	message?: string;
};

/**
 * What each saved issue means and what to do about it, most specific first.
 * A record's issue belongs to the first type it matches; a record with a
 * left-out field and a file problem is listed under the fields.
 */
const ISSUE_TYPES: IssueType[] = [
	{
		key: "fields",
		kind: "fields",
		title: "Some fields were left out",
		next: "The rest of each record was imported. Fix the named field in Zotero and the next import brings it in.",
		codes: ["zotero_fields_dropped"],
	},
	{
		key: "too-large",
		kind: "large",
		title: "Record too large",
		next: "Only the type and title were kept. Shorten the record's text in Zotero.",
		codes: ["zotero_record_too_large"],
	},
	{
		key: "pdf-not-uploaded",
		kind: "pdf",
		title: "PDF not published",
		next: "Zotero has no uploaded copy of these files, or the filename is empty or longer than 255 characters. In Zotero, sync so each file uploads to group storage, or rename or re-attach it. The next import retries them.",
		codes: ["zotero_file_metadata_invalid"],
		message: "%valid filename and MD5%",
	},
	{
		key: "pdf-link-without-url",
		kind: "pdf",
		title: "Linked PDF has no URL",
		next: "In Zotero, add the web address to each linked attachment. The next import retries them.",
		codes: ["zotero_file_metadata_invalid"],
	},
	{
		key: "pdf-without-parent",
		kind: "pdf",
		title: "PDF not under a record",
		next: "In Zotero, move each file under the record it belongs to.",
		codes: ["zotero_parent_required"],
	},
	{
		key: "pdf-local-file",
		kind: "pdf",
		title: "PDF linked to a local file",
		next: "These attachments point at a file on someone's computer. In Zotero, store the file in the group instead of linking to it.",
		codes: ["zotero_file_unavailable"],
		message: "%linked_url, imported_file, or imported_url%",
	},
	{
		key: "pdf-missing",
		kind: "pdf",
		title: "PDF missing in Zotero",
		next: "Zotero could not provide these files. Check that each is stored in Zotero, then let the next import retry.",
		codes: ["zotero_file_unavailable"],
	},
	{
		key: "pdf-too-large",
		kind: "pdf",
		title: "PDF too large",
		next: "These files are larger than the import allows. Make the PDF smaller in Zotero, or remove its publish tag.",
		codes: ["zotero_file_too_large"],
	},
	{
		key: "pdf-unreadable",
		kind: "pdf",
		title: "PDF could not be read",
		next: "The file is not a readable PDF. Replace it at the source; the rest of the record was imported.",
		codes: ["zotero_pdf_invalid", "openalex_pdf_invalid"],
	},
	{
		key: "pdf-unavailable",
		kind: "pdf",
		title: "PDF not available",
		next: "OpenAlex lists an open-access copy, but no copy could be downloaded from its link, from another site that holds it or from the Internet Archive. The record was imported without it, and a later import looks again.",
		codes: ["openalex_pdf_download_failed"],
	},
	{
		key: "pdf-not-stored",
		kind: "pdf",
		title: "PDF could not be stored",
		next: "The PDF was downloaded but the community could not save it. The next import tries again.",
		codes: ["openalex_pdf_storage_failed"],
	},
	{
		key: "authors",
		kind: "fields",
		title: "Authors incomplete",
		next: "OpenAlex gave more authors or affiliations than a record holds, or authors without a name. The full list stays in the source record.",
		codes: ["incomplete_authorships"],
	},
	{
		key: "no-longer-matched",
		kind: "other",
		title: "No longer in the search",
		next: "No connected OpenAlex search returns these records any more. They were kept because someone edited them. Keep them, or delete them in the editor if they no longer belong.",
		codes: ["source_membership_removed"],
	},
];

const OTHER: Omit<IssueType, "codes"> = {
	key: "other",
	kind: "other",
	title: "Not imported in full",
	next: "The importer could not bring these records in whole. The message on each record says why.",
};

export const SOURCE_ISSUE_TYPE_KEYS: [string, ...string[]] = [
	OTHER.key,
	...ISSUE_TYPES.map(({ key }) => key),
];

/** The issue type of each saved issue, as SQL. */
const issueType: SQL<string> = sql`case ${sql.join(
	ISSUE_TYPES.map(
		(type) =>
			sql`when ${inArray(sourceRecordIssue.code, type.codes)}${
				type.message
					? sql` and ${sourceRecordIssue.message} like ${type.message}`
					: sql``
			} then ${type.key}`,
	),
	sql` `,
)} else ${OTHER.key} end`;

const openIssues = (sourceKey: string) =>
	and(
		eq(sourceRecordIssue.sourceConnectionKey, sourceKey),
		isNull(sourceRecordIssue.dismissedAt),
	);

/** The source's open issues by type, the largest first. */
export async function getAdminSourceIssueTypes(
	db: Database,
	sourceKey: string,
): Promise<AdminSourceIssueType[]> {
	const typed = db
		.select({ type: issueType.as("type") })
		.from(sourceRecordIssue)
		.where(openIssues(sourceKey))
		.as("typed");
	const rows = await db
		.select({ count: sql<number>`count(*)::int`, type: typed.type })
		.from(typed)
		.groupBy(typed.type);
	const counts = new Map(rows.map((row) => [row.type, row.count]));
	return [...ISSUE_TYPES, OTHER]
		.flatMap(({ key, kind, title, next }) => {
			const count = counts.get(key) ?? 0;
			return count > 0 ? [{ count, key, kind, next, title }] : [];
		})
		.sort((left, right) => right.count - left.count);
}

type SourceScope = { provider: string; scopeKind: string; externalScopeKey: string | null };

/** Zotero's own web address for a record, as its last response gave it. */
const ZOTERO_WEB = /^https:\/\/www\.zotero\.org\//u;

/**
 * A work's page on OpenAlex. A PDF record's key is its work's, with ":pdf" after it; a collection paper OpenAlex
 * doesn't have is listed by its DOI, which has no page there.
 */
function openAlexLinks(recordKey: string): AdminSourceIssueLink[] {
	if (recordKey.startsWith("doi:")) return [];
	return [{ kind: "openalex", href: `https://openalex.org/${encodeURIComponent(recordKey.split(":")[0]!)}` }];
}

function sourceLinks(source: SourceScope, recordKey: string, zoteroWeb: string | null): AdminSourceIssueLink[] {
	const key = encodeURIComponent(recordKey);
	if (isOpenAlexWorkProvider(source.provider)) return openAlexLinks(recordKey);
	if (source.provider !== "zotero" || !source.externalScopeKey) return [];
	const scope = encodeURIComponent(source.externalScopeKey);
	const group = source.scopeKind === "group";
	// A personal library's web address holds its owner's user name, which only Zotero's response carries.
	const web = zoteroWeb && ZOTERO_WEB.test(zoteroWeb) ? zoteroWeb : group ? `https://www.zotero.org/groups/${scope}/items/${key}` : null;
	return [
		{ kind: "zotero-app", href: group ? `zotero://select/groups/${scope}/items/${key}` : `zotero://select/library/items/${key}` },
		...(web ? [{ kind: "zotero-web" as const, href: web }] : []),
	];
}

/** "Piper", "Piper and Oyanga" or "Piper et al.", then the year. */
function recordMeta(
	creators: { creatorType: string; lastName?: string; name?: string }[] | null,
	year: number | null,
) {
	const authors = (creators ?? []).filter(({ creatorType }) => creatorType === "author");
	const names = (authors.length > 0 ? authors : (creators ?? []))
		.map((creator) => (creator.lastName ?? creator.name)?.trim())
		.filter(Boolean);
	const who =
		names.length > 2
			? `${names[0]} et al.`
			: names.join(" and ");
	return [who, year].filter(Boolean).join(" ") || null;
}

const DOWNLOAD_FAILURES: [RegExp, string][] = [
	[/returned 40[13]\b/u, "Access denied"],
	[/returned 404\b|returned 410\b/u, "Not found"],
	[/too large/u, "Too large"],
	[/returned 5\d\d\b|timed? ?out|abort/iu, "No answer"],
	[/Private URL|Unsupported URL|redirect/iu, "Link not allowed"],
];

/** The short reason shown beside a record, where the message holds one. */
function issueDetail(type: string, message: string) {
	if (type === "fields") {
		const fields = /left out: (.*?)\.(?: |$)/u.exec(message)?.[1];
		return fields
			? fields.split("; ").map((field) => adminFieldLabel(field.split(" (")[0]!)).join(", ")
			: null;
	}
	if (type === "pdf-unavailable") {
		return DOWNLOAD_FAILURES.find(([test]) => test.test(message))?.[1] ?? null;
	}
	return type === OTHER.key ? message : null;
}

/** One page of a source's open issues of one type, newest first. */
export async function getAdminSourceIssuePage(
	db: Database,
	sourceKey: string,
	type: string,
	page: { offset: number; limit: number },
): Promise<AdminSourceIssuePage> {
	// An attachment's issue is shown on the record it belongs to.
	const parent = alias(item, "parent");
	const record = alias(item, "record");
	const recordKey = sql<string | null>`coalesce(${parent.key}, ${item.key})`;
	const filter = and(openIssues(sourceKey), eq(issueType, type));
	const { hidden } = (await getLibraryConfig()).content.tags;
	// The published top-level record, by the public site's own rule; a draft's tags do not count.
	const visible = publicParentVisibility(db, hidden, record);
	const [[source], [total], rows] = await Promise.all([
		db
			.select({
				externalScopeKey: sourceConnection.externalScopeKey,
				provider: sourceConnection.provider,
				scopeKind: sourceConnection.scopeKind,
			})
			.from(sourceConnection)
			.where(eq(sourceConnection.key, sourceKey)),
		db.select({ count: sql<number>`count(*)::int` }).from(sourceRecordIssue).where(filter),
		db
			.select({
				creators: adminItemListProjection.creators,
				itemKey: recordKey,
				message: sourceRecordIssue.message,
				sourceRecordKey: sourceRecordIssue.sourceRecordKey,
				zoteroWeb: sql<string | null>`${sourceSnapshot.payload}->'links'->'alternate'->>'href'`,
				published: sql<boolean>`(${record.key} is not null and ${visible ?? sql`true`})`,
				title: sql<string | null>`coalesce(${adminItemListProjection.title}, ${parent.title}, ${item.title})`,
				year: adminItemListProjection.year,
			})
			.from(sourceRecordIssue)
			.leftJoin(
				itemSourceLink,
				and(
					eq(itemSourceLink.sourceConnectionKey, sourceRecordIssue.sourceConnectionKey),
					eq(itemSourceLink.sourceRecordKey, sourceRecordIssue.sourceRecordKey),
				),
			)
			.leftJoin(item, eq(item.key, itemSourceLink.itemKey))
			.leftJoin(parent, eq(parent.key, item.parentItem))
			.leftJoin(
				sourceSnapshot,
				and(
					eq(sourceSnapshot.itemKey, item.key),
					eq(sourceSnapshot.sourceConnectionKey, sourceRecordIssue.sourceConnectionKey),
				),
			)
			.leftJoin(record, eq(record.key, recordKey))
			.leftJoin(adminItemListProjection, eq(adminItemListProjection.key, recordKey))
			.where(filter)
			.orderBy(desc(sourceRecordIssue.updatedAt), desc(sourceRecordIssue.sourceRecordKey))
			.offset(page.offset)
			.limit(page.limit),
	]);
	if (!source) throw new ItemNotFoundError(sourceKey);
	return {
		count: total?.count ?? 0,
		issues: rows.map((row) => {
			const links = sourceLinks(source, row.sourceRecordKey, row.zoteroWeb);
			return {
				detail: issueDetail(type, row.message),
				itemKey: row.itemKey,
				links:
					row.published && row.itemKey
						? [...links, { href: `/lib/${row.itemKey}`, kind: "public" }]
						: links,
				message: row.message,
				meta: recordMeta(row.creators, row.year),
				sourceRecordKey: row.sourceRecordKey,
				title: row.title?.trim() || row.sourceRecordKey,
			} satisfies AdminSourceIssue;
		}),
	};
}

/**
 * Dismisses one record's issue or every issue of a type. All of them share
 * the statement's time, to the microsecond, which undo hands back to open
 * exactly them again.
 */
export async function dismissAdminSourceIssues(
	db: Database,
	sourceKey: string,
	target: { record: string } | { type: string },
) {
	const rows = await db
		.update(sourceRecordIssue)
		.set({ dismissedAt: sql`statement_timestamp()` })
		.where(
			and(
				openIssues(sourceKey),
				"record" in target
					? eq(sourceRecordIssue.sourceRecordKey, target.record)
					: eq(issueType, target.type),
			),
		)
		.returning({
			batch: sql<string>`to_char(${sourceRecordIssue.dismissedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		});
	return { batch: rows[0]?.batch ?? null, count: rows.length };
}

/** Opens again the issues one dismissal closed. */
export async function restoreAdminSourceIssues(db: Database, sourceKey: string, batch: string) {
	const rows = await db
		.update(sourceRecordIssue)
		.set({ dismissedAt: null })
		.where(
			and(
				eq(sourceRecordIssue.sourceConnectionKey, sourceKey),
				eq(sourceRecordIssue.dismissedAt, sql`${batch}::timestamptz`),
			),
		)
		.returning({ key: sourceRecordIssue.sourceRecordKey });
	return { count: rows.length };
}
