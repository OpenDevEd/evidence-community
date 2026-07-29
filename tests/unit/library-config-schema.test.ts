import { describe, expect, it } from "vitest";

import {
	colorSchema,
	createLibraryConfigSchema,
	fontSchema,
	hasAccessiblePaletteTone,
	idSchema,
	internalLinkSchema,
	libraryConfigSchema,
	publicHttpsOriginSchema,
	secretSchema,
	serviceUrlSchema,
	stableIconUrlSchema,
	stableImageUrlSchema,
	tagSchema,
	utcTimestampSchema,
} from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	invalidLibraryConfig,
	libraryCollectionIds,
	libraryInstitutionNames,
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

const catalogSchema = createLibraryConfigSchema({
	collectionIds: libraryCollectionIds,
	institutionNames: libraryInstitutionNames,
});

function expectCatalogInvalid(
	mutate: (config: ReturnType<typeof cloneLibraryConfig>) => void,
) {
	const config = cloneLibraryConfig();
	mutate(config);
	expect(catalogSchema.safeParse(config).success).toBe(false);
}

function expectCatalogIssue(
	mutate: (config: ReturnType<typeof cloneLibraryConfig>) => void,
	message: string,
) {
	const config = cloneLibraryConfig();
	mutate(config);
	const result = catalogSchema.safeParse(config);

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(
			result.error.issues.some((issue) => issue.message.includes(message)),
		).toBe(true);
	}
}

describe("library configuration fixtures", () => {
	it("parses the minimal fixture and applies platform defaults", () => {
		const config = catalogSchema.parse(minimalLibraryConfig);

		expect(config.identity.shortName).toBe(config.identity.name);
		expect(config.identity.assets.logoLight).toBe(
			config.identity.assets.logoDark,
		);
		expect(config.theme.layout).toBe("small");
		expect(config.theme.fonts.heading).toEqual({
			source: "google",
			family: "Ubuntu",
		});
		expect(config.localization.localePriority).toEqual(["en-GB"]);
		expect(config.search.defaultScope).toBe(
			"title_abstract_author_and_keywords",
		);
		expect(config.features.login).toBe(false);
		expect(config.content.tags.publish).toEqual([
			"_publish",
			"publishPDF",
		]);
	});

	it("parses the maximal fixture with every configuration group", () => {
		const config = catalogSchema.parse(maximalLibraryConfig);

		expect(config.institutions).toHaveLength(1);
		expect(config.navigation.links[0].children).toHaveLength(1);
		expect(config.footer.sections).toHaveLength(1);
		expect(config.search.scopes).toHaveLength(3);
		expect(config.collections).toHaveLength(1);
		expect(config.gapMaps).toHaveLength(1);
		expect(config.gapMaps[0]?.enabled).toBe(true);
		expect(config.ai.providers[0].enabled).toBe(true);
		expect(config.processing.sharedRules).toHaveLength(1);
	});

	it("enables configured gap maps by default", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		delete input.gapMaps![0].enabled;

		const config = catalogSchema.parse(input);

		expect(config.gapMaps[0]?.enabled).toBe(true);
	});

	it("rejects the intentionally invalid fixture", () => {
		expect(libraryConfigSchema.safeParse(invalidLibraryConfig).success).toBe(
			false,
		);
	});
});

