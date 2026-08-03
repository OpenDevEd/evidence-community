import zoteroSchema from "../vendor/zotero-schema.json" with { type: "json" };

type ZoteroField = {
	baseField?: string;
	field: string;
};

type ZoteroCreatorType = {
	creatorType: string;
	primary?: boolean;
};

export type ZoteroItemTypeDefinition = {
	creatorTypes: ZoteroCreatorType[];
	fields: ZoteroField[];
	itemType: string;
};

export type ZoteroSchema = {
	csl: Record<string, unknown>;
	itemTypes: ZoteroItemTypeDefinition[];
	meta: Record<string, unknown>;
	version: number;
};

let cachedItemTypes: ReadonlyMap<string, ZoteroItemTypeDefinition> | undefined;

export function getZoteroSchema(): ZoteroSchema {
	return zoteroSchema as ZoteroSchema;
}

export function getZoteroItemTypes(): ReadonlyMap<
	string,
	ZoteroItemTypeDefinition
> {
	cachedItemTypes ??= new Map(
		getZoteroSchema().itemTypes.map((definition) => [
			definition.itemType,
			definition,
		]),
	);
	return cachedItemTypes;
}

export function getZoteroItemType(
	itemType: string,
): ZoteroItemTypeDefinition | null {
	return getZoteroItemTypes().get(itemType) ?? null;
}
