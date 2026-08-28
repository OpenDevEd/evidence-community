import { isSourceConnectionKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

import { zoteroConnectionConfigSchema } from "@/lib/source-ingestion/zotero/schema";

import {
	PLATFORM_AI_MODEL_CATALOG,
	PLATFORM_AI_PROVIDERS,
	PLATFORM_FONT_CATALOG,
	PLATFORM_LOCALES,
	PLATFORM_NAVBAR_ICON_IDS,
	PLATFORM_PROMPT_SLOTS,
	PLATFORM_PROMPT_VARIABLES,
	PLATFORM_RULE_ACTIONS,
	PLATFORM_RULE_CONDITIONS,
	PLATFORM_SEARCH_SCOPES,
	PLATFORM_SOCIAL_PROVIDERS,
	type PlatformSearchScope,
} from "./catalogs";
import {
	addDuplicateIssues,
	colorSchema,
	emailSchema,
	hostSchema,
	idSchema,
	internalLinkSchema,
	linkSchema,
	modelIdSchema,
	nonEmptyStringSchema,
	plainTextSchema,
	postgresUrlSchema,
	publicHttpsOriginSchema,
	publicHttpsUrlSchema,
	revisionSchema,
	rawStringSchema,
	secretSchema,
	serviceUrlSchema,
	singleLineStringSchema,
	stableHtmlUrlSchema,
	stableIconUrlSchema,
	stableImageUrlSchema,
	stableShareImageUrlSchema,
	stableWoff2UrlSchema,
	tagSchema,
	utcTimestampSchema,
} from "./primitives";
import { generateColorRamp, parseHexColor, type RgbaColor } from "./theme";

export const MAX_LIBRARY_CONFIG_BYTES = 1024 * 1024;
const DEFAULT_FONT_WEIGHTS = [400, 500, 700] as const;
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const fundingPartnerSchema = z
	.object({
		id: idSchema,
		name: singleLineStringSchema(100),
	})
	.strict();

type CssScanState = {
	depth: number;
	escaped: boolean;
	quote: "'" | '"' | null;
};

function newCssScanState(): CssScanState {
	return { depth: 0, escaped: false, quote: null };
}

/**
 * Reads one character of CSS text and remembers whether the reader is inside
 * an escape, a quoted string or brackets. Answers `true` only for a character
 * that stands on its own, which is the only place a separator can be.
 */
function isPlainCssCharacter(state: CssScanState, character: string) {
	if (state.escaped) {
		state.escaped = false;
		return false;
	}
	if (character === "\\") {
		state.escaped = true;
		return false;
	}
	if (state.quote) {
		if (character === state.quote) state.quote = null;
		return false;
	}
	if (character === "'" || character === '"') {
		state.quote = character;
		return false;
	}
	if (character === "(") {
		state.depth += 1;
		return false;
	}
	if (character === ")") {
		state.depth -= 1;
		return false;
	}

	return state.depth === 0;
}

/**
 * Splits a CSS declaration list on the semicolons that separate declarations.
 * Returns `null` when a quote or bracket is left open, which means the text is
 * not a declaration list at all.
 */
function splitCssDeclarations(value: string) {
	const state = newCssScanState();
	const declarations: string[] = [];
	let start = 0;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (isPlainCssCharacter(state, character) && character === ";") {
			declarations.push(value.slice(start, index));
			start = index + 1;
		}
		if (state.depth < 0) return null;
	}

	if (state.quote || state.depth !== 0) return null;
	declarations.push(value.slice(start));

	return declarations;
}

const CSS_PROPERTY_PATTERN = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/;

/**
 * The property name of one declaration, or `null` when the text is not a
 * declaration.
 */
function cssDeclarationProperty(declaration: string) {
	const trimmed = declaration.trim();
	const state = newCssScanState();
	let colon = -1;

	for (let index = 0; index < trimmed.length; index += 1) {
		const character = trimmed[index];
		if (isPlainCssCharacter(state, character) && character === ":") {
			colon = index;
			break;
		}
	}

	if (colon <= 0) return null;
	const property = trimmed.slice(0, colon).trim();
	if (!trimmed.slice(colon + 1).trim()) return null;

	return CSS_PROPERTY_PATTERN.test(property) ? property : null;
}

function isCssDeclarationList(value: string) {
	if (!value) return true;

	const declarations = splitCssDeclarations(value);
	if (!declarations) return false;

	return declarations.every(
		(declaration) =>
			!declaration.trim() || cssDeclarationProperty(declaration) !== null,
	);
}

/**
 * CSS that decides how much room the logo takes, or where it sits. The bar
 * owns both, so a library may not set them: a stray `height` used to push a
 * logo straight out of the header.
 */
const LOGO_LAYOUT_PROPERTIES = new Set([
	"all",
	"aspect-ratio",
	"block-size",
	"bottom",
	"box-sizing",
	"contain",
	"display",
	"float",
	"height",
	"inline-size",
	"left",
	"max-block-size",
	"max-height",
	"max-inline-size",
	"max-width",
	"min-block-size",
	"min-height",
	"min-inline-size",
	"min-width",
	"position",
	"right",
	"rotate",
	"scale",
	"top",
	"transform",
	"transform-box",
	"transform-origin",
	"translate",
	"width",
	"zoom",
]);

const LOGO_LAYOUT_PROPERTY_PREFIXES = ["inset", "margin", "padding"];

function isLogoLayoutProperty(property: string) {
	return (
		LOGO_LAYOUT_PROPERTIES.has(property) ||
		LOGO_LAYOUT_PROPERTY_PREFIXES.some(
			(prefix) => property === prefix || property.startsWith(`${prefix}-`),
		)
	);
}

/** The first size or position property in the list, or `null` when there is none. */
function findLogoLayoutProperty(value: string) {
	for (const declaration of splitCssDeclarations(value) ?? []) {
		const property = cssDeclarationProperty(declaration)?.toLowerCase();
		if (property && isLogoLayoutProperty(property)) return property;
	}

	return null;
}

const logoStylesSchema = rawStringSchema
	.pipe(z.string().max(10_000))
	.refine((value) => !/[{}<]/.test(value), {
		message:
			"Logo styles must contain CSS declarations only, without braces or markup",
	})
	.refine(isCssDeclarationList, {
		message: "Logo styles must be a valid CSS declaration list",
	})
	.superRefine((value, context) => {
		const property = findLogoLayoutProperty(value);
		if (!property) return;

		context.addIssue({
			code: "custom",
			message: `Logo styles cannot set size or position. Remove "${property}". Each bar decides how tall the logo is drawn.`,
		});
	});