describe("reusable field schemas", () => {
	it.each([
		["ID punctuation", idSchema, "not.valid"],
		["non-UTC timestamp", utcTimestampSchema, "2026-07-27T12:00:00+01:00"],
		["HTTP public origin", publicHttpsOriginSchema, "http://example.org"],
		[
			"origin path",
			publicHttpsOriginSchema,
			"https://example.org/library",
		],
		[
			"signed image URL",
			stableImageUrlSchema,
			"https://assets.example.org/logo.svg?token=temporary",
		],
		["wrong image type", stableImageUrlSchema, "https://example.org/logo.gif"],
		["protocol-relative link", internalLinkSchema, "//example.org/path"],
		["encoded traversal", internalLinkSchema, "/safe/%2e%2e/admin"],
		["multiline tag", tagSchema, "first\nsecond"],
		["invalid color", colorSchema, "rgb(0, 0, 0)"],
		["empty secret", secretSchema(1, 20), ""],
		[
			"signed icon URL",
			stableIconUrlSchema,
			"https://assets.example.org/icon.svg?expires=1",
		],
		[
			"unknown Google font",
			fontSchema,
			{ source: "google", family: "Unknown Sans" },
		],
	])("rejects %s", (_name, schema, value) => {
		expect(schema.safeParse(value).success).toBe(false);
	});

	it("allows service URL path prefixes without allowing queries", () => {
		expect(
			serviceUrlSchema.safeParse(
				"https://services.example.org/meilisearch",
			).success,
		).toBe(true);
		expect(
			serviceUrlSchema.safeParse(
				"https://services.example.org/meilisearch?token=value",
			).success,
		).toBe(false);
	});
});

describe("strict field groups", () => {
	it.each([
		["identity", (config: any) => (config.identity.unknown = true)],
		["institutions", (config: any) => (config.institutions[0].unknown = true)],
		["theme", (config: any) => (config.theme.unknown = true)],
		["navigation", (config: any) => (config.navigation.unknown = true)],
		["footer", (config: any) => (config.footer.unknown = true)],
		["contact", (config: any) => (config.contact.unknown = true)],
		["legal", (config: any) => (config.legal.unknown = true)],
		["localization", (config: any) => (config.localization.unknown = true)],
		["search", (config: any) => (config.search.unknown = true)],
		["filters", (config: any) => (config.filters.unknown = true)],
		["content", (config: any) => (config.content.unknown = true)],
		["citations", (config: any) => (config.citations.unknown = true)],
		["features", (config: any) => (config.features.unknown = true)],
		["collections", (config: any) => (config.collections[0].unknown = true)],
		["gap maps", (config: any) => (config.gapMaps[0].unknown = true)],
		["exports", (config: any) => (config.exports.unknown = true)],
		["services", (config: any) => (config.services.unknown = true)],
		["AI", (config: any) => (config.ai.unknown = true)],
		["analytics", (config: any) => (config.analytics.unknown = true)],
		[
			"authentication",
			(config: any) => (config.authentication.unknown = true),
		],
		["email", (config: any) => (config.email.unknown = true)],
		["generation", (config: any) => (config.generation.unknown = true)],
		["processing", (config: any) => (config.processing.unknown = true)],
	])("rejects unknown keys in %s", (_group, mutate) => {
		expectCatalogInvalid(mutate);
	});
});

