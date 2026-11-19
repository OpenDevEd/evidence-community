import { isSourceConnectionKey } from "@opendeved/evidence-library-core";
import postcss, { type Root } from "postcss";
import { z } from "zod";

import { openAlexConnectionConfigSchema, openAlexWorksConfigSchema } from "@/lib/source-ingestion/openalex/schema";
import { zoteroSourceSettingsSchema } from "@/lib/source-ingestion/zotero/schema";
import { hasAnyTag } from "@/lib/tags";

import {
	PLATFORM_AI_PROVIDERS,
	PLATFORM_FONT_CATALOG,
	PLATFORM_LOCALES,
	PLATFORM_PROMPT_SLOTS,
	PLATFORM_PROMPT_VARIABLES,
	PLATFORM_RULE_ACTIONS,
	PLATFORM_RULE_CONDITIONS,
	PLATFORM_SEARCH_SCOPES,
	PLATFORM_SOCIAL_PROVIDERS,
	type PlatformSearchScope,
} from "./catalogs";
import { PLATFORM_NAVBAR_ICON_IDS } from "./generated/hugeicons";
import {
	addDuplicateIssues,
	colorSchema,
	emailSchema,
	hostSchema,
	idSchema,
	internalLinkSchema,
	linkSchema,
	modelIdSchema,
	isOpenRouterModelId,
	nonEmptyStringSchema,
	plainTextSchema,
	postgresUrlSchema,
	redisUrlSchema,
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
import { policyRedirectIssues } from "@/lib/legal-links";
import { linksToStatistics } from "./pages";
import { OPEN_ACCESS_LABELS } from "@/lib/open-access";

export const MAX_LIBRARY_CONFIG_BYTES = 1024 * 1024;
const DEFAULT_FONT_WEIGHTS = [400, 500, 700] as const;
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const fundingPartnerSchema = z
	.object({
		id: idSchema,
		name: singleLineStringSchema(100),
	})
	.strict();

/**
 * Everything a library may say about its logo. Each of these changes how the
 * logo looks and nothing else. The bar decides how big the logo is and where
 * it sits, so no rule that moves or resizes anything belongs here.
 */
const ALLOWED_LOGO_STYLE_PROPERTIES = new Set([
	"background-color",
	"border",
	"border-bottom",
	"border-bottom-color",
	"border-bottom-left-radius",
	"border-bottom-right-radius",
	"border-bottom-style",
	"border-bottom-width",
	"border-color",
	"border-left",
	"border-left-color",
	"border-left-style",
	"border-left-width",
	"border-radius",
	"border-right",
	"border-right-color",
	"border-right-style",
	"border-right-width",
	"border-style",
	"border-top",
	"border-top-color",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-top-style",
	"border-top-width",
	"border-width",
	"box-shadow",
	"color",
	"filter",
]);

const ALLOWED_LOGO_STYLE_LIST = Array.from(ALLOWED_LOGO_STYLE_PROPERTIES)
	.sort()
	.join(", ");

/** The longest logo CSS a library may save. */
const MAX_LOGO_STYLE_LENGTH = 10_000;

/**
 * The largest length a logo rule may use, in pixels. A border thicker than
 * this would take over the picture behind it.
 */
const MAX_LOGO_STYLE_LENGTH_PX = 8;

/**
 * The only names a logo value may call: a colour, or a change of colour.
 *
 * Nothing that draws beyond the edges of the picture is here. There is no
 * `blur()` and no `drop-shadow()`, because both put ink outside the logo, and
 * no sum such as `calc()`, which can hide a very large number inside a value
 * that reads as if it were small.
 */
const ALLOWED_LOGO_STYLE_FUNCTIONS = new Set([
	// Colours.
	"color",
	"color-mix",
	"hsl",
	"hsla",
	"hwb",
	"lab",
	"lch",
	"light-dark",
	"oklab",
	"oklch",
	"rgb",
	"rgba",
	// Changes of colour.
	"brightness",
	"contrast",
	"grayscale",
	"hue-rotate",
	"invert",
	"opacity",
	"saturate",
	"sepia",
]);

const LOGO_STYLE_FUNCTION_PATTERN = /(-?[a-z][a-z0-9-]*)\s*\(/giu;

/** The only unit that turns a number into a distance on the screen. */
const LOGO_STYLE_LENGTH_UNIT_PATTERN = /^px$/iu;

/** Units that are an angle or a share, never a distance. */
const LOGO_STYLE_NON_LENGTH_UNIT_PATTERN = /^(%|deg|grad|rad|turn)$/iu;

/** Every number with a unit after it, such as `12px`. */
const LOGO_STYLE_LENGTH_PATTERN = /(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]+)/giu;

/** A corner radius only ever cuts inwards, so its size is the owner's business. */
function isCornerRadius(property: string) {
	return property.endsWith("radius");
}

/** The first name in a value that a logo may not call. */
function findForbiddenFunction(value: string) {
	for (const [, name] of value.matchAll(LOGO_STYLE_FUNCTION_PATTERN)) {
		if (!ALLOWED_LOGO_STYLE_FUNCTIONS.has(name.toLowerCase())) {
			return name;
		}
	}

	return null;
}

/** Splits a value on the commas that separate whole parts of it. */
function splitLogoStyleLayers(value: string) {
	const layers: string[] = [];
	let depth = 0;
	let start = 0;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === "(") depth += 1;
		if (character === ")") depth -= 1;
		if (character === "," && depth === 0) {
			layers.push(value.slice(start, index));
			start = index + 1;
		}
	}
	layers.push(value.slice(start));

	return layers;
}

