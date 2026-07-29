import { readFileSync } from "node:fs";

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

let cachedSchema: ZoteroSchema | undefined;
let cachedItemTypes: ReadonlyMap<string, ZoteroItemTypeDefinition> | undefined;

export function getZoteroSchema(): ZoteroSchema {
	cachedSchema ??= JSON.parse(
		readFileSync(
			new URL("../vendor/zotero-schema.json", import.meta.url),
			"utf8",
		),
	) as ZoteroSchema;
	return cachedSchema;
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