describe("cross-field activation rules", () => {
	it.each([
		[
			"forced theme with switcher",
			(config: any) => {
				config.theme.forcedMode = "dark";
				config.features.themeSwitcher = true;
			},
		],
		[
			"language switcher with one locale",
			(config: any) => {
				config.localization.locales = ["en-GB"];
				config.localization.localePriority = ["en-GB"];
				config.features.languageSwitcher = true;
			},
		],
		[
			"login without authentication secret",
			(config: any) => {
				delete config.authentication.secret;
			},
		],
		[
			"Google authentication without login",
			(config: any) => {
				config.features.login = false;
				config.features.userCollections = false;
			},
		],
		[
			"Google authentication without client ID",
			(config: any) => {
				delete config.authentication.google.clientId;
			},
		],
		[
			"Google authentication without client secret",
			(config: any) => {
				delete config.authentication.google.clientSecret;
			},
		],
		[
			"user collections without login",
			(config: any) => {
				config.features.login = false;
				config.authentication.google.enabled = false;
			},
		],
		[
			"AI features without an enabled provider",
			(config: any) => {
				config.ai.providers[0].enabled = false;
				config.features.aiSearch = false;
				config.features.deepResearch = false;
			},
		],
		[
			"AI search without AI",
			(config: any) => {
				config.features.ai = false;
				config.features.deepResearch = false;
			},
		],
		[
			"deep research without a large model",
			(config: any) => {
				delete config.ai.providers[0].largeModel;
			},
		],
		[
			"deep research without AI features",
			(config: any) => {
				config.features.ai = false;
				config.features.aiSearch = false;
			},
		],
		[
			"deep research without AI search",
			(config: any) => {
				config.features.aiSearch = false;
			},
		],
		[
			"related resources without embeddings",
			(config: any) => {
				config.search.embeddings = false;
			},
		],
		[
			"collection notes without collections",
			(config: any) => {
				config.features.collections = false;
			},
		],
		[
			"country focus without country search",
			(config: any) => {
				config.search.country = false;
			},
		],
		[
			"author location without author-country search",
			(config: any) => {
				config.search.authorCountry = false;
			},
		],
		[
			"years dropdown without years filter",
			(config: any) => {
				config.filters.years.enabled = false;
			},
		],
		[
			"unknown collection ID",
			(config: any) => {
				config.collections[0].id = "unknown-collection";
			},
		],
		[
			"downloads without RIS or BibTeX",
			(config: any) => {
				delete config.exports.ris;
				delete config.exports.bibtex;
			},
		],
		[
			"Atom feed without Atom endpoint",
			(config: any) => {
				delete config.exports.atom;
			},
		],
		[
			"email recipient without SMTP host",
			(config: any) => {
				delete config.email.smtp.host;
			},
		],
		[
			"email recipient without SMTP sender",
			(config: any) => {
				delete config.email.smtp.from;
			},
		],
		[
			"featured institution not in institution catalog",
			(config: any) => {
				config.filters.institution.featuredValue = "Missing Institution";
			},
		],
		[
			"overlapping semantic tags",
			(config: any) => {
				config.content.tags.hidden = ["internal-only"];
			},
		],
		[
			"publish tag overlapping an internal tag",
			(config: any) => {
				config.content.tags.publish = ["internal-only"];
			},
		],
		[
			"default scope outside enabled scopes",
			(config: any) => {
				config.search.defaultScope = "documents";
			},
		],
		[
			"shared private and public storage bucket",
			(config: any) => {
				config.services.storage.publicBucket =
					config.services.storage.privateBucket;
			},
		],
		[
			"maximum year below minimum",
			(config: any) => {
				config.filters.years.minimum = 2020;
				config.filters.years.maximum = 2019;
			},
		],
		[
			"blank target on an internal link",
			(config: any) => {
				config.navigation.links[0].target = "blank";
			},
		],
		[
			"provider model from another catalog",
			(config: any) => {
				config.ai.providers[0].defaultModel = "gpt-5.4-mini";
			},
		],
		[
			"enabled provider without API key",
			(config: any) => {
				delete config.ai.providers[0].apiKey;
			},
		],
		[
			"enabled provider without a default model",
			(config: any) => {
				delete config.ai.providers[0].defaultModel;
			},
		],
		[
			"partial PostHog configuration",
			(config: any) => {
				delete config.analytics.posthog.key;
			},
		],
		[
			"partial SMTP authentication",
			(config: any) => {
				delete config.email.smtp.password;
			},
		],
		[
			"disabled locale in locale priority",
			(config: any) => {
				config.localization.localePriority = ["de"];
			},
		],
		[
			"default locale outside enabled locales",
			(config: any) => {
				config.localization.defaultLocale = "de";
			},
		],
		[
			"featured institution mode without a value",
			(config: any) => {
				delete config.filters.institution.featuredValue;
			},
		],
		[
			"font weights without 400",
			(config: any) => {
				config.theme.fonts.weights = [300, 500, 700];
			},
		],
		[
			"unsupported Google font weight",
			(config: any) => {
				config.theme.fonts.weights = [400, 900];
			},
		],
		[
			"inaccessible link palette",
			(config: any) => {
				config.theme.colors.link = "#000000";
				config.theme.colors.backgroundDark = "#000000";
			},
		],
		[
			"unknown prompt variable",
			(config: any) => {
				config.ai.prompts.chat =
					"Discuss the supplied {{unknown}} evidence.";
			},
		],
		[
			"blank target on an internal child link",
			(config: any) => {
				config.navigation.links[0].children[0].target = "blank";
			},
		],
		[
			"long identity name without a short name",
			(config: any) => {
				config.identity.name =
					"This evidence library name is over forty characters";
				delete config.identity.shortName;
			},
		],
	])("rejects %s", (_name, mutate) => {
		expectCatalogInvalid(mutate);
	});
});