const identityAssetsSchema = z
	.object({
		logoDark: stableImageUrlSchema,
		logoLight: stableImageUrlSchema.optional(),
		favicon: stableIconUrlSchema,
		icons: z
			.array(stableIconUrlSchema)
			.max(12)
			.default([])
			.superRefine((icons, context) =>
				addDuplicateIssues(icons, context, (icon) => icon),
			),
		logoStyles: logoStylesSchema.default(""),
		shareImage: stableShareImageUrlSchema.optional(),
	})
	.strict()
	.transform((assets) => ({
		...assets,
		logoLight: assets.logoLight ?? assets.logoDark,
	}));

const identitySchema = z
	.object({
		name: singleLineStringSchema(100),
		shortName: singleLineStringSchema(40).optional(),
		tagline: singleLineStringSchema(160).optional(),
		description: plainTextSchema(300).optional(),
		baseUrl: publicHttpsOriginSchema,
		fundingPartners: z
			.array(fundingPartnerSchema)
			.max(20)
			.default([])
			.superRefine((partners, context) =>
				addDuplicateIssues(partners, context, (partner) => partner.id),
			),
		assets: identityAssetsSchema,
	})
	.strict()
	.superRefine((identity, context) => {
		if (!identity.shortName && identity.name.length > 40) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Names longer than 40 characters require an explicit short name",
				path: ["shortName"],
			});
		}
	})
	.transform((identity) => ({
		...identity,
		shortName: identity.shortName ?? identity.name,
	}));

const institutionSchema = z
	.object({
		id: idSchema,
		name: singleLineStringSchema(120),
		logoUrl: stableImageUrlSchema.optional(),
	})
	.strict();

const institutionsSchema = z
	.array(institutionSchema)
	.max(200)
	.default([])
	.superRefine((institutions, context) => {
		addDuplicateIssues(
			institutions,
			context,
			(institution) => institution.id,
		);
		addDuplicateIssues(institutions, context, (institution) =>
			institution.name.toLowerCase(),
		);
	});

const googleFontSchema = z
	.object({
		source: z.literal("google"),
		family: z.enum(
			Object.keys(PLATFORM_FONT_CATALOG) as [
				keyof typeof PLATFORM_FONT_CATALOG,
				...(keyof typeof PLATFORM_FONT_CATALOG)[],
			],
		),
	})
	.strict();

const woff2FontSchema = z
	.object({
		source: z.literal("woff2"),
		family: singleLineStringSchema(100).refine(
			(value) => /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(value),
			{
				message:
					"Font family must contain only letters, numbers, spaces, dots, underscores, or hyphens",
			},
		),
		url: stableWoff2UrlSchema,
		weight: z.union([z.literal(400), z.literal("variable")]),
	})
	.strict();

export const fontSchema = z.discriminatedUnion("source", [
	googleFontSchema,
	woff2FontSchema,
]);

const fontWeightSchema = z.union(
	FONT_WEIGHTS.map((weight) => z.literal(weight)) as [
		z.ZodLiteral<(typeof FONT_WEIGHTS)[number]>,
		z.ZodLiteral<(typeof FONT_WEIGHTS)[number]>,
		...z.ZodLiteral<(typeof FONT_WEIGHTS)[number]>[],
	],
);

const themeFontsInputSchema = z
	.object({
		heading: fontSchema.optional(),
		body: fontSchema.optional(),
		weights: z
			.array(fontWeightSchema)
			.min(1)
			.max(10)
			.default([...DEFAULT_FONT_WEIGHTS])
			.superRefine((weights, context) =>
				addDuplicateIssues(weights, context, (weight) =>
					String(weight),
				),
			),
	})
	.strict()
	.prefault({});

const themeColorsSchema = z
	.object({
		accent: colorSchema,
		link: colorSchema.optional(),
		collection: colorSchema.optional(),
		doi: colorSchema.optional(),
		tertiary: colorSchema,
		backgroundDark: colorSchema.default("#0f0f0f"),
		backgroundLight: colorSchema.default("#F4F2EE"),
		cardDark: colorSchema.default("#141414"),
		cardLight: colorSchema.default("#FFFFFF"),
	})
	.strict()
	.transform((colors) => ({
		...colors,
		link: colors.link ?? colors.accent,
		collection: colors.collection ?? colors.accent,
		doi: colors.doi ?? colors.accent,
	}));

function composite(
	foreground: RgbaColor,
	background: [number, number, number],
): [number, number, number] {
	return [
		foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
		foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
		foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
	];
}

