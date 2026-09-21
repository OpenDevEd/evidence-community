import zoteroSchema from "../vendor/zotero-schema.json" with { type: "json" };

export type ZoteroField = {
	baseField?: string;
	field: string;
};

export type ZoteroFieldType = "date" | "text";

type ZoteroFieldMetadata = {
	type?: "date";
};

export type ZoteroFieldDescriptor = ZoteroField & {
	semanticField: string;
	type: ZoteroFieldType;
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
	csl: {
		types: Record<string, string[]>;
		fields: { text: Record<string, string[]>; date: Record<string, string> };
		names: Record<string, string>;
	};
	itemTypes: ZoteroItemTypeDefinition[];
	meta: {
		fields: Record<string, ZoteroFieldMetadata>;
	};
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

export function describeZoteroField(
	definition: ZoteroField,
): ZoteroFieldDescriptor {
	const semanticField = definition.baseField ?? definition.field;
	const fields = getZoteroSchema().meta.fields;
	const type =
		fields[definition.field]?.type ?? fields[semanticField]?.type ?? "text";
	return {
		...definition,
		semanticField,
		type,
	};
}

export function describeZoteroItemTypeFields(
	itemType: string,
): readonly ZoteroFieldDescriptor[] {
	return (getZoteroItemType(itemType)?.fields ?? []).map(describeZoteroField);
}

export function canonicalZoteroFieldName(
	itemType: string,
	zoteroField: string,
): string | null {
	return (
		describeZoteroItemTypeFields(itemType).find(
			(descriptor) => descriptor.field === zoteroField,
		)?.semanticField ?? null
	);
}

export function itemTypeZoteroFieldName(
	itemType: string,
	canonicalField: string,
): string | null {
	return (
		describeZoteroItemTypeFields(itemType).find(
			(descriptor) => descriptor.semanticField === canonicalField,
		)?.field ?? null
	);
}