/**
 * The first shadow in the value that would be drawn outside the logo. Only an
 * `inset` shadow stays within the picture, so only that one is allowed.
 */
function findOutwardShadow(property: string, value: string) {
	if (property !== "box-shadow") return null;

	for (const layer of splitLogoStyleLayers(value)) {
		if (!/\binset\b/iu.test(layer)) return layer.trim();
	}

	return null;
}

function findLogoLengthProblem(property: string, value: string) {
	// A colour such as #818cf8 reads like a number with letters after it, so
	// take colours out before looking for sizes.
	const sizes = value.replace(/#[0-9a-f]{3,8}/giu, " ");

	for (const [, amount, unit] of sizes.matchAll(LOGO_STYLE_LENGTH_PATTERN)) {
		if (LOGO_STYLE_NON_LENGTH_UNIT_PATTERN.test(unit)) continue;
		if (!LOGO_STYLE_LENGTH_UNIT_PATTERN.test(unit)) {
			return `Logo styles cannot measure "${property}" in "${unit}". Use px.`;
		}
		// A corner radius only ever cuts inwards, so its size is the owner's
		// business. Everything else has to stay small.
		if (
			!isCornerRadius(property) &&
			Math.abs(Number.parseFloat(amount)) > MAX_LOGO_STYLE_LENGTH_PX
		) {
			return `Logo styles cannot use ${amount}${unit} for "${property}". Nothing may reach more than ${MAX_LOGO_STYLE_LENGTH_PX}px outside the logo.`;
		}
	}

	return null;
}

/**
 * The first thing wrong with one rule's value, or `null` when the value only
 * changes how the logo looks and stays inside its box.
 */
function findLogoValueProblem(property: string, value: string) {
	// A backslash can spell a name a different way, such as `\75 rl(` for
	// `url(`, so no value may contain one. `//` is not CSS at all.
	if (value.includes("\\") || value.includes("//")) {
		return `Logo styles cannot use "\\" or "//" in the value of "${property}".`;
	}

	const forbidden = findForbiddenFunction(value);
	if (forbidden) {
		return `Logo styles cannot use "${forbidden.toLowerCase()}()". A logo may only be given plain colours, lengths and shapes.`;
	}

	const lengthProblem = findLogoLengthProblem(property, value);
	if (lengthProblem) return lengthProblem;

	const outward = findOutwardShadow(property, value);
	if (outward !== null) {
		return `Logo styles can only use a shadow drawn inside the logo. Write "inset" in "${outward}", or leave the shadow out.`;
	}

	return null;
}

/** What is wrong with the raw text, before any CSS reader touches it. */
function findLogoTextProblem(value: string) {
	// Everything here happens before the CSS reader sees the text. The reader
	// follows a `sourceMappingURL` comment and opens the file it names, and it
	// will work through a very long string for a long time, so neither of them
	// ever reaches it.
	if (value.length > MAX_LOGO_STYLE_LENGTH) {
		return `Logo styles must be ${MAX_LOGO_STYLE_LENGTH} characters or fewer.`;
	}
	if (/[{}<>]/u.test(value)) {
		return "Logo styles must contain CSS rules only, without braces or markup.";
	}
	if (value.includes("/*") || value.includes("*/")) {
		return "Logo styles cannot contain comments.";
	}

	return null;
}

function findLogoRuleProblem(root: Root) {
	for (const node of root.nodes) {
		if (node.type !== "decl") {
			return `Logo styles may only contain CSS rules, one per line. Allowed rules: ${ALLOWED_LOGO_STYLE_LIST}.`;
		}

		const property = node.prop.trim().toLowerCase();
		if (
			property.startsWith("--") ||
			!ALLOWED_LOGO_STYLE_PROPERTIES.has(property)
		) {
			return `Logo styles cannot set "${node.prop.trim()}". A logo may only change how it looks. Allowed rules: ${ALLOWED_LOGO_STYLE_LIST}.`;
		}

		const valueProblem = findLogoValueProblem(property, node.value);
		if (valueProblem) return valueProblem;
	}

	return null;
}

/**
 * Reads the logo CSS the way a browser does and answers with the first thing
 * wrong with it, or `null` when every line is allowed.
 *
 * A written-out list of allowed names is the only safe way to do this. A list
 * of banned names always leaves a way through, such as `flex-basis`, a custom
 * property, or the same rule behind a browser prefix.
 */
function findLogoStyleProblem(value: string) {
	if (!value.trim()) return null;

	const textProblem = findLogoTextProblem(value);
	if (textProblem) return textProblem;

	try {
		return findLogoRuleProblem(
			postcss.parse(value, { from: undefined, map: false }),
		);
	} catch {
		return `Logo styles must be a list of CSS rules, such as "border-radius: 8px;". Allowed rules: ${ALLOWED_LOGO_STYLE_LIST}.`;
	}
}

const logoStylesSchema = rawStringSchema
	.pipe(z.string().max(MAX_LOGO_STYLE_LENGTH))
	.superRefine((value, context) => {
		const problem = findLogoStyleProblem(value);
		if (!problem) return;

		context.addIssue({ code: "custom", message: problem });
	});

const identityAssetsSchema = z
	.object({
		logoDark: stableImageUrlSchema,
		logoLight: stableImageUrlSchema.optional(),
		favicon: stableIconUrlSchema,
		faviconLight: stableIconUrlSchema.optional(),
		faviconDark: stableIconUrlSchema.optional(),
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
		/** The home page's title in search results, when it should say more than the name and tagline do. */
		searchTitle: singleLineStringSchema(70).optional(),
		description: plainTextSchema(300).optional(),
		/** The name beside the logo in the header; off for a logo that already spells it. */
		showName: z.boolean().default(true),
		baseUrl: publicHttpsOriginSchema,
		// Read from settings saved before the footer's funders became the one list, and never written since. Pages
		// show each partner as a funder (`projectPublicLibraryConfig`). Openscholar moves saved partners into the
		// funders, after which this goes (openalex-count docs/evidence-library-follow-ups.md).
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
		/** Dark mode's own accent, link and tertiary; without one, dark mode uses the light colour. */
		accentDark: colorSchema.optional(),
		linkDark: colorSchema.optional(),
		collectionDark: colorSchema.optional(),
		doiDark: colorSchema.optional(),
		tertiaryDark: colorSchema.optional(),
		backgroundDark: colorSchema.default("#0f0f0f"),
		backgroundLight: colorSchema.default("#F4F2EE"),
		cardDark: colorSchema.default("#141414"),
		cardLight: colorSchema.default("#FFFFFF"),
	})
	.strict()
	.transform((colors) => {
		const accentDark = colors.accentDark ?? colors.accent;
		// A colour that follows the accent follows the dark accent; one set on its own keeps its value.
		const followAccent = (own: string | undefined, dark: string | undefined) => [own ?? colors.accent, dark ?? own ?? accentDark] as const;
		const [link, linkDark] = followAccent(colors.link, colors.linkDark);
		const [collection, collectionDark] = followAccent(colors.collection, colors.collectionDark);
		const [doi, doiDark] = followAccent(colors.doi, colors.doiDark);
		return { ...colors, link, collection, doi, accentDark, linkDark, collectionDark, doiDark, tertiaryDark: colors.tertiaryDark ?? colors.tertiary };
	});

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
		defaultMode: z.enum(["light", "dark", "system"]).default("light"),
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

		// Each mode's link against that mode's background; a dark link that is the light one is reported on the light field.
		const { link, linkDark, backgroundDark, backgroundLight } = theme.colors;
		const unreadable = new Set<"link" | "linkDark">();
		if (!hasAccessiblePaletteTone(linkDark, backgroundDark, "dark")) unreadable.add(linkDark.toLowerCase() === link.toLowerCase() ? "link" : "linkDark");
		if (!hasAccessiblePaletteTone(link, backgroundLight, "light")) unreadable.add("link");
		for (const field of unreadable) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Link palette must provide a WCAG AA tone against each background",
				path: ["colors", field],
			});
		}
	});