function luminance(color: [number, number, number]) {
	const channels = color.map((channel) => {
		const normalized = channel / 255;
		return normalized <= 0.04045
			? normalized / 12.92
			: ((normalized + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(
	foreground: [number, number, number],
	background: [number, number, number],
) {
	const light = Math.max(luminance(foreground), luminance(background));
	const dark = Math.min(luminance(foreground), luminance(background));
	return (light + 0.05) / (dark + 0.05);
}

export function hasAccessiblePaletteTone(
	link: string,
	background: string,
	canvas: "light" | "dark" = "light",
) {
	const canvasRgb: [number, number, number] =
		canvas === "dark" ? [0, 0, 0] : [255, 255, 255];
	const backgroundRgb = composite(parseHexColor(background), canvasRgb);

	return Object.values(generateColorRamp(link)).some(
		(tone) =>
			contrastRatio(composite(tone, backgroundRgb), backgroundRgb) >= 4.5,
	);
}

const themeSchema = z
	.object({
		layout: z.enum(["small", "wide"]).default("small"),
		colors: themeColorsSchema,
		defaultMode: z.enum(["light", "dark", "system"]).default("dark"),
		forcedMode: z.enum(["light", "dark"]).nullable().default(null),
		fonts: themeFontsInputSchema,
	})
	.strict()
	.transform((theme) => {
		const platformFont = {
			source: "google" as const,
			family:
				theme.layout === "small"
					? ("Ubuntu" as const)
					: ("Montserrat" as const),
		};

		return {
			...theme,
			fonts: {
				heading: theme.fonts.heading ?? platformFont,
				body: theme.fonts.body ?? platformFont,
				weights: theme.fonts.weights,
			},
		};
	})
	.superRefine((theme, context) => {
		if (!theme.fonts.weights.includes(400)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Font weights must include 400",
				path: ["fonts", "weights"],
			});
		}

		for (const field of ["heading", "body"] as const) {
			const font = theme.fonts[field];
			if (font.source === "woff2") {
				const unsupported =
					font.weight === 400
						? theme.fonts.weights.filter((weight) => weight !== 400)
						: [];

				if (unsupported.length) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						message:
							"Static WOFF2 files support only weight 400; use a variable WOFF2 file for multiple weights",
						path: ["fonts", "weights"],
					});
				}
				continue;
			}

			const supported = PLATFORM_FONT_CATALOG[font.family].weights;
			const unsupported = theme.fonts.weights.filter(
				(weight) =>
					!supported.includes(weight as (typeof supported)[number]),
			);

			if (unsupported.length) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `${font.family} does not support: ${unsupported.join(", ")}`,
					path: ["fonts", "weights"],
				});
			}
		}

		const { heading, body } = theme.fonts;
		if (
			heading.family.toLocaleLowerCase() ===
				body.family.toLocaleLowerCase() &&
			(heading.source !== body.source ||
				(heading.source === "woff2" &&
					body.source === "woff2" &&
					(heading.url !== body.url ||
						heading.weight !== body.weight)))
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Heading and body fonts with the same family must use the same source",
				path: ["fonts", "body", "family"],
			});
		}

		for (const [background, canvas] of [
			[theme.colors.backgroundDark, "dark"],
			[theme.colors.backgroundLight, "light"],
		] as const) {
			if (
				!hasAccessiblePaletteTone(theme.colors.link, background, canvas)
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Link palette must provide a WCAG AA tone against each background",
					path: ["colors", "link"],
				});
				break;
			}
		}
	});

const iconReferenceSchema = z.union([
	z.enum(PLATFORM_NAVBAR_ICON_IDS),
	stableIconUrlSchema,
]);

const linkFields = {
	id: idSchema,
	label: singleLineStringSchema(80),
	href: linkSchema,
	icon: iconReferenceSchema.optional(),
	target: z.enum(["self", "blank"]).default("self"),
	visible: z.boolean().default(true),
};

function addBlankTargetIssue(
	link: { href: string; target: "self" | "blank" },
	context: z.RefinementCtx,
) {
	if (link.target === "blank" && !/^https:\/\//iu.test(link.href)) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Blank targets require a public HTTPS link",
			path: ["target"],
		});
	}
}

const leafLinkSchema = z
	.object(linkFields)
	.strict()
	.superRefine(addBlankTargetIssue);

const navigationLinkSchema = z
	.object({
		...linkFields,
		children: z.array(leafLinkSchema).max(12).default([]),
	})
	.strict()
	.superRefine((link, context) => {
		addBlankTargetIssue(link, context);

		addDuplicateIssues(link.children, context, (child) => child.id, [
			"children",
		]);
	});

const navigationSchema = z
	.object({
		links: z
			.array(navigationLinkSchema)
			.max(12)
			.default([])
			.superRefine((links, context) =>
				addDuplicateIssues(links, context, (link) => link.id),
			),
	})
	.strict()
	.prefault({});

const footerSectionSchema = z
	.object({
		id: idSchema,
		title: singleLineStringSchema(80),
		links: z
			.array(leafLinkSchema)
			.max(12)
			.default([])
			.superRefine((links, context) =>
				addDuplicateIssues(links, context, (link) => link.id),
			),
	})
	.strict();

const socialLinkSchema = z
	.object({
		provider: z.enum(PLATFORM_SOCIAL_PROVIDERS),
		href: publicHttpsUrlSchema,
	})
	.strict();

const funderSchema = z
	.object({
		id: idSchema,
		name: singleLineStringSchema(100),
		logoUrl: stableImageUrlSchema.optional(),
		href: publicHttpsUrlSchema.optional(),
	})
	.strict();

const footerSchema = z
	.object({
		sections: z
			.array(footerSectionSchema)
			.max(6)
			.default([])
			.superRefine((sections, context) =>
				addDuplicateIssues(sections, context, (section) => section.id),
			),
		socialLinks: z
			.array(socialLinkSchema)
			.max(PLATFORM_SOCIAL_PROVIDERS.length)
			.default([])
			.superRefine((links, context) =>
				addDuplicateIssues(links, context, (link) => link.provider),
			),
		funders: z
			.array(funderSchema)
			.max(20)
			.default([])
			.superRefine((funders, context) =>
				addDuplicateIssues(funders, context, (funder) => funder.id),
			),
		disclaimer: plainTextSchema(2000).default(""),
		attribution: plainTextSchema(500).default(""),
		poweredBy: z.boolean().default(true),
	})
	.strict()
	.prefault({});

const contactSchema = z
	.object({
		email: emailSchema.optional(),
		phone: z
			.string()
			.trim()
			.regex(/^\+[1-9]\d{1,14}$/u, {
				message: "Phone number must use E.164 format",
			})
			.optional(),
		address: nonEmptyStringSchema(500)
			.refine((value) => value.split(/\r?\n/u).length <= 8, {
				message: "Address cannot exceed 8 lines",
			})
			.optional(),
	})
	.strict()
	.prefault({});

const LEGAL_MARKDOWN_MAXIMUM = 200_000;
const legalMarkdownSchema = nonEmptyStringSchema(LEGAL_MARKDOWN_MAXIMUM);

const legalSchema = z
	.object({
		privacyPolicy: linkSchema.default("/privacy"),
		cookiePolicy: linkSchema.default("/cookie-policy"),
		termsOfService: linkSchema.optional(),
		privacyMarkdown: legalMarkdownSchema.optional(),
		cookieMarkdown: legalMarkdownSchema.optional(),
		termsMarkdown: legalMarkdownSchema.optional(),
	})
	.strict()
	.prefault({})
	.transform((legal) => ({
		...legal,
		// Owner-written terms live on the runtime's own /terms page unless the
		// owner points the link somewhere else.
		termsOfService:
			legal.termsOfService ?? (legal.termsMarkdown ? "/terms" : undefined),
	}));

const localeSchema = z.enum(PLATFORM_LOCALES);

