import {
	ADMIN_ITEM_COLUMN_IDS,
	ADMIN_ITEM_DEFAULT_COLUMNS,
	ADMIN_ITEM_LIST_COLUMNS,
	type AdminItemColumnId,
} from "./item-list-contract";

export const ADMIN_ITEM_TABLE_PREFERENCE_KEY =
	"openscholar.admin.item-table.preferences.v1";

export const ADMIN_ITEM_TABLE_DENSITIES = [
	"compact",
	"comfortable",
	"spacious",
] as const;

export type AdminItemTableDensity = (typeof ADMIN_ITEM_TABLE_DENSITIES)[number];

export type AdminItemTablePreferences = {
	columnOrder: AdminItemColumnId[];
	columnSizing: Partial<Record<AdminItemColumnId, number>>;
	columnVisibility: Record<AdminItemColumnId, boolean>;
	density: AdminItemTableDensity;
	version: 1;
};

export const ADMIN_ITEM_TABLE_MAX_COLUMN_SIZE = 720;

export const ADMIN_ITEM_TABLE_COLUMN_SIZES: Record<
	AdminItemColumnId,
	{ maxSize?: number; minSize: number; size: number }
> = {
	collections: { minSize: 140, size: 200 },
	creators: { minSize: 140, size: 190 },
	dateAdded: { minSize: 120, size: 140 },
	fileState: { minSize: 92, size: 104 },
	itemType: { minSize: 120, size: 150 },
	kind: { minSize: 100, size: 112 },
	key: { minSize: 100, size: 112 },
	pageCount: { minSize: 88, size: 100 },
	revision: { minSize: 76, size: 88 },
	select: { maxSize: 44, minSize: 44, size: 44 },
	source: { minSize: 120, size: 150 },
	// Wide enough for "Changes requested", the longest thing a record's state says.
	state: { minSize: 136, size: 144 },
	tags: { minSize: 140, size: 200 },
	title: { minSize: 220, size: 300 },
	updated: { minSize: 116, size: 132 },
	year: { minSize: 68, size: 76 },
};

const requiredColumns = ADMIN_ITEM_LIST_COLUMNS.filter(
	({ optional }) => !optional,
).map(({ id }) => id);
const requiredColumnSet = new Set<AdminItemColumnId>(requiredColumns);
const columnIdSet = new Set<AdminItemColumnId>(ADMIN_ITEM_COLUMN_IDS);
const densitySet = new Set<AdminItemTableDensity>(ADMIN_ITEM_TABLE_DENSITIES);

function defaultVisibility() {
	const visible = new Set<AdminItemColumnId>(ADMIN_ITEM_DEFAULT_COLUMNS);
	return Object.fromEntries(
		ADMIN_ITEM_COLUMN_IDS.map((id) => [id, visible.has(id)]),
	) as Record<AdminItemColumnId, boolean>;
}

export const ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES: AdminItemTablePreferences = {
	columnOrder: [...ADMIN_ITEM_COLUMN_IDS],
	columnSizing: {},
	columnVisibility: defaultVisibility(),
	density: "comfortable",
	version: 1,
};

function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizedColumnOrder(value: unknown) {
	const supplied = Array.isArray(value) ? value : [];
	const optionalOrder: AdminItemColumnId[] = [];
	const seen = new Set<AdminItemColumnId>();
	for (const candidate of supplied) {
		if (
			typeof candidate !== "string" ||
			!columnIdSet.has(candidate as AdminItemColumnId)
		) {
			continue;
		}
		const id = candidate as AdminItemColumnId;
		if (requiredColumnSet.has(id) || seen.has(id)) continue;
		seen.add(id);
		optionalOrder.push(id);
	}
	for (const id of ADMIN_ITEM_COLUMN_IDS) {
		if (requiredColumnSet.has(id) || seen.has(id)) continue;
		seen.add(id);
		optionalOrder.push(id);
	}
	return [...requiredColumns, ...optionalOrder];
}

export function normalizeAdminItemTablePreferences(
	value: unknown,
): AdminItemTablePreferences {
	const record = recordValue(value);
	if (!record || record.version !== 1) {
		return ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES;
	}

	const persistedVisibility = recordValue(record.columnVisibility);
	const columnVisibility = defaultVisibility();
	for (const { id, optional } of ADMIN_ITEM_LIST_COLUMNS) {
		if (!optional) {
			columnVisibility[id] = true;
			continue;
		}
		const persisted = persistedVisibility?.[id];
		if (typeof persisted === "boolean") columnVisibility[id] = persisted;
	}

	const persistedSizing = recordValue(record.columnSizing);
	const columnSizing: Partial<Record<AdminItemColumnId, number>> = {};
	if (persistedSizing) {
		for (const id of ADMIN_ITEM_COLUMN_IDS) {
			if (id === "select") continue;
			const size = persistedSizing[id];
			const limits = ADMIN_ITEM_TABLE_COLUMN_SIZES[id];
			if (
				typeof size === "number" &&
				Number.isFinite(size) &&
				size >= limits.minSize &&
				size <= (limits.maxSize ?? ADMIN_ITEM_TABLE_MAX_COLUMN_SIZE)
			) {
				columnSizing[id] = Math.round(size);
			}
		}
	}

	const density = densitySet.has(record.density as AdminItemTableDensity)
		? (record.density as AdminItemTableDensity)
		: "comfortable";

	return {
		columnOrder: normalizedColumnOrder(record.columnOrder),
		columnSizing,
		columnVisibility,
		density,
		version: 1,
	};
}

export function moveAdminItemTableColumn(
	columnOrder: readonly AdminItemColumnId[],
	columnId: AdminItemColumnId,
	direction: "down" | "up",
) {
	if (requiredColumnSet.has(columnId)) return [...columnOrder];
	const normalized = normalizedColumnOrder(columnOrder);
	const optionalOrder = normalized.filter((id) => !requiredColumnSet.has(id));
	const index = optionalOrder.indexOf(columnId);
	const nextIndex = direction === "up" ? index - 1 : index + 1;
	if (index < 0 || nextIndex < 0 || nextIndex >= optionalOrder.length) {
		return normalized;
	}
	[optionalOrder[index], optionalOrder[nextIndex]] = [
		optionalOrder[nextIndex]!,
		optionalOrder[index]!,
	];
	return [...requiredColumns, ...optionalOrder];
}

export function requestedAdminItemColumns(
	preferences: Pick<AdminItemTablePreferences, "columnVisibility">,
) {
	return ADMIN_ITEM_COLUMN_IDS.filter(
		(id) => preferences.columnVisibility[id],
	);
}

export function adminItemTableRowHeight(density: AdminItemTableDensity) {
	switch (density) {
		case "compact":
			return 44;
		case "comfortable":
			return 56;
		case "spacious":
			return 64;
	}
}