const platformNavbarIconSchema = z
	.enum(PLATFORM_NAVBAR_ICON_IDS)
	.meta({ id: "PlatformNavbarIconId" });

const iconReferenceSchema = z.union([
	platformNavbarIconSchema,
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
			// Room for the twenty funders and the twenty partners a community could name before the two lists became one.
			.max(40)
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
			legal.termsOfService ??
			(legal.termsMarkdown ? "/terms" : undefined),
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

/** URL params a tag filter's ID would collide with if it were ever given a param of its own. */
const RESERVED_TAG_FILTER_IDS = ["tags", "match", "collections", "topics", "sources", "type", "study", "search", "scope", "range", "institution", "country", "author", "page", "sort"];
// Patterns rather than refinements, so the generated schema carries them and OpenScholar's settings never save an ID or a
// tag the runtime refuses.
const TAG_FILTER_ID = new RegExp(`^(?!(?:${RESERVED_TAG_FILTER_IDS.join("|")})$)[a-z][a-z0-9-]{0,31}$`, "u");
/** "*" is how the address marks a filter a reader emptied, so it can't be a tag here. */
const tagFilterTagSchema = tagSchema.regex(/^(?!\s*\*\s*$)/u, "A tag filter can't use * as a tag");

/** One entry of a tag filter: a tag, or every tag starting with a prefix, which readers see without the prefix. */
const tagFilterOptionSchema = z
	.object({
		value: tagFilterTagSchema,
		prefix: z.boolean().default(false),
		/** What readers see in place of the tag; a prefix's own label is unused. */
		label: singleLineStringSchema(80).optional(),
	})
	.strict();

/** A filter readers tick tags in. Ticks in one filter match any of them; different filters narrow each other. */
const tagFilterSchema = z
	.object({
		id: z.string().regex(TAG_FILTER_ID, "A tag filter's ID is lowercase letters, digits and hyphens, and not a search option's name"),
		label: singleLineStringSchema(60),
		enabled: z.boolean().default(true),
		/** A card of its own beside the results, or a picker under More filters. */
		placement: z.enum(["card", "picker"]).default("card"),
		options: z.array(tagFilterOptionSchema).max(100).default([]),
		/** Ticked for a reader who has made no choice in this filter. They never show in the address. */
		defaults: z.array(tagFilterTagSchema).max(20).default([]),
	})
	.strict();

const filtersSchema = z
	.object({
		tagFilters: z
			.array(tagFilterSchema)
			.max(8)
			.default([])
			.superRefine((filters, context) => addDuplicateIssues(filters, context, (filter) => filter.id)),
		/** Whether ticked collections show records in any of them or in all of them, and whether readers can switch. */
		collectionsMatch: z
			.object({
				default: z.enum(["all", "any"]).default("all"),
				readerSwitch: z.boolean().default(false),
			})
			.strict()
			.prefault({}),
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
		/** Which of the library's sources found a record. Offered once the library has two sources or more. */
		sources: z
			.object({
				enabled: z.boolean().default(true),
				label: singleLineStringSchema(60).default("sources"),
			})
			.strict()
			.prefault({}),
		collectionsExpanded: z.boolean().default(true),
		/**
		 * Where a study type the AI is uncertain of shows: marked uncertain beside its type, or apart as an Uncertain type
		 * of its own in the Study types filter and on the record.
		 */
		uncertainStudyTypes: z.enum(["marked", "separate"]).default("marked"),
		years: z
			.object({
				enabled: z.boolean().default(true),
			})
			.strict()
			.prefault({}),
		/** The Study types card beside the results, and filtering by it. Records keep their type labels either way. */
		studyTypes: z
			.object({
				enabled: z.boolean().default(true),
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
		// Which records say whether they are open access: `open` labels the open ones, `both` the closed ones too.
		openAccessLabel: z.enum(OPEN_ACCESS_LABELS).default("open"),
	})
	.strict()
	.prefault({});

const citationsSchema = z
	.strictObject({
		enabled: z.boolean().default(true),
		showUrl: z.boolean().default(false),
	})
	.prefault({});

// Citations are generated locally; availability is a library setting.
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
		/** Readers sign in with OpenScholar to bookmark records and keep collections. */
		readerAccounts: z.boolean().default(false),
		navbarSearch: z.boolean().default(true),
		ai: z.boolean().default(false),
		aiSearch: z.boolean().default(false),
		deepResearch: z.boolean().default(false),
		relatedResources: z.boolean().default(false),
		collections: z.boolean().default(true),
		collectionNotes: z.boolean().default(false),
		countryFocus: z.boolean().default(false),
		authorFilter: z.boolean().default(true),
		yearsDropdown: z.boolean().default(false),
		downloads: z.boolean().default(false),
		atomFeed: z.boolean().default(false),
		// The library's own front page at `/`. While it is off, `/` sends visitors to the listing.
		homePage: z.boolean().default(false),
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
		environment: z.enum(["test", "production"]).default("production"),
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
		environment: z.enum(["sandbox", "production"]).default("production"),
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
		// Who gets the files of a record made here, unless its editor chooses otherwise: as its licence allows
		// (`fileAccessOf`), so readers-only under an open licence is anyone, and anyone under a closed one is private.
		defaultFileAccess: z.enum(["open", "private", "readers"]).default("open"),
	})
	.strict()
	.prefault({})
	.superRefine((zenodo, context) => {
		if (zenodo.enabled && !zenodo.token) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Enabled Zenodo publication requires a token",
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
		if (publication.crossref.enabled) {
			if (!publication.zenodo.enabled) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Crossref publication requires Zenodo archiving",
					path: ["zenodo", "enabled"],
				});
			} else if (publication.crossref.environment === "production" && publication.zenodo.environment === "sandbox") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Production Crossref requires production Zenodo",
					path: ["zenodo", "environment"],
				});
			}
		}
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

