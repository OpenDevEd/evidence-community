import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
	createLibraryConfigCatalog,
	createLibraryConfigJsonSchema,
} from "@/config/library-config/artifacts";

async function readJson(relativePath: string) {
	return JSON.parse(
		await readFile(path.join(process.cwd(), relativePath), "utf8"),
	);
}

describe("library configuration artifacts", () => {
	it("keeps committed artifacts synchronized with the executable contract", async () => {
		const schema = createLibraryConfigJsonSchema();
		const catalog = createLibraryConfigCatalog(schema);

		await expect(
			readJson("public/library-config.schema.json"),
		).resolves.toEqual(schema);
		await expect(
			readJson("public/library-config.catalogs.json"),
		).resolves.toEqual(catalog);
	});

	it("emits valid Draft 2020-12 schema for real configuration inputs", async () => {
		const schema = createLibraryConfigJsonSchema();
		const example = await readJson("config/library.example.json");
		const ajv = new Ajv2020({ allErrors: true, strict: true });
		ajv.addKeyword("x-runtimeValidation");
		ajv.addKeyword("x-dynamicDefault");
		addFormats(ajv);
		const validate = ajv.compile(schema);

		expect(validate(example), ajv.errorsText(validate.errors)).toBe(
			true,
		);
		expect(validate({ ...example, unknown: true })).toBe(false);
		expect(
			validate({
				...example,
				identity: { ...example.identity, name: "" },
			}),
		).toBe(false);
		expect(
			validate({
				...example,
				navigation: {
					...example.navigation,
					links: example.navigation.links.map(
						(link: Record<string, unknown>, index: number) =>
							index === 0 ? { ...link, icon: "EvidenceLibrary" } : link,
					),
				},
			}),
		).toBe(false);
	});

	it("exports closed choices, extensible choices, and write-only paths", () => {
		const catalog = createLibraryConfigCatalog();
		const enums = new Map(
			catalog.fields.enums.map((entry) => [entry.path, entry]),
		);

		expect(enums.get("theme.layout")).toEqual({
			allowCustom: false,
			path: "theme.layout",
			values: ["small", "wide"],
		});
		expect(enums.get("theme.fonts.heading.family")).toMatchObject({
			allowCustom: true,
			values: ["Montserrat", "Poppins", "Ubuntu"],
		});
		expect(catalog.options.navbarIconIds).toHaveLength(6_025);
		expect(catalog.options.navbarIconIds).toEqual(
			expect.arrayContaining(["AbacusIcon", "LibraryIcon", "ZoomIcon"]),
		);
		expect(catalog.options.navbarIconIds).not.toContain("EvidenceLibrary");
		expect(enums.get("processing.structureRules[].action")).toEqual({
			allowCustom: false,
			path: "processing.structureRules[].action",
			values: ["append-system-instruction"],
		});
		expect(catalog.fields.writeOnlyPaths).toEqual(
			expect.arrayContaining([
				"ai.providers[].apiKey",
				"authentication.openScholar.machineCredential",
				"authentication.secret",
				"sources[].apiKey",
				"services.database.url",
				"services.search.key",
				"services.publication.crossref.loginId",
				"services.publication.crossref.password",
				"services.publication.zenodo.token",
			]),
		);
		expect(catalog.fields.writeOnlyPaths).not.toContain(
			"analytics.posthog.key",
		);
	});
});
