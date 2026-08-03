import {
	type AnyPgColumn,
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

function numericCursorExpression(
	column: AnyPgColumn,
	nullValue: number,
	direction: "ASC" | "DESC" = "ASC",
) {
	const inlineNullValue = sql.raw(String(nullValue));
	return direction === "DESC"
		? sql`coalesce(${column}, ${inlineNullValue}) DESC`
		: sql`coalesce(${column}, ${inlineNullValue})`;
}

type ProjectedCreator = {
	creatorType: string;
	firstName?: string;
	lastName?: string;
	name?: string;
};

export const adminItemListProjection = pgTable(
	"adminItemListProjection",
	{
		key: varchar("key", { length: 8 }).primaryKey(),
		itemType: text("itemType").notNull(),
		title: text("title").notNull(),
		titleSort: text("titleSort").notNull(),
		creators: jsonb("creators")
			.$type<ProjectedCreator[]>()
			.notNull()
			.default([]),
		creatorNames: text("creatorNames").array().notNull().default([]),
		date: text("date"),
		year: integer("year"),
		sourceConnectionKey: varchar("sourceConnectionKey", {
			length: 64,
		}).notNull(),
		revision: bigint("revision", { mode: "number" }).notNull(),
		state: text("state", {
			enum: ["deleted", "draft", "edited", "published"],
		}).notNull(),
		fileState: text("fileState", {
			enum: ["none", "processing", "staged", "published"],
		}).notNull(),
		updatedAt: timestamp("updatedAt", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		dateAdded: timestamp("dateAdded", {
			withTimezone: true,
			mode: "date",
		}),
		collections: text("collections").array().notNull().default([]),
		tags: text("tags").array().notNull().default([]),
		pageCount: integer("pageCount"),
		searchText: text("searchText").notNull(),
	},
	(table) => [
		index("adminItemListProjection_updated_idx").on(
			table.updatedAt,
			table.key,
		),
		index("adminItemListProjection_title_idx").on(
			table.titleSort,
			table.key,
		),
		index("adminItemListProjection_year_idx").on(table.year, table.key),
		index("adminItemListProjection_year_cursor_asc_idx").on(
			numericCursorExpression(table.year, 2_147_483_647),
			table.key,
		),
		index("adminItemListProjection_year_cursor_desc_idx").on(
			numericCursorExpression(table.year, -2_147_483_648, "DESC"),
			table.key.desc().nullsFirst(),
		),
		index("adminItemListProjection_item_type_idx").on(
			table.itemType,
			table.key,
		),
		index("adminItemListProjection_page_count_idx").on(
			table.pageCount,
			table.key,
		),
		index("adminItemListProjection_page_count_cursor_asc_idx").on(
			numericCursorExpression(table.pageCount, 2_147_483_647),
			table.key,
		),
		index("adminItemListProjection_page_count_cursor_desc_idx").on(
			numericCursorExpression(
				table.pageCount,
				-2_147_483_648,
				"DESC",
			),
			table.key.desc().nullsFirst(),
		),
		index("adminItemListProjection_source_idx").on(
			table.sourceConnectionKey,
		),
		index("adminItemListProjection_state_idx").on(table.state),
		index("adminItemListProjection_file_state_idx").on(table.fileState),
		index("adminItemListProjection_collections_idx").using(
			"gin",
			table.collections,
		),
		index("adminItemListProjection_tags_idx").using("gin", table.tags),
	],
);
