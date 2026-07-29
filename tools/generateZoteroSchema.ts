import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { columns } from "../src/db/schema/views/columns";

type ZoteroCsl = {
	fields: {
		date: Record<string, string>;
		text: Record<string, string[]>;
	};
	names: Record<string, string>;
	types: Record<string, string[]>;
};

type ZoteroSchema = {
	csl: ZoteroCsl;
	version: number;
};

const checkOnly = process.argv.includes("--check");
const schemaSourcePath = join(
	process.cwd(),
	"packages",
	"evidence-library-core",
	"vendor",
	"zotero-schema.json",
);
const apaSourcePath = join(process.cwd(), "vendor", "csl", "apa.csl");

const zoteroSchema = JSON.parse(
	readFileSync(schemaSourcePath, "utf8"),
) as ZoteroSchema;
const csl = zoteroSchema.csl;
const schema = {
	CSL_TYPE_MAPPINGS: {} as Record<string, string>,
	CSL_TYPE_MAPPINGS_REVERSE: {} as Record<string, string[]>,
	CSL_TEXT_MAPPINGS: csl.fields.text,
	CSL_DATE_MAPPINGS: csl.fields.date,
	CSL_NAME_MAPPINGS: csl.names,
	CSL_FIELD_MAPPINGS_REVERSE: {} as Record<string, string>,
	COLUMN_TO_ZOTERO_TYPE_MAPPINGS: {} as Record<string, string>,
	ZOTERO_SCHEMA_VERSION: zoteroSchema.version,
};

const columnKeysLowercase = Object.keys(columns).reduce(
	(accumulator, key) => {
		accumulator[key.toLowerCase()] = key;
		return accumulator;
	},
	{} as Record<string, string>,
);

for (const [cslType, zoteroTypes] of Object.entries(csl.types)) {
	for (const zoteroType of zoteroTypes) {
		const matchingColumnKey =
			columnKeysLowercase[zoteroType.toLowerCase()];
		const keyToUse = matchingColumnKey ?? zoteroType;

		schema.CSL_TYPE_MAPPINGS[keyToUse] = cslType;
		if (matchingColumnKey) {
			schema.COLUMN_TO_ZOTERO_TYPE_MAPPINGS[matchingColumnKey] =
				zoteroType;
		}
	}
	schema.CSL_TYPE_MAPPINGS_REVERSE[cslType] = [...zoteroTypes];
}

for (const [cslField, zoteroFields] of Object.entries(csl.fields.text)) {
	for (const zoteroField of zoteroFields) {
		schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField] = cslField;
	}
}

for (const [cslField, zoteroField] of Object.entries(csl.fields.date)) {
	schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField] = cslField;
}

const outputs = new Map([
	[
		join(process.cwd(), "public", "csl.json"),
		`${JSON.stringify(csl, null, 2)}\n`,
	],
	[
		join(process.cwd(), "public", "schema.json"),
		`${JSON.stringify(schema, null, 2)}\n`,
	],
	[
		join(process.cwd(), "public", "apa.csl"),
		readFileSync(apaSourcePath, "utf8"),
	],
]);

for (const [outputPath, content] of outputs) {
	if (checkOnly) {
		if (readFileSync(outputPath, "utf8") !== content) {
			throw new Error(
				`Generated Zotero artifact is stale: ${outputPath}`,
			);
		}
		continue;
	}

	writeFileSync(outputPath, content);
}
