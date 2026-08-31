import { z } from "zod";

import {
	PLATFORM_AI_MODEL_CATALOG,
	PLATFORM_FONT_CATALOG,
	PLATFORM_LOCALES,
	PLATFORM_PROMPT_DEFAULTS,
	PLATFORM_PROMPT_SLOTS,
	PLATFORM_PROMPT_VARIABLES,
	PLATFORM_RULE_ACTIONS,
	PLATFORM_RULE_CONDITIONS,
	PLATFORM_SEARCH_SCOPE_OPTIONS,
	PLATFORM_SOCIAL_PROVIDERS,
} from "./catalogs";
import { PLATFORM_NAVBAR_ICON_IDS } from "./generated/hugeicons";
import { libraryConfigSchema } from "./schema";

type JsonObject = Record<string, unknown>;
type JsonPrimitive = boolean | number | string | null;

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is JsonPrimitive {
	return (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	);
}

function walkSchema(
	node: unknown,
	path: string,
	visit: (node: JsonObject, path: string) => void,
) {
	if (!isObject(node)) return;
	visit(node, path);

	const properties = node.properties;
	if (isObject(properties)) {
		for (const [name, property] of Object.entries(properties)) {
			walkSchema(property, path ? `${path}.${name}` : name, visit);
		}
	}

	if (node.items) walkSchema(node.items, `${path}[]`, visit);

	for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
		const branches = node[keyword];
		if (!Array.isArray(branches)) continue;
		for (const branch of branches) walkSchema(branch, path, visit);
	}

	const definitions = node.$defs;
	if (isObject(definitions)) {
		for (const definition of Object.values(definitions)) {
			walkSchema(definition, path, visit);
		}
	}
}

function collectEnumOptions(schema: JsonObject) {
	const enumPaths = new Set<string>();
	const valuesByPath = new Map<string, Map<string, JsonPrimitive>>();
	const openPaths = new Set<string>();

	const add = (path: string, value: JsonPrimitive) => {
		if (!path) return;
		const values = valuesByPath.get(path) ?? new Map();
		values.set(JSON.stringify(value), value);
		valuesByPath.set(path, values);
	};

	walkSchema(schema, "", (node, path) => {
		let hasChoices = false;
		if (Array.isArray(node.enum)) {
			hasChoices = true;
			enumPaths.add(path);
			for (const value of node.enum) {
				if (isPrimitive(value)) add(path, value);
			}
		}
		if (isPrimitive(node.const)) {
			hasChoices = true;
			add(path, node.const);
		}
		if (
			!hasChoices &&
			["integer", "number", "string"].includes(String(node.type))
		) {
			openPaths.add(path);
		}
	});

	return Array.from(valuesByPath)
		.map(([path, values]) => ({
			allowCustom: openPaths.has(path),
			path,
			values: Array.from(values.values()),
		}))
		.filter(({ path, values }) => values.length > 1 || enumPaths.has(path))
		.sort((left, right) => left.path.localeCompare(right.path));
}

function collectWriteOnlyPaths(schema: JsonObject) {
	const paths = new Set<string>();
	walkSchema(schema, "", (node, path) => {
		if (node.writeOnly === true && path) paths.add(path);
	});
	return Array.from(paths).sort();
}

function removeEvaluatedDynamicDefaults(schema: JsonObject) {
	walkSchema(schema, "", (node) => {
		if (node["x-dynamicDefault"]) delete node.default;
	});
}

export function createLibraryConfigJsonSchema(): JsonObject {
	const generated = z.toJSONSchema(libraryConfigSchema, {
		io: "input",
		target: "draft-2020-12",
		unrepresentable: "any",
	}) as JsonObject;
	removeEvaluatedDynamicDefaults(generated);

	return {
		...generated,
		$id: "/library-config.schema.json",
		title: "Evidence Library runtime configuration",
		description:
			"Structural contract for an Evidence Library runtime configuration document.",
		$comment:
			"Custom refinements and cross-field dependencies remain authoritative in the runtime validator. Validate candidates with npm run config:validate before activation.",
		"x-runtimeValidation": {
			authoritative: true,
			command: "npm run config:validate -- <path>",
		},
	};
}

export function createLibraryConfigCatalog(
	schema = createLibraryConfigJsonSchema(),
) {
	return {
		catalogVersion: 1,
		schemaVersion: 1,
		schemaUrl: "/library-config.schema.json",
		validation: {
			authoritative: "runtime",
			command: "npm run config:validate -- <path>",
			crossFieldRulesInJsonSchema: false,
		},
		fields: {
			enums: collectEnumOptions(schema),
			writeOnlyPaths: collectWriteOnlyPaths(schema),
		},
		options: {
			locales: [...PLATFORM_LOCALES],
			searchScopes: PLATFORM_SEARCH_SCOPE_OPTIONS.map((scope) => ({
				key: scope.key,
				name: scope.name,
				attributesToSearchOn: [...scope.attributesToSearchOn],
			})),
			navbarIconIds: [...PLATFORM_NAVBAR_ICON_IDS],
			socialProviders: [...PLATFORM_SOCIAL_PROVIDERS],
			fonts: Object.entries(PLATFORM_FONT_CATALOG).map(
				([family, details]) => ({
					family,
					weights: [...details.weights],
				}),
			),
			aiProviders: Object.entries(PLATFORM_AI_MODEL_CATALOG).map(
				([provider, models]) => ({
					provider,
					active: [...models.active],
				}),
			),
			promptSlots: PLATFORM_PROMPT_SLOTS.map((slot) => ({
				slot,
				defaultValue: PLATFORM_PROMPT_DEFAULTS[slot],
				variables: [...PLATFORM_PROMPT_VARIABLES[slot]],
			})),
			processing: {
				conditions: [...PLATFORM_RULE_CONDITIONS],
				actions: [...PLATFORM_RULE_ACTIONS],
			},
		},
	};
}