describe("unique configuration lists", () => {
	it.each([
		[
			"identity icons",
			(config: any) => {
				config.identity.assets.icons.push(
					config.identity.assets.icons[0],
				);
			},
		],
		[
			"funding partner IDs",
			(config: any) => {
				config.identity.fundingPartners.push({
					...config.identity.fundingPartners[0],
				});
			},
		],
		[
			"institution IDs",
			(config: any) => {
				config.institutions.push({
					...config.institutions[0],
					name: "Institution Two",
				});
			},
		],
		[
			"case-insensitive institution names",
			(config: any) => {
				config.institutions.push({
					...config.institutions[0],
					id: "institution-two",
					name: "institution one",
				});
			},
		],
		[
			"font weights",
			(config: any) => {
				config.theme.fonts.weights = [400, 400];
			},
		],
		[
			"navigation child IDs",
			(config: any) => {
				config.navigation.links[0].children.push({
					...config.navigation.links[0].children[0],
				});
			},
		],
		[
			"navigation link IDs",
			(config: any) => {
				config.navigation.links.push({
					...config.navigation.links[0],
				});
			},
		],
		[
			"footer link IDs",
			(config: any) => {
				config.footer.sections[0].links.push({
					...config.footer.sections[0].links[0],
				});
			},
		],
		[
			"footer section IDs",
			(config: any) => {
				config.footer.sections.push({
					...config.footer.sections[0],
				});
			},
		],
		[
			"social providers",
			(config: any) => {
				config.footer.socialLinks.push({
					...config.footer.socialLinks[0],
				});
			},
		],
		[
			"funder IDs",
			(config: any) => {
				config.footer.funders.push({
					...config.footer.funders[0],
				});
			},
		],
		[
			"enabled locales",
			(config: any) => {
				config.localization.locales = ["en-GB", "en-GB"];
				config.localization.localePriority = ["en-GB"];
				config.features.languageSwitcher = false;
			},
		],
		[
			"locale priority",
			(config: any) => {
				config.localization.localePriority = [
					"en-GB",
					"fr",
					"en-GB",
				];
			},
		],
		[
			"search scopes",
			(config: any) => {
				config.search.scopes.push(config.search.scopes[0]);
			},
		],
		...[
			"comingSoon",
			"internal",
			"hidden",
			"description",
			"redirects",
			"publish",
		].map((tagList) => [
			`${tagList} tags`,
			(config: any) => {
				config.content.tags[tagList].push(
					config.content.tags[tagList][0],
				);
			},
		]),
		[
			"collection IDs",
			(config: any) => {
				config.collections.push({ ...config.collections[0] });
			},
		],
		[
			"gap-map IDs",
			(config: any) => {
				config.gapMaps.push({
					...config.gapMaps[0],
					slug: "gap-map-two",
				});
			},
		],
		[
			"gap-map slugs",
			(config: any) => {
				config.gapMaps.push({
					...config.gapMaps[0],
					id: "gap-map-two",
				});
			},
		],
		[
			"AI providers",
			(config: any) => {
				config.ai.providers.push({ ...config.ai.providers[0] });
			},
		],
		...["structureRules", "pdfRules", "sharedRules"].map(
			(ruleList) => [
				`${ruleList} IDs`,
				(config: any) => {
					config.processing[ruleList].push({
						...config.processing[ruleList][0],
					});
				},
			],
		),
	] as [string, (config: any) => void][])(
		"rejects duplicate %s",
		(_name, mutate) => {
			expectCatalogIssue(mutate, "Duplicate value");
		},
	);
});