/** The search engines a library can search (OpenDevEd/new-el#722). */
export type SearchEngineName = "elasticsearch" | "meilisearch";

/** Where one engine keeps the library's search, and the login or key that reaches it. */
function searchConnectionSchema(index: RegExp) {
	return z
		.object({
			host: serviceUrlSchema,
			key: secretSchema(1, 512),
			index: z.string().trim().min(1).max(128).regex(index),
		})
		.strict();
}

const meilisearchConnectionSchema = searchConnectionSchema(/^[A-Za-z0-9_-]+$/u);
/** Elasticsearch names an index in lowercase, not starting with `_`, `-` or `+`. */
const elasticsearchConnectionSchema = searchConnectionSchema(/^[a-z0-9][a-z0-9_-]*$/u);

/**
 * The engine the library chooses, which needs its connection, and the other engine's connection while a switch to
 * the chosen one is built. The search worker builds the chosen engine's index; readers keep the one whose index is
 * complete until it is (docs/search-indexing.md, "Switching engines").
 */
const chosenEngineSchema = z.discriminatedUnion("engine", [
	z
		.object({
			engine: z.literal("elasticsearch"),
			elasticsearch: elasticsearchConnectionSchema,
			meilisearch: meilisearchConnectionSchema.optional(),
			/** The index is the library: records live only there, and the database stays empty (docs/search-indexing.md). */
			indexOnly: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			engine: z.literal("meilisearch"),
			elasticsearch: elasticsearchConnectionSchema.optional(),
			meilisearch: meilisearchConnectionSchema,
		})
		.strict(),
]);