const localizationSchema = z
	.object({
		locales: z
			.array(localeSchema)
			.min(1)
			.max(PLATFORM_LOCALES.length)
			.superRefine((locales, context) =>
				addDuplicateIssues(locales, context, (locale) => locale),
			),
		defaultLocale: localeSchema,
		detectLocale: z.boolean().default(false),
		localePriority: z
			.array(localeSchema)
			.max(PLATFORM_LOCALES.length)
			.superRefine((locales, context) =>
				addDuplicateIssues(locales, context, (locale) => locale),
			)
			.optional(),
	})
	.strict()
	.transform((localization) => ({
		...localization,
		localePriority: localization.localePriority ?? [
			...localization.locales,
		],
	}))
	.superRefine((localization, context) => {
		if (!localization.locales.includes(localization.defaultLocale)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Default locale must be enabled",
				path: ["defaultLocale"],
			});
		}

		localization.localePriority.forEach((locale, index) => {
			if (!localization.locales.includes(locale)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Priority locale must be enabled",
					path: ["localePriority", index],
				});
			}
		});
	});

const scopeSchema = z.enum(PLATFORM_SEARCH_SCOPES);

const embedderDimensionsSchema = z.number().int().min(1).max(65_536);

const embedderModelSchema = z.string().trim().min(1).max(128);

function containsPlaceholder(value: unknown, placeholder: string): boolean {
	if (typeof value === "string") return value.includes(placeholder);
	if (Array.isArray(value)) {
		return value.some((entry) => containsPlaceholder(entry, placeholder));
	}
	if (value && typeof value === "object") {
		return Object.values(value).some((entry) =>
			containsPlaceholder(entry, placeholder),
		);
	}
	return false;
}

function embedderTemplateSchema(placeholder: string) {
	return z
		.record(z.string(), z.unknown())
		.refine((value) => containsPlaceholder(value, placeholder), {
			message: `Template must contain ${placeholder}`,
		});
}

const openAiEmbedderSchema = z
	.object({
		source: z.literal("openAi"),
		model: embedderModelSchema,
		apiKey: secretSchema(1, 512),
		dimensions: embedderDimensionsSchema.optional(),
	})
	.strict();

const restEmbedderSchema = z
	.object({
		source: z.literal("rest"),
		url: serviceUrlSchema,
		apiKey: secretSchema(1, 512).optional(),
		dimensions: embedderDimensionsSchema.optional(),
		request: embedderTemplateSchema("{{text}}"),
		response: embedderTemplateSchema("{{embedding}}"),
		headers: z
			.record(singleLineStringSchema(128), singleLineStringSchema(1024))
			.optional(),
	})
	.strict();

export const searchEmbedderSchema = z
	.discriminatedUnion("source", [openAiEmbedderSchema, restEmbedderSchema])
	.nullable()
	.default(null);

const searchOptionsShape = {
	fullText: z.boolean().default(true),
	tags: z.boolean().default(true),
	country: z.boolean().default(true),
	authorCountry: z.boolean().default(true),
	scopes: z
		.array(scopeSchema)
		.min(1)
		.max(PLATFORM_SEARCH_SCOPES.length)
		.superRefine((scopes, context) =>
			addDuplicateIssues(scopes, context, (scope) => scope),
		)
		.optional(),
	defaultScope: scopeSchema.optional(),
};

type SearchOptions = {
	fullText: boolean;
	scopes?: PlatformSearchScope[];
	defaultScope?: PlatformSearchScope;
};

function applySearchScopeDefaults<Search extends SearchOptions>(
	search: Search,
) {
	const scopes =
		search.scopes ??
		PLATFORM_SEARCH_SCOPES.filter(
			(scope) => search.fullText || scope !== "documents",
		);
	return {
		...search,
		scopes,
		defaultScope: search.defaultScope ?? scopes[0]!,
	};
}

function refineSearchScopes(
	search: {
		fullText: boolean;
		scopes: PlatformSearchScope[];
		defaultScope: PlatformSearchScope;
	},
	context: z.RefinementCtx,
) {
	if (!search.scopes.includes(search.defaultScope)) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Default scope must be enabled",
			path: ["defaultScope"],
		});
	}
	if (!search.fullText) {
		search.scopes.forEach((scope, index) => {
			if (scope === "documents") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Documents scope requires full-text search",
					path: ["scopes", index],
				});
			}
		});
	}
}

const searchSchema = z
	.object({ ...searchOptionsShape, embedder: searchEmbedderSchema })
	.strict()
	.prefault({})
	.transform(applySearchScopeDefaults)
	.superRefine(refineSearchScopes);

const publicSearchSchema = z
	.object({ ...searchOptionsShape, embeddings: z.boolean() })
	.strict()
	.transform(applySearchScopeDefaults)
	.superRefine(refineSearchScopes);

const filtersSchema = z
	.object({
		institution: z
			.object({
				mode: z
					.enum(["hidden", "facet", "facet-with-featured-value"])
					.default("facet"),
				label: singleLineStringSchema(60).default("institutions"),
				featuredValue: singleLineStringSchema(120).optional(),
			})
			.strict()
			.prefault({}),
		countryLibrary: z.boolean().default(false),
		collectionsExpanded: z.boolean().default(true),
		years: z
			.object({
				enabled: z.boolean().default(true),
				minimum: z
					.number()
					.int()
					.min(1900)
					.refine((value) => value <= new Date().getUTCFullYear(), {
						message: "Minimum year cannot be in the future",
					})
					.default(1900),
				maximum: z
					.number()
					.int()
					.min(1900)
					.refine((value) => value <= new Date().getUTCFullYear(), {
						message: "Maximum year cannot be in the future",
					})
					.default(() => new Date().getUTCFullYear())
					.meta({ "x-dynamicDefault": "currentUtcYear" }),
			})
			.strict()
			.prefault({}),
	})
	.strict()
	.prefault({})
	.superRefine((filters, context) => {
		if (
			filters.institution.mode === "facet-with-featured-value" &&
			!filters.institution.featuredValue
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Featured institution mode requires a value",
				path: ["institution", "featuredValue"],
			});
		}

		if (filters.years.maximum < filters.years.minimum) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Maximum year cannot be lower than minimum year",
				path: ["years", "maximum"],
			});
		}
	});

function tagList(defaultValue: readonly string[], minimum = 0) {
	return z
		.array(tagSchema)
		.min(minimum)
		.max(10)
		.default([...defaultValue])
		.superRefine((tags, context) =>
			addDuplicateIssues(tags, context, (tag) => tag),
		);
}

