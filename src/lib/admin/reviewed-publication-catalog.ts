import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";
import { AdminValidationError } from "./errors";
import { publicParentVisibility } from "@/lib/public-item-visibility";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_IDS = 50;

const itemKeySchema = z.string().regex(/^[A-Z0-9]{8}$/u);

const requestSchema = z
	.object({
		cursor: z.string().min(1).nullable().default(null),
		pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
		query: z.string().trim().max(200).default(""),
		ids: z
			.string()
			.transform((value) => [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))])
			.pipe(z.array(itemKeySchema).min(1).max(MAX_IDS))
			.nullable()
			.default(null),
	})
	.superRefine((value, context) => {
		if (value.ids && (value.query || value.cursor)) {
			context.addIssue({ code: "custom", message: "Ask for named publications or for a page, not both", path: ["ids"] });
		}
	});

const cursorSchema = z.object({ v: z.literal(1), at: z.iso.datetime({ offset: true }), key: itemKeySchema });

/** A publication an editor has published through review, as OpenScholar's Home card lists them. `reviewer` is the approving editor's OpenScholar account. */
export type ReviewedPublication = { key: string; title: string; publishedAt: string; reviewer: string };

export function encodeReviewedPublicationCursor(cursor: { at: string; key: string }) {
	return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}

function decodeCursor(encoded: string) {
	try {
		return cursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
	} catch {
		throw new AdminValidationError("The saved position in the list is invalid. Search again.", { cursor: "Search again to start from the first result." });
	}
}

/**
 * The library's reviewed publications, newest approval first, for the Home card's "publication followed" picker:
 * one row per publication (its latest approval), searchable by title, or named by key to show the one chosen. Only
 * publications a reader can see are offered, since the home page would not show a hidden one.
 */
export async function listReviewedPublications(database: Database, input: unknown, hiddenTags: readonly string[]): Promise<{ items: ReviewedPublication[]; nextCursor: string | null }> {
	const request = requestSchema.parse(input);
	const latest = database
		.selectDistinctOn([itemReview.itemKey], { key: itemReview.itemKey, resolvedAt: itemReview.resolvedAt, resolvedBy: itemReview.resolvedBy })
		.from(itemReview)
		.where(and(eq(itemReview.state, "published"), request.ids ? inArray(itemReview.itemKey, request.ids) : undefined))
		// The latest approval per publication, and one answer even when two were saved in the same millisecond.
		.orderBy(itemReview.itemKey, desc(itemReview.resolvedAt), desc(itemReview.submittedAt), desc(itemReview.id))
		.as("latest");
	const cursor = request.cursor ? decodeCursor(request.cursor) : null;
	const pageSize = request.ids ? request.ids.length : request.pageSize;
	const rows = await database
		.select({ key: latest.key, title: item.title, resolvedAt: latest.resolvedAt, resolvedBy: latest.resolvedBy })
		.from(latest)
		.innerJoin(item, eq(item.key, latest.key))
		.where(
			and(
				publicParentVisibility(database, hiddenTags),
				request.query ? ilike(item.title, `%${request.query.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`) : undefined,
				cursor ? sql`(${latest.resolvedAt}, ${latest.key}) < (${cursor.at}::timestamptz, ${cursor.key})` : undefined,
			),
		)
		.orderBy(desc(latest.resolvedAt), desc(latest.key))
		.limit(pageSize + 1);
	const page = rows.slice(0, pageSize).flatMap((row) =>
		row.resolvedAt && row.resolvedBy ? [{ key: row.key, title: row.title || row.key, publishedAt: row.resolvedAt.toISOString(), reviewer: row.resolvedBy }] : [],
	);
	const last = page.at(-1);
	return { items: page, nextCursor: rows.length > pageSize && last ? encodeReviewedPublicationCursor({ at: last.publishedAt, key: last.key }) : null };
}