/**
 * Before libraries chose an engine, `services.search` was the Meilisearch connection alone. OpenScholar takes this
 * schema only from merged new-el, so it keeps writing that shape until then; it reads as Meilisearch until OpenScholar
 * writes `engine` for every library, and is dropped after (widen, migrate, narrow).
 */
const meilisearchOnlySchema = meilisearchConnectionSchema.transform(
	(meilisearch): z.output<typeof chosenEngineSchema> => ({ engine: "meilisearch", meilisearch }),
);

const searchServiceSchema = z.union([chosenEngineSchema, meilisearchOnlySchema]);

const servicesSchema = z
	.object({
		redis: z
			.object({
				url: redisUrlSchema,
			})
			.strict()
			.optional(),
		database: z
			.object({
				url: postgresUrlSchema,
			})
			.strict(),
		search: searchServiceSchema,
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
		// Asks OpenAlex whether a record from another source is open access, by its DOI.
		openAlex: z
			.object({
				apiKey: secretSchema(1, 512),
			})
			.strict()
			.optional(),
		publication: publicationServicesSchema,
	})
	.strict();

/** How close a record is to its source's subject, lowest first, as screening grades it. */
export const SCREENING_GRADES = ["not-about", "passing", "touches", "about"] as const;
export type ScreeningGrade = (typeof SCREENING_GRADES)[number];

/**
 * A source's screening: whether Jev reads the records it brings in, the subject it grades them against, and the
 * grades that keep a record out of the library. A screening source needs a subject.
 */
const sourceScreeningSchema = z
	.object({
		enabled: z.boolean().default(false),
		subject: z.string().trim().max(1_000).default(""),
		keptOut: z
			.array(z.enum(SCREENING_GRADES))
			.max(SCREENING_GRADES.length)
			.default(["not-about"])
			.refine((grades) => new Set(grades).size === grades.length, "Each grade can be kept out once"),
	})
	.strict()
	.refine((screening) => !screening.enabled || screening.subject.length > 0, {
		message: "Write what this source's records should be about before screening them",
		path: ["subject"],
	});

const zoteroSourceConfigurationSchema = z
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
		settings: zoteroSourceSettingsSchema.prefault({}),
		screening: sourceScreeningSchema.prefault({}),
	})
	.strict();

// Sources of OpenAlex works read OpenAlex with `apiKey` and never write back.
const openAlexWorksSourceSchema = zoteroSourceConfigurationSchema.omit({ groupId: true }).extend({
	writebackEnabled: z.literal(false).default(false),
});

const sourceConfigurationSchema = z.discriminatedUnion("provider", [
	zoteroSourceConfigurationSchema,
	openAlexWorksSourceSchema.extend({
		provider: z.literal("openalex"),
		settings: openAlexConnectionConfigSchema,
	}),
	// One OpenScholar collection, read live from OpenScholar; its items resolve through OpenAlex.
	openAlexWorksSourceSchema.extend({
		provider: z.literal("openscholar"),
		collectionId: z.string().trim().regex(/^[0-9a-z]+$/u).max(128),
		settings: openAlexWorksConfigSchema,
	}),
]);

/** What makes two sources the same: a Zotero group or an OpenScholar collection. OpenAlex searches may repeat. */
function sourceScope(source: z.infer<typeof sourceConfigurationSchema>) {
	if (source.provider === "zotero") return `zotero:${source.groupId}`;
	if (source.provider === "openscholar") return `openscholar:${source.collectionId}`;
	return `openalex:${source.key}`;
}

const sourcesSchema = z
	.array(sourceConfigurationSchema)
	.max(100)
	.default([])
	.superRefine((sources, context) => {
		addDuplicateIssues(sources, context, (source) => source.key);
		addDuplicateIssues(sources, context, sourceScope);
	});