const contentSchema = z
	.object({
		tags: z
			.object({
				comingSoon: tagList(["_comingsoon"]),
				internal: tagList(["internal"]),
				hidden: tagList(["hide"]),
				description: tagList(["_category_description"]),
				redirects: tagList(["_redirects"]),
				publish: tagList(["_publish", "publishPDF"], 1),
			})
			.strict()
			.prefault({}),
	})
	.strict()
	.prefault({});

const citationsSchema = z
	.object({
		showUrl: z.boolean().default(false),
	})
	.strict()
	.prefault({});

// The public copy adds whether a citation server is configured, so the
// item page can leave the citation row out instead of loading and hiding it.
const publicCitationsSchema = z
	.object({
		enabled: z.boolean(),
		showUrl: z.boolean(),
	})
	.strict();

const featuresSchema = z
	.object({
		themeSwitcher: z.boolean().default(false),
		languageSwitcher: z.boolean().default(false),
		login: z.boolean().default(false),
		navbarSearch: z.boolean().default(true),
		userCollections: z.boolean().default(false),
		ai: z.boolean().default(false),
		aiSearch: z.boolean().default(false),
		deepResearch: z.boolean().default(false),
		relatedResources: z.boolean().default(false),
		collections: z.boolean().default(true),
		collectionNotes: z.boolean().default(false),
		countryFocus: z.boolean().default(false),
		authorFilter: z.boolean().default(true),
		authorLocation: z.boolean().default(false),
		yearsDropdown: z.boolean().default(false),
		downloads: z.boolean().default(false),
		atomFeed: z.boolean().default(false),
	})
	.strict()
	.prefault({});

const collectionSchema = z
	.object({
		id: idSchema,
		title: singleLineStringSchema(100).optional(),
		enabled: z.boolean().default(true),
		order: z.number().int().min(0).max(9999).optional(),
	})
	.strict();

const collectionsSchema = z
	.array(collectionSchema)
	.max(500)
	.default([])
	.superRefine((collections, context) =>
		addDuplicateIssues(collections, context, (collection) => collection.id),
	);

const gapMapSchema = z
	.object({
		id: idSchema,
		slug: z
			.string()
			.trim()
			.min(1)
			.max(80)
			.regex(/^[a-z0-9][a-z0-9-]*$/u),
		label: singleLineStringSchema(100),
		description: nonEmptyStringSchema(500).optional(),
		sourceUrl: stableHtmlUrlSchema,
		enabled: z.boolean().default(true),
	})
	.strict();

const gapMapsSchema = z
	.array(gapMapSchema)
	.max(50)
	.default([])
	.superRefine((gapMaps, context) => {
		addDuplicateIssues(gapMaps, context, (gapMap) => gapMap.id);
		addDuplicateIssues(gapMaps, context, (gapMap) => gapMap.slug);
	});

const publicGapMapSchema = gapMapSchema
	.omit({
		id: true,
		sourceUrl: true,
		enabled: true,
	})
	.extend({
		href: internalLinkSchema,
	})
	.strict();

const publicGapMapsSchema = z.array(publicGapMapSchema).max(50).default([]);

// One switch per citation format. The library builds every file itself from
// its own records, so there are no external file addresses here.
const exportsSchema = z
	.object({
		ris: z.boolean().default(true),
		bibtex: z.boolean().default(true),
		atom: z.boolean().default(false),
	})
	.strict()
	.prefault({});

const crossrefPublicationSchema = z
	.object({
		enabled: z.boolean().default(false),
		environment: z.literal("test").default("test"),
		loginId: secretSchema(1, 255).optional(),
		depositorName: singleLineStringSchema(255).optional(),
		email: emailSchema.optional(),
		password: secretSchema(1, 512).optional(),
		registrant: singleLineStringSchema(255).optional(),
		prefix: z
			.string()
			.trim()
			.regex(/^10\.\d{4,9}$/u, "Crossref prefix must look like 10.1234")
			.optional(),
		suffixNamespace: z
			.string()
			.trim()
			.toLowerCase()
			.min(1)
			.max(64)
			.regex(
				/^[a-z0-9][a-z0-9._-]*$/u,
				"DOI suffix namespace must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens",
			)
			.optional(),
	})
	.strict()
	.prefault({})
	.superRefine((crossref, context) => {
		if (!crossref.enabled) return;

		for (const [field, message] of [
			["loginId", "Enabled Crossref publication requires a login ID"],
			[
				"depositorName",
				"Enabled Crossref publication requires a depositor name",
			],
			["email", "Enabled Crossref publication requires an email address"],
			["password", "Enabled Crossref publication requires a password"],
			[
				"registrant",
				"Enabled Crossref publication requires a registrant",
			],
			[
				"prefix",
				"Enabled Crossref publication requires an assigned prefix",
			],
			[
				"suffixNamespace",
				"Enabled Crossref publication requires a library DOI suffix namespace",
			],
		] as const) {
			if (crossref[field]) continue;
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message,
				path: [field],
			});
		}
	});

const zenodoPublicationSchema = z
	.object({
		enabled: z.boolean().default(false),
		environment: z.literal("sandbox").default("sandbox"),
		token: secretSchema(1, 2048).optional(),
		defaultIdentifierPolicy: z
			.enum(["reuse-crossref", "mint-zenodo"])
			.default("reuse-crossref"),
		accessRight: z.literal("open").default("open"),
		license: z
			.string()
			.trim()
			.toLowerCase()
			.min(1)
			.max(128)
			.regex(
				/^[a-z0-9][a-z0-9.-]*$/u,
				"Zenodo license must be a supported license ID",
			)
			.default("cc-by-4.0"),
	})
	.strict()
	.prefault({})
	.superRefine((zenodo, context) => {
		if (zenodo.enabled && !zenodo.token) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Enabled Zenodo publication requires a Sandbox token",
				path: ["token"],
			});
		}
	});

const publicationWorkerSchema = z
	.object({
		batchSize: z.number().int().min(1).max(500).default(25),
		leaseSeconds: z.number().int().min(30).max(3_600).default(900),
		retryLimit: z.number().int().min(1).max(20).default(8),
		nightlyUtcTime: z
			.string()
			.trim()
			.regex(
				/^(?:[01]\d|2[0-3]):[0-5]\d$/u,
				"Nightly publication time must use 24-hour UTC time such as 02:00",
			)
			.default("02:00"),
	})
	.strict()
	.prefault({});

