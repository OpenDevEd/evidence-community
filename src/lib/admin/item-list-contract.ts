import { z } from "zod";

import {
	ADMIN_ITEM_MAX_PAGE_SIZE,
	ADMIN_ITEM_PAGE_SIZE,
} from "./constants";

export type AdminItemColumnKind =
	| "date"
	| "enum"
	| "number"
	| "people"
	| "relation"
	| "selection"
	| "text";

export const ADMIN_ITEM_FILTER_OPERATORS = [
	"after",
	"anyOf",
	"before",
	"between",
	"contains",
	"equals",
	"hasNoValue",
	"hasValue",
] as const;

export type AdminItemFilterOperator =
	(typeof ADMIN_ITEM_FILTER_OPERATORS)[number];

type AdminItemListColumnDefinitionShape = {
	defaultVisible: boolean;
	filterable: boolean;
	filterOperators: readonly AdminItemFilterOperator[];
	id: string;
	kind: AdminItemColumnKind;
	label: string;
	optional: boolean;
	sortable: boolean;
};

export const ADMIN_ITEM_LIST_COLUMNS = [
	{
		defaultVisible: true,
		filterable: false,
		filterOperators: [],
		id: "select",
		kind: "selection",
		label: "Select",
		optional: false,
		sortable: false,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["contains", "equals", "hasValue", "hasNoValue"],
		id: "title",
		kind: "text",
		label: "Title",
		optional: false,
		sortable: true,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["contains", "hasValue", "hasNoValue"],
		id: "creators",
		kind: "people",
		label: "Creators",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["equals", "between", "hasValue", "hasNoValue"],
		id: "year",
		kind: "number",
		label: "Year",
		optional: true,
		sortable: true,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["anyOf"],
		id: "state",
		kind: "enum",
		label: "State",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["anyOf"],
		id: "fileState",
		kind: "enum",
		label: "PDF",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: true,
		filterable: true,
		filterOperators: ["before", "after", "between"],
		id: "updated",
		kind: "date",
		label: "Updated",
		optional: true,
		sortable: true,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["anyOf"],
		id: "itemType",
		kind: "enum",
		label: "Item type",
		optional: true,
		sortable: true,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["anyOf"],
		id: "source",
		kind: "relation",
		label: "Source",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["anyOf", "hasValue", "hasNoValue"],
		id: "collections",
		kind: "relation",
		label: "Collections",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["anyOf", "hasValue", "hasNoValue"],
		id: "tags",
		kind: "relation",
		label: "Tags",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["before", "after", "between"],
		id: "dateAdded",
		kind: "date",
		label: "Date added",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["contains", "equals"],
		id: "key",
		kind: "text",
		label: "Key",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["equals", "between"],
		id: "revision",
		kind: "number",
		label: "Revision",
		optional: true,
		sortable: false,
	},
	{
		defaultVisible: false,
		filterable: true,
		filterOperators: ["equals", "between", "hasValue", "hasNoValue"],
		id: "pageCount",
		kind: "number",
		label: "PDF pages",
		optional: true,
		sortable: true,
	},
] as const satisfies readonly AdminItemListColumnDefinitionShape[];

export type AdminItemColumnId =
	(typeof ADMIN_ITEM_LIST_COLUMNS)[number]["id"];

export type AdminItemSortColumnId = Extract<
	(typeof ADMIN_ITEM_LIST_COLUMNS)[number],
	{ sortable: true }
>["id"];

export type AdminItemListColumnDefinition = Omit<
	AdminItemListColumnDefinitionShape,
	"id"
> & {
	id: AdminItemColumnId;
};

export const ADMIN_ITEM_COLUMN_IDS = ADMIN_ITEM_LIST_COLUMNS.map(
	({ id }) => id,
) as [AdminItemColumnId, ...AdminItemColumnId[]];

export const ADMIN_ITEM_DEFAULT_COLUMNS = ADMIN_ITEM_LIST_COLUMNS.filter(
	({ defaultVisible }) => defaultVisible,
).map(({ id }) => id);

export const ADMIN_ITEM_SORT_COLUMN_IDS = ADMIN_ITEM_LIST_COLUMNS.filter(
	({ sortable }) => sortable,
).map(({ id }) => id) as [
	AdminItemSortColumnId,
	...AdminItemSortColumnId[],
];

const adminItemColumnIdSchema = z.enum(ADMIN_ITEM_COLUMN_IDS);
const adminItemFilterOperatorSchema = z.enum(ADMIN_ITEM_FILTER_OPERATORS);
const columnById = new Map<AdminItemColumnId, AdminItemListColumnDefinition>(
	ADMIN_ITEM_LIST_COLUMNS.map((definition) => [definition.id, definition]),
);

export function getAdminItemListColumn(id: AdminItemColumnId) {
	return columnById.get(id)!;
}

const dateValueSchema = z.iso.date();
const stringValueSchema = z.string().trim().min(1).max(500);
const stringListValueSchema = z.array(stringValueSchema).min(1).max(100);
const numberValueSchema = z.number().finite();

const adminItemFilterSchema = z
	.object({
		column: adminItemColumnIdSchema,
		operator: adminItemFilterOperatorSchema,
		value: z.unknown().optional(),
	})
	.superRefine((filter, context) => {
		const definition = columnById.get(filter.column)!;
		if (!definition.filterOperators.includes(filter.operator)) {
			context.addIssue({
				code: "custom",
				message: `${definition.label} does not support the ${filter.operator} filter`,
				path: ["operator"],
			});
			return;
		}

		const valueSchema = (() => {
			switch (filter.operator) {
				case "contains":
					return stringValueSchema;
				case "anyOf":
					return stringListValueSchema;
				case "equals":
					return definition.kind === "number"
						? numberValueSchema
						: stringValueSchema;
				case "before":
				case "after":
					return dateValueSchema;
				case "between":
					return definition.kind === "date"
						? z
								.tuple([dateValueSchema, dateValueSchema])
								.refine(([start, end]) => start <= end)
						: z
								.tuple([numberValueSchema, numberValueSchema])
								.refine(([start, end]) => start <= end);
				case "hasValue":
				case "hasNoValue":
					return z.undefined();
			}
		})();
		const valueResult = valueSchema.safeParse(filter.value);
		if (!valueResult.success) {
			context.addIssue({
				code: "custom",
				message: `${definition.label} has an invalid value for the ${filter.operator} filter`,
				path: ["value"],
			});
		}
	});
const adminItemSortColumnSchema = z.enum(ADMIN_ITEM_SORT_COLUMN_IDS);

const adminItemListRequestSchema = z.object({
	cursor: z.string().min(1).nullable().default(null),
	filters: z.array(adminItemFilterSchema).max(30).default([]),
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.max(ADMIN_ITEM_MAX_PAGE_SIZE)
		.default(ADMIN_ITEM_PAGE_SIZE),
	requestedColumns: z
		.array(adminItemColumnIdSchema)
		.refine((columns) => new Set(columns).size === columns.length, {
			message: "Requested columns must be unique",
		})
		.default(ADMIN_ITEM_DEFAULT_COLUMNS),
	search: z.string().trim().max(500).default(""),
	sorting: z
		.array(
			z.object({
				column: adminItemSortColumnSchema,
				direction: z.enum(["asc", "desc"]),
			}),
		)
		.max(1)
		.default([{ column: "updated", direction: "desc" }]),
});

export type AdminItemListRequest = z.infer<typeof adminItemListRequestSchema>;

export function parseAdminItemListRequest(value: unknown): AdminItemListRequest {
	return adminItemListRequestSchema.parse(value);
}