type AIProviderConfiguration = {
	provider: (typeof PLATFORM_AI_PROVIDERS)[number];
	enabled: boolean;
	apiKey?: string;
	models: string[];
	defaultModel?: string;
};

function addAIProviderRequirementIssues(
	provider: AIProviderConfiguration,
	context: z.RefinementCtx,
) {
	if (provider.enabled && !provider.apiKey) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Enabled AI providers require an API key",
			path: ["apiKey"],
		});
	}

	if (provider.enabled && provider.models.length === 0) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Enabled AI providers require at least one model",
			path: ["models"],
		});
	}
}

function addAIProviderModelIssues(
	provider: AIProviderConfiguration,
	context: z.RefinementCtx,
) {
	const seenModels = new Set<string>();

	for (const [index, model] of provider.models.entries()) {
		const validModel =
			provider.provider !== "openrouter" || isOpenRouterModelId(model);
		if (!validModel) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `${model} is not a valid ${provider.provider} model identifier`,
				path: ["models", index],
			});
		}
		if (seenModels.has(model)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `${model} appears more than once`,
				path: ["models", index],
			});
		}
		seenModels.add(model);
	}
}

function addAIProviderDefaultModelIssues(
	provider: AIProviderConfiguration,
	context: z.RefinementCtx,
) {
	if (provider.enabled && !provider.defaultModel) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Enabled AI providers require a default model",
			path: ["defaultModel"],
		});
		return;
	}

	if (
		provider.defaultModel &&
		!provider.models.includes(provider.defaultModel)
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "The default model must be in the configured model list",
			path: ["defaultModel"],
		});
	}
}

const aiModelMetadataSchema = z
	.record(
		modelIdSchema,
		z
			.object({
				name: singleLineStringSchema(256),
				company: singleLineStringSchema(128),
			})
			.strict(),
	)
	.refine((metadata) => Object.keys(metadata).length <= 20, {
		message: "At most 20 model descriptions are allowed",
	})
	.optional();