describe("manifest-wide activation", () => {
	it("detects link colors without any accessible generated tone", () => {
		expect(hasAccessiblePaletteTone("#000000", "#000000")).toBe(false);
		expect(hasAccessiblePaletteTone("#1976D2", "#FFFFFF")).toBe(true);
		expect(
			hasAccessiblePaletteTone("#FFFFFF", "#00000080", "dark"),
		).toBe(true);
		expect(
			hasAccessiblePaletteTone("#FFFFFF", "#00000080", "light"),
		).toBe(false);
	});

	it("accepts multiple configured weights for variable WOFF2 fonts", () => {
		const config: any = cloneLibraryConfig();
		config.theme.fonts.heading = { ...config.theme.fonts.body };
		config.theme.fonts.weights = [400, 500, 700];

		expect(catalogSchema.safeParse(config).success).toBe(true);
	});

	it("rejects multiple configured weights for static WOFF2 fonts", () => {
		const config: any = cloneLibraryConfig();
		config.theme.fonts.body.weight = 400;
		config.theme.fonts.weights = [400, 500];

		const result = catalogSchema.safeParse(config);

		expect(result.success).toBe(false);
		expect(
			result.error?.issues.some(
				(issue: any) =>
					issue.path.join(".") === "theme.fonts.weights" &&
					issue.message.includes("Static WOFF2"),
			),
		).toBe(true);
	});

	it("accepts case-insensitive HTTPS schemes for blank targets", () => {
		const config: any = cloneLibraryConfig();
		config.navigation.links[1].href = "HTTPS://partner.example.org";

		expect(catalogSchema.safeParse(config).success).toBe(true);
	});

	it("validates featured values against indexed institutions, not branding records", () => {
		const config: any = cloneLibraryConfig();
		config.institutions = [];
		config.filters.institution.featuredValue =
			"Indexed Institution Without Branding";

		expect(catalogSchema.safeParse(config).success).toBe(true);
	});

	it("rejects document scopes when full-text search is disabled", () => {
		const config: any = cloneLibraryConfig();
		config.search.fullText = false;
		config.search.scopes = ["documents", "title"];
		config.search.defaultScope = "title";

		const result = catalogSchema.safeParse(config);

		expect(result.success).toBe(false);
		expect(
			result.error?.issues.some(
				(issue: any) =>
					issue.path.join(".") === "search.scopes.0" &&
					issue.message.includes("full-text"),
			),
		).toBe(true);
	});

	it("omits the default document scope when full-text search is disabled", () => {
		const config: any = cloneLibraryConfig(minimalLibraryConfig);
		config.search = { fullText: false };

		const result = catalogSchema.safeParse(config);

		expect(result.success).toBe(true);
		expect(result.data?.search.scopes).not.toContain("documents");
	});

	it("defaults omitted processing priority to list order", () => {
		const config: any = cloneLibraryConfig();
		delete config.processing.structureRules[0].priority;

		const parsed = catalogSchema.parse(config);
		expect(parsed.processing.structureRules[0].priority).toBe(0);
	});

	it("rejects manifests larger than 1 MiB", () => {
		const config = cloneLibraryConfig(minimalLibraryConfig);
		config.identity.assets.logoStyles = "x".repeat(1024 * 1024);

		expect(catalogSchema.safeParse(config).success).toBe(false);
	});

	it("rejects unknown root keys", () => {
		const config = {
			...cloneLibraryConfig(minimalLibraryConfig),
			unknown: true,
		};

		expect(catalogSchema.safeParse(config).success).toBe(false);
	});
});