const publicationServicesSchema = z
	.object({
		crossref: crossrefPublicationSchema,
		zenodo: zenodoPublicationSchema,
		worker: publicationWorkerSchema,
	})
	.strict()
	.prefault({})
	.superRefine((publication, context) => {
		if (
			publication.zenodo.enabled &&
			publication.zenodo.defaultIdentifierPolicy === "reuse-crossref" &&
			!publication.crossref.enabled
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Zenodo can reuse a Crossref DOI only when Crossref publication is enabled",
				path: ["zenodo", "defaultIdentifierPolicy"],
			});
		}
	});

const servicesSchema = z
	.object({
		database: z
			.object({
				url: postgresUrlSchema,
			})
			.strict(),
		search: z
			.object({
				host: serviceUrlSchema,
				key: secretSchema(1, 512),
				index: z
					.string()
					.trim()
					.min(1)
					.max(128)
					.regex(/^[A-Za-z0-9_-]+$/u),
			})
			.strict(),
		storage: z
			.object({
				url: serviceUrlSchema,
				serviceRoleKey: secretSchema(1, 2048),
				privateBucket: z
					.string()
					.trim()
					.min(3)
					.max(63)
					.regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
				publicBucket: z
					.string()
					.trim()
					.min(3)
					.max(63)
					.regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
				maxPdfBytes: z.number().int().min(1_024).max(524_288_000),
			})
			.strict()
			.refine(
				(storage) => storage.privateBucket !== storage.publicBucket,
				{
					message:
						"Private and public storage buckets must be different",
					path: ["publicBucket"],
				},
			),
		zotero: z
			.object({
				translationUrl: serviceUrlSchema.optional(),
			})
			.strict()
			.prefault({}),
		publication: publicationServicesSchema,
	})
	.strict();

const sourceConfigurationSchema = z
	.object({
		key: z
			.string()
			.trim()
			.min(1)
			.max(64)
			.refine(isSourceConnectionKey, "Invalid source connection key"),
		provider: z.literal("zotero"),
		groupId: z.string().trim().regex(/^\d+$/u).max(512),
		apiKey: secretSchema(1, 512),
		enabled: z.boolean().default(true),
		writebackEnabled: z.boolean().default(false),
		settings: zoteroConnectionConfigSchema.prefault({}),
	})
	.strict();

const sourcesSchema = z
	.array(sourceConfigurationSchema)
	.max(100)
	.default([])
	.superRefine((sources, context) => {
		addDuplicateIssues(sources, context, (source) => source.key);
		addDuplicateIssues(sources, context, (source) => source.groupId);
	});

const aiProviderSchema = z
	.object({
		provider: z.enum(PLATFORM_AI_PROVIDERS),
		enabled: z.boolean().default(false),
		apiKey: secretSchema(1, 512).optional(),
		defaultModel: modelIdSchema.optional(),
		largeModel: modelIdSchema.optional(),
		smallModel: modelIdSchema.optional(),
	})
	.strict()
	.superRefine((provider, context) => {
		const catalog = PLATFORM_AI_MODEL_CATALOG[provider.provider];

		if (provider.enabled && !provider.apiKey) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Enabled AI providers require an API key",
				path: ["apiKey"],
			});
		}

		if (provider.enabled && !provider.defaultModel) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Enabled AI providers require a default model",
				path: ["defaultModel"],
			});
		}

		for (const [field, allowed] of [
			["defaultModel", catalog.active],
			["largeModel", catalog.large],
			["smallModel", catalog.small],
		] as const) {
			const value = provider[field];
			if (value && !(allowed as readonly string[]).includes(value)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `${value} is not an approved ${provider.provider} ${field}`,
					path: [field],
				});
			}
		}
	});