const aiProviderSchema = z
	.object({
		provider: z.enum(PLATFORM_AI_PROVIDERS),
		enabled: z.boolean().default(false),
		apiKey: secretSchema(1, 512).optional(),
		models: z.array(modelIdSchema).max(20).default([]),
		modelMetadata: aiModelMetadataSchema,
		defaultModel: modelIdSchema.optional(),
	})
	.strict()
	.superRefine((provider, context) => {
		addAIProviderRequirementIssues(provider, context);
		addAIProviderModelIssues(provider, context);
		addAIProviderDefaultModelIssues(provider, context);
		for (const id of Object.keys(provider.modelMetadata ?? {})) {
			if (!provider.models.includes(id))
				context.addIssue({
					code: "custom",
					path: ["modelMetadata", id],
					message:
						"Model descriptions must belong to configured models",
				});
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
		openScholar: z
			.object({
				convexSiteUrl: publicHttpsOriginSchema,
				libraryId: singleLineStringSchema(128).refine(
					(value) => /^[a-z0-9]+$/u.test(value),
					"OpenScholar library ID must contain lowercase letters and numbers only",
				),
				/** OpenScholar's page for this library, where its configuration lives. */
				libraryUrl: publicHttpsUrlSchema,
				/** The account page of the Clerk instance readers and admins sign in with. */
				accountUrl: publicHttpsUrlSchema,
				machineCredential: secretSchema(47, 47).refine(
					(value) => /^els_[A-Za-z0-9_-]{43}$/u.test(value),
					"OpenScholar machine credential must use the els_ format",
				),
				/** This library's own Clerk OAuth application. */
				oauth: z
					.object({
						issuer: publicHttpsOriginSchema,
						clientId: singleLineStringSchema(255),
						clientSecret: secretSchema(16, 512),
					})
					.strict(),
			})
			.strict(),
		/** Signs this library's session cookies and encrypts the OAuth tokens it stores. */
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

const digestTimeFields = {
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "Use HH:mm").default("09:00"),
	timezone: z.string().min(1).max(100).refine(value => {
		try { new Intl.DateTimeFormat("en", {timeZone: value}); return true; }
		catch { return false; }
	}, "Use a valid timezone").default("UTC"),
};

const notificationsSchema = z.object({
	enabled: z.boolean().default(false),
	// What a digest covers: publications dated in its period, or publications added to the library in it.
	digestCovers: z.enum(["published", "added"]).default("published"),
	// When digests were paused. No scheduled digest is prepared while it is set, and the first one after it covers
	// everything since the last digest.
	pausedSince: utcTimestampSchema.nullable().default(null),
	// A written digest waits in the admin until an Editor or Owner publishes it. Off, it goes out as AI wrote it.
	approval: z.boolean().default(false),
	// Readers are told who checked each digest, or that AI wrote it and nobody did.
	attribution: z.boolean().default(false),
	schedule: z.discriminatedUnion("frequency", [
		z.object({frequency: z.literal("weekly"), weekday: z.number().int().min(0).max(6), ...digestTimeFields}).strict(),
		z.object({frequency: z.literal("monthly"), dayOfMonth: z.number().int().min(1).max(31), ...digestTimeFields}).strict(),
	]).prefault({frequency: "weekly", weekday: 1}),
}).strict().prefault({});

/** Reads an index-only library can't answer: they find its records in the database, which holds none. */
const FEATURES_NEEDING_THE_DATABASE = [
	"readerAccounts",
	"collections",
	"collectionNotes",
	"downloads",
	"atomFeed",
	"homePage",
	"aiSearch",
	"deepResearch",
	"relatedResources",
] as const;

function refuseWhatNeedsRecordsInTheDatabase(
	config: {
		services: { search: { engine: string; indexOnly?: boolean } };
		sources: readonly unknown[];
		collections: readonly unknown[];
		features: Record<(typeof FEATURES_NEEDING_THE_DATABASE)[number], boolean>;
		notifications: { enabled: boolean };
		generation: { sitemap: boolean; indexNow: boolean };
	} & Parameters<typeof linksToStatistics>[0],
	context: z.RefinementCtx,
) {
	if (config.services.search.indexOnly !== true) return;
	const refuse = (path: (string | number)[]) =>
		addRequiredIssue(context, path, "An index-only library's database holds no records, so this must be off");
	// Each setting that reads records from the database, and whether it is on.
	const settings: [path: (string | number)[], on: boolean][] = [
		[["sources"], config.sources.length > 0],
		[["collections"], config.collections.length > 0],
		...FEATURES_NEEDING_THE_DATABASE.map((feature): [(string | number)[], boolean] => [["features", feature], config.features[feature]]),
		[["notifications", "enabled"], config.notifications.enabled],
		[["generation", "sitemap"], config.generation.sitemap],
		[["generation", "indexNow"], config.generation.indexNow],
		[["navigation", "links"], linksToStatistics(config)],
	];
	for (const [path, on] of settings) if (on) refuse(path);
}

const generationSchema = z
	.object({
		sitemap: z.boolean().default(true),
		redirects: z.boolean().default(true),
		/**
		 * Tell Bing and the other IndexNow search engines when a record is published, changed or taken down. Openscholar
		 * turns it on for communities that are live: a test community would announce itself to search engines.
		 */
		indexNow: z.boolean().default(false),
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

/**
 * What a step of the curation timeline shows: arrival, check and publication are dated from the followed publication's
 * review; search, sync, duplicates and fulltext count from the library's OpenAlex searches and records.
 */
const HOME_STEP_TYPES = ["arrival", "check", "publication", "search", "sync", "duplicates", "fulltext", "text"] as const;

/** A person in OpenScholar, as the platform fills them in when the library is published. */
const homePersonSchema = z
	.object({
		/** Their OpenScholar account, which reviews record as `resolvedBy`. */
		id: singleLineStringSchema(64),
		name: singleLineStringSchema(120),
		photo: publicHttpsUrlSchema.optional(),
	})
	.strict();

/**
 * The home page's answers, written in OpenScholar's Home card. Longer answers are Markdown limited to bold, italic,
 * links and bulleted lists; a blank answer hides its part. Without this section the page shows only what is true of
 * every library.
 */
const homeSchema = z
	.object({
		intro: nonEmptyStringSchema(600).optional(),
		curation: z
			.object({
				text: nonEmptyStringSchema(400).optional(),
				steps: z
					.array(
						z
							.object({
								type: z.enum(HOME_STEP_TYPES),
								/** Blank on a typed step: the page names it after its type. */
								title: singleLineStringSchema(60).optional(),
								text: nonEmptyStringSchema(240).optional(),
								/** A check step shows this person instead of whoever approved the followed publication. */
								editor: singleLineStringSchema(64).optional(),
								/** The icon on the step's node; a typed step without one shows its type's own. */
								icon: platformNavbarIconSchema.optional(),
								/** A text step's own figure, written by the owner: the number and what it counts. */
								figure: z.object({ value: singleLineStringSchema(16), label: singleLineStringSchema(60) }).strict().optional(),
							})
							.strict()
							.refine((step) => step.type !== "text" || step.title, {
								message: "A text-only step needs a title",
								path: ["title"],
							})
							.refine((step) => step.type === "text" || !step.figure, {
								message: "Only a text step carries its own figure; the others count theirs",
								path: ["figure"],
							}),
					)
					.max(5)
					.default([]),
			})
			.strict()
			.prefault({}),
		team: nonEmptyStringSchema(300).optional(),
		/** The people shown in the team band, in order. */
		people: z
			.array(
				homePersonSchema
					.extend({
						title: singleLineStringSchema(60).optional(),
						location: singleLineStringSchema(60).optional(),
					})
					.strict(),
			)
			.max(24)
			.default([]),
		/** Every owner and editor, so a review can be credited to the person who approved it. Never sent to browsers. */
		directory: z.array(homePersonSchema).max(500).default([]),
		/** Example questions for the Ask box, slot by slot; a blank slot uses the question made from the library's own topics. */
		questions: z.array(plainTextSchema(120)).max(3).default([]),
		/** The publication the curation timeline follows; without one, the latest an editor published. */
		followed: singleLineStringSchema(64).optional(),
		involvement: z
			.object({
				suggestions: z.boolean().default(true),
				editors: z.boolean().default(false),
			})
			.strict()
			.prefault({}),
		extra: z
			.object({
				title: singleLineStringSchema(60).optional(),
				text: nonEmptyStringSchema(1200),
			})
			.strict()
			.optional(),
		headings: z
			.object({
				curation: singleLineStringSchema(60).optional(),
				team: singleLineStringSchema(60).optional(),
				involvement: singleLineStringSchema(60).optional(),
			})
			.strict()
			.prefault({}),
	})
	.strict();

export type LibraryHomeConfig = z.output<typeof homeSchema>;

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
		topics: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
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
	notifications: notificationsSchema,
	generation: generationSchema,
	processing: processingSchema,
	home: homeSchema.optional(),
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

	const publishTagLists: { tags: readonly string[]; path: (string | number)[] }[] = [
		{ tags: config.content.tags.publish, path: ["content", "tags", "publish"] },
		...config.sources.flatMap((source, index) =>
			source.provider === "zotero" && source.settings.pdfPublishing
				? [{ tags: source.settings.pdfPublishing.tags, path: ["sources", index, "settings", "pdfPublishing", "tags"] }]
				: [],
		),
	];
	for (const { tags, path } of publishTagLists) {
		for (const [index, tag] of tags.entries()) {
			// Tags are matched without case, so a publish tag differing from a hidden one only by case is the same tag.
			if (hasAnyTag([tag], [...config.content.tags.hidden, ...config.content.tags.internal])) {
				addRequiredIssue(
					context,
					[...path, index],
					"Publish tags cannot also be hidden or internal",
				);
			}
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
		for (const { field, message } of policyRedirectIssues(config)) {
			addRequiredIssue(context, ["legal", field], message);
		}
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
		if ((config.features.ai || config.notifications.enabled) && !config.services.redis) {
			addRequiredIssue(
				context,
				["services", "redis"],
				"AI and email subscriptions require the private Redis service",
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

		refuseWhatNeedsRecordsInTheDatabase(config, context);

		const emailEnabled =
			Boolean(config.email.contactRecipient) ||
			Boolean(config.email.takedownRecipient) || config.notifications.enabled;
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
	}).transform(withSourcePdfPublishing);
}

/**
 * Gives each Zotero source its own PDF rule. A configuration saved before sources had one keeps the library's publish
 * tags for it, so nothing published changes until OpenScholar saves the rule on every source (EL-30, then removed).
 */
function withSourcePdfPublishing<T extends z.output<ReturnType<typeof baseServerConfigSchema>>>(config: T) {
	return {
		...config,
		sources: config.sources.map((source) =>
			source.provider === "zotero" && !source.settings.pdfPublishing
				? { ...source, settings: { ...source.settings, pdfPublishing: { mode: "tagged" as const, tags: [...config.content.tags.publish] } } }
				: source,
		),
	};
}

export const libraryConfigSchema = createLibraryConfigSchema();

const publicAiProviderSchema = z
	.object({
		provider: z.enum(PLATFORM_AI_PROVIDERS),
		enabled: z.boolean(),
		models: z.array(modelIdSchema).max(20),
		modelMetadata: aiModelMetadataSchema,
		defaultModel: modelIdSchema.optional(),
	})
	.strict();

const publicAiSchema = z
	.object({
		providers: z.array(publicAiProviderSchema).max(5),
	})
	.strict();

const publicAuthenticationSchema = z
	.object({
		openScholar: z.object({
			accountUrl: publicHttpsUrlSchema,
			/** Its ID in OpenScholar, which the link to apply to join it names. */
			libraryId: z.string().regex(/^[a-z0-9]+$/u).max(128),
			/** The cookie a community on OpenScholar's site follows its session by; null where there is none to follow. */
			sessionCookie: z.string().regex(/^__client_uat_[\w-]{8}$/u).nullable(),
			/** The OpenScholar this library belongs to, which every link to OpenScholar is built on. */
			siteUrl: publicHttpsOriginSchema,
		}).strict(),
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
		/** The results page numbers reach, which depends on the search engines the library has connections to. */
		resultLimit: z.number().int().positive(),
		filters: filtersSchema,
		topics: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
		content: contentSchema,
		citations: publicCitationsSchema,
		features: featuresSchema,
		collections: collectionsSchema,
		gapMaps: publicGapMapsSchema,
		exports: exportsSchema,
		ai: publicAiSchema,
		analytics: analyticsSchema,
		notifications: notificationsSchema,
		authentication: publicAuthenticationSchema,
		/** Each Zotero source's publish tags: they make its records' notes and links public. */
		sourcePublishTags: z.record(z.string(), z.array(tagSchema).max(10)),
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