function promptValueSchema(slot: (typeof PLATFORM_PROMPT_SLOTS)[number]) {
	return nonEmptyStringSchema(20_000).superRefine((value, context) => {
		const variables = value.matchAll(
			/\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/gu,
		);
		const allowed = PLATFORM_PROMPT_VARIABLES[slot];

		for (const match of variables) {
			if (!allowed.includes(match[1])) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Unknown variable for ${slot}: ${match[1]}`,
				});
			}
		}
	});
}

const promptSlotsSchema = z
	.object({
		questions: promptValueSchema("questions").optional(),
		chat: promptValueSchema("chat").optional(),
		explain: promptValueSchema("explain").optional(),
		summarize: promptValueSchema("summarize").optional(),
	})
	.strict()
	.prefault({});

const aiSchema = z
	.object({
		providers: z
			.array(aiProviderSchema)
			.max(5)
			.default([])
			.superRefine((providers, context) =>
				addDuplicateIssues(
					providers,
					context,
					(provider) => provider.provider,
				),
			),
		prompts: promptSlotsSchema,
	})
	.strict()
	.prefault({});

const posthogSchema = z
	.object({
		host: publicHttpsOriginSchema.optional(),
		uiHost: publicHttpsOriginSchema.optional(),
		key: z
			.string()
			.trim()
			.min(20)
			.max(200)
			.regex(/^phc_[A-Za-z0-9_-]+$/u)
			.optional(),
	})
	.strict()
	.prefault({})
	.superRefine((posthog, context) => {
		if (Boolean(posthog.host) !== Boolean(posthog.key)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "PostHog host and key must be configured together",
			});
		}
		if (posthog.uiHost && !posthog.host) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "PostHog UI host requires a configured PostHog client",
				path: ["uiHost"],
			});
		}
	});

const analyticsSchema = z
	.object({
		posthog: posthogSchema,
		consentPolicyVersion: z.number().int().min(1).default(1),
		google: z
			.object({
				measurementId: z
					.string()
					.trim()
					.regex(/^G-[A-Z0-9]{4,20}$/u)
					.optional(),
			})
			.strict()
			.prefault({}),
		utmDurationSeconds: z
			.number()
			.int()
			.min(60)
			.max(7_776_000)
			.default(2_592_000),
	})
	.strict()
	.prefault({});

const authenticationSchema = z
	.object({
		google: z
			.object({
				enabled: z.boolean().default(false),
				clientId: secretSchema(10, 255).optional(),
				clientSecret: secretSchema(20, 512).optional(),
			})
			.strict()
			.prefault({}),
		openScholar: z
			.object({
				convexSiteUrl: publicHttpsOriginSchema,
				libraryId: singleLineStringSchema(128).refine(
					(value) => /^[a-z0-9]+$/u.test(value),
					"OpenScholar library ID must contain lowercase letters and numbers only",
				),
				loginPageUrl: publicHttpsUrlSchema,
				machineCredential: secretSchema(47, 47).refine(
					(value) => /^els_[A-Za-z0-9_-]{43}$/u.test(value),
					"OpenScholar machine credential must use the els_ format",
				),
			})
			.strict(),
		secret: secretSchema(32, 512),
	})
	.strict();

const smtpSchema = z
	.object({
		host: hostSchema.optional(),
		port: z.number().int().min(1).max(65_535).default(587),
		security: z.enum(["tls", "starttls", "none"]).default("starttls"),
		username: secretSchema(1, 255).optional(),
		password: secretSchema(1, 512).optional(),
		from: emailSchema.optional(),
	})
	.strict()
	.prefault({})
	.superRefine((smtp, context) => {
		if (Boolean(smtp.username) !== Boolean(smtp.password)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"SMTP username and password must be configured together",
			});
		}
	});

const emailConfigurationSchema = z
	.object({
		contactRecipient: emailSchema.optional(),
		takedownRecipient: emailSchema.optional(),
		smtp: smtpSchema,
	})
	.strict()
	.prefault({});

const generationSchema = z
	.object({
		sitemap: z.boolean().default(true),
		redirects: z.boolean().default(true),
	})
	.strict()
	.prefault({});

const processingRuleSchema = z
	.object({
		id: idSchema,
		priority: z.number().int().min(0).max(9999).optional(),
		condition: z.enum(PLATFORM_RULE_CONDITIONS),
		action: z.enum(PLATFORM_RULE_ACTIONS),
		value: nonEmptyStringSchema(20_000),
	})
	.strict();

function processingRuleList() {
	return z
		.array(processingRuleSchema)
		.max(100)
		.default([])
		.superRefine((rules, context) =>
			addDuplicateIssues(rules, context, (rule) => rule.id),
		)
		.transform((rules) =>
			rules.map((rule, index) => ({
				...rule,
				priority: rule.priority ?? index,
			})),
		);
}

const processingSchema = z
	.object({
		structureRules: processingRuleList(),
		pdfRules: processingRuleList(),
		sharedRules: processingRuleList(),
	})
	.strict()
	.prefault({});

const serverConfigShape = {
	schemaVersion: z.literal(1),
	revision: revisionSchema,
	updatedAt: utcTimestampSchema,
	identity: identitySchema,
	institutions: institutionsSchema,
	theme: themeSchema,
	navigation: navigationSchema,
	footer: footerSchema,
	contact: contactSchema,
	legal: legalSchema,
	localization: localizationSchema,
	search: searchSchema,
	filters: filtersSchema,
	content: contentSchema,
	citations: citationsSchema,
	features: featuresSchema,
	collections: collectionsSchema,
	gapMaps: gapMapsSchema,
	exports: exportsSchema,
	sources: sourcesSchema,
	services: servicesSchema,
	ai: aiSchema,
	analytics: analyticsSchema,
	authentication: authenticationSchema,
	email: emailConfigurationSchema,
	generation: generationSchema,
	processing: processingSchema,
};

export type LibraryConfigCatalogs = {
	collectionIds?: readonly string[] | ReadonlySet<string>;
	institutionNames?: readonly string[] | ReadonlySet<string>;
};

function addRequiredIssue(
	context: z.RefinementCtx,
	path: (string | number)[],
	message: string,
) {
	context.addIssue({
		code: z.ZodIssueCode.custom,
		message,
		path,
	});
}

function validateTagSemantics(
	config: z.output<ReturnType<typeof baseServerConfigSchema>>,
	context: z.RefinementCtx,
) {
	const semanticLists = [
		"comingSoon",
		"internal",
		"hidden",
		"description",
		"redirects",
	] as const;
	const seen = new Map<string, string>();

	for (const listName of semanticLists) {
		for (const [index, tag] of config.content.tags[listName].entries()) {
			const previous = seen.get(tag);
			if (previous) {
				addRequiredIssue(
					context,
					["content", "tags", listName, index],
					`Tag already belongs to ${previous}`,
				);
			} else {
				seen.set(tag, listName);
			}
		}
	}

	for (const [index, tag] of config.content.tags.publish.entries()) {
		if (
			config.content.tags.hidden.includes(tag) ||
			config.content.tags.internal.includes(tag)
		) {
			addRequiredIssue(
				context,
				["content", "tags", "publish", index],
				"Publish tags cannot also be hidden or internal",
			);
		}
	}
}

function baseServerConfigSchema() {
	return z.object(serverConfigShape).strict();
}

export function createLibraryConfigSchema(
	catalogs: LibraryConfigCatalogs = {},
) {
	const collectionIds = catalogs.collectionIds
		? new Set(catalogs.collectionIds)
		: null;
	const institutionNames = catalogs.institutionNames
		? new Set(
				Array.from(catalogs.institutionNames, (name) =>
					name.toLowerCase(),
				),
			)
		: null;

	return baseServerConfigSchema().superRefine((config, context) => {
		const byteLength = new TextEncoder().encode(
			JSON.stringify(config),
		).byteLength;
		if (byteLength > MAX_LIBRARY_CONFIG_BYTES) {
			addRequiredIssue(
				context,
				[],
				`Manifest exceeds ${MAX_LIBRARY_CONFIG_BYTES} bytes`,
			);
		}

		if (config.theme.forcedMode && config.features.themeSwitcher) {
			addRequiredIssue(
				context,
				["features", "themeSwitcher"],
				"Theme switcher must be disabled when a theme is forced",
			);
		}

		if (
			config.features.languageSwitcher &&
			config.localization.locales.length < 2
		) {
			addRequiredIssue(
				context,
				["features", "languageSwitcher"],
				"Language switcher requires at least two enabled locales",
			);
		}

		if (config.features.login && !config.authentication.secret) {
			addRequiredIssue(
				context,
				["authentication", "secret"],
				"Login requires an authentication secret",
			);
		}

		if (config.authentication.google.enabled) {
			if (!config.features.login) {
				addRequiredIssue(
					context,
					["authentication", "google", "enabled"],
					"Google authentication requires login",
				);
			}
			if (!config.authentication.google.clientId) {
				addRequiredIssue(
					context,
					["authentication", "google", "clientId"],
					"Google authentication requires a client ID",
				);
			}
			if (!config.authentication.google.clientSecret) {
				addRequiredIssue(
					context,
					["authentication", "google", "clientSecret"],
					"Google authentication requires a client secret",
				);
			}
		}

		if (config.features.userCollections && !config.features.login) {
			addRequiredIssue(
				context,
				["features", "userCollections"],
				"User collections require login",
			);
		}

		const enabledProviders = config.ai.providers.filter(
			(provider) => provider.enabled,
		);
		if (config.features.ai && enabledProviders.length === 0) {
			addRequiredIssue(
				context,
				["features", "ai"],
				"AI features require an enabled provider",
			);
		}

		if (config.features.aiSearch && !config.features.ai) {
			addRequiredIssue(
				context,
				["features", "aiSearch"],
				"AI search requires AI features",
			);
		}

		if (config.features.deepResearch) {
			if (!config.features.ai) {
				addRequiredIssue(
					context,
					["features", "deepResearch"],
					"Deep research requires AI features",
				);
			}
			if (!config.features.aiSearch) {
				addRequiredIssue(
					context,
					["features", "deepResearch"],
					"Deep research requires AI search",
				);
			}
			if (!enabledProviders.some((provider) => provider.largeModel)) {
				addRequiredIssue(
					context,
					["features", "deepResearch"],
					"Deep research requires an approved large model",
				);
			}
		}

		if (config.features.relatedResources && !config.search.embedder) {
			addRequiredIssue(
				context,
				["features", "relatedResources"],
				"Related resources require an embedder",
			);
		}

		if (config.features.aiSearch && !config.search.embedder) {
			addRequiredIssue(
				context,
				["features", "aiSearch"],
				"AI search requires an embedder",
			);
		}

		if (config.features.collectionNotes && !config.features.collections) {
			addRequiredIssue(
				context,
				["features", "collectionNotes"],
				"Collection notes require collections",
			);
		}

		if (config.features.countryFocus && !config.search.country) {
			addRequiredIssue(
				context,
				["features", "countryFocus"],
				"Country focus requires country search",
			);
		}

		if (config.features.authorLocation && !config.search.authorCountry) {
			addRequiredIssue(
				context,
				["features", "authorLocation"],
				"Author location requires author-country search",
			);
		}

		if (config.features.yearsDropdown && !config.filters.years.enabled) {
			addRequiredIssue(
				context,
				["features", "yearsDropdown"],
				"Years dropdown requires the years filter",
			);
		}

		if (config.features.atomFeed && !config.exports.atom) {
			addRequiredIssue(
				context,
				["features", "atomFeed"],
				"Atom feed requires the Atom export switch",
			);
		}

		if (
			config.features.downloads &&
			!config.exports.ris &&
			!config.exports.bibtex
		) {
			addRequiredIssue(
				context,
				["features", "downloads"],
				"Downloads require the RIS or BibTeX export switch",
			);
		}

		const featuredInstitution = config.filters.institution.featuredValue;
		if (
			featuredInstitution &&
			institutionNames &&
			!institutionNames.has(featuredInstitution.toLowerCase())
		) {
			addRequiredIssue(
				context,
				["filters", "institution", "featuredValue"],
				"Featured institution must match an indexed institution",
			);
		}

		if (collectionIds) {
			config.collections.forEach((collection, index) => {
				if (!collectionIds.has(collection.id)) {
					addRequiredIssue(
						context,
						["collections", index, "id"],
						"Collection ID does not exist in the active library",
					);
				}
			});
		}

		const emailEnabled =
			Boolean(config.email.contactRecipient) ||
			Boolean(config.email.takedownRecipient);
		if (emailEnabled) {
			if (!config.email.smtp.host) {
				addRequiredIssue(
					context,
					["email", "smtp", "host"],
					"Email recipients require an SMTP host",
				);
			}
			if (!config.email.smtp.from) {
				addRequiredIssue(
					context,
					["email", "smtp", "from"],
					"Email recipients require an SMTP sender",
				);
			}
		}

		validateTagSemantics(config, context);
	});
}

export const libraryConfigSchema = createLibraryConfigSchema();

const publicAiProviderSchema = z
	.object({
		provider: z.enum(PLATFORM_AI_PROVIDERS),
		enabled: z.boolean(),
		defaultModel: modelIdSchema.optional(),
		largeModel: modelIdSchema.optional(),
		smallModel: modelIdSchema.optional(),
	})
	.strict();

const publicAiSchema = z
	.object({
		providers: z.array(publicAiProviderSchema).max(5),
	})
	.strict();

const publicAuthenticationSchema = z
	.object({
		google: z
			.object({
				enabled: z.boolean(),
			})
			.strict(),
	})
	.strict();

export const publicLibraryConfigSchema = z
	.object({
		schemaVersion: z.literal(1),
		revision: revisionSchema,
		updatedAt: utcTimestampSchema,
		identity: identitySchema,
		institutions: institutionsSchema,
		theme: themeSchema,
		navigation: navigationSchema,
		footer: footerSchema,
		contact: contactSchema,
		legal: legalSchema,
		localization: localizationSchema,
		search: publicSearchSchema,
		filters: filtersSchema,
		content: contentSchema,
		citations: publicCitationsSchema,
		features: featuresSchema,
		collections: collectionsSchema,
		gapMaps: publicGapMapsSchema,
		exports: exportsSchema,
		ai: publicAiSchema,
		analytics: analyticsSchema,
		authentication: publicAuthenticationSchema,
	})
	.strict();

export type LibraryConfigInput = z.input<typeof libraryConfigSchema>;
export type LibraryServerConfig = z.output<typeof libraryConfigSchema>;
export type LibraryPublicConfig = z.output<typeof publicLibraryConfigSchema>;

export {
	colorSchema,
	emailSchema,
	hostSchema,
	idSchema,
	internalLinkSchema,
	linkSchema,
	modelIdSchema,
	publicHttpsOriginSchema,
	publicHttpsUrlSchema,
	revisionSchema,
	secretSchema,
	serviceUrlSchema,
	stableIconUrlSchema,
	stableImageUrlSchema,
	tagSchema,
	utcTimestampSchema,
};
