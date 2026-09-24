import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import {
	FundingPartners,
	LibraryLogo,
} from "@/components/library/LibraryIdentity";
import { LibraryLogoStyles } from "@/components/library/LibraryLogoStyles";
import {
	buildLibraryLogoCss,
	buildLibraryMetadata,
} from "@/config/library-config/identity";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { buildSiteUrl } from "@/lib/site-url";
import {
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

const minimalConfig = projectPublicLibraryConfig(
	libraryConfigSchema.parse(minimalLibraryConfig),
);
const maximalConfig = projectPublicLibraryConfig(
	libraryConfigSchema.parse(maximalLibraryConfig),
);

function renderIdentity(
	config: typeof minimalConfig | typeof maximalConfig,
) {
	return renderToStaticMarkup(
		<NextIntlClientProvider
			locale="en-GB"
			messages={{
				ui: {
					fundingPartner: "Funding partner",
					logoAlt: "Logo for {company} in {theme} mode",
				},
			}}
		>
			<LibraryConfigProvider config={config}>
				<LibraryLogo place="header" />
				<FundingPartners />
			</LibraryConfigProvider>
		</NextIntlClientProvider>,
	);
}

describe("runtime library identity", () => {
	it.each([
		{
			config: minimalConfig,
			expected: {
				name: "Minimal Evidence Library",
				shortName: "Minimal Evidence Library",
				description: "Minimal Evidence Library",
				baseUrl: "https://minimal.example.org",
				favicon:
					"https://assets.example.org/minimal/favicon.ico",
				icons: [
					"https://assets.example.org/minimal/favicon.ico",
				],
			},
		},
		{
			config: maximalConfig,
			expected: {
				name: "Maximal Evidence Library",
				shortName: "Maximal Library",
				description:
					"The Maximal Evidence Library collects research about education in low- and middle-income countries.",
				baseUrl: "https://maximal.example.org",
				favicon:
					"https://assets.example.org/maximal/favicon.png",
				icons: [
					"https://assets.example.org/maximal/favicon.png",
					"https://assets.example.org/maximal/icon.svg",
					"https://assets.example.org/maximal/icon.ico",
					{
						url: "https://assets.example.org/maximal/favicon-light.svg",
						media: "(prefers-color-scheme: light)",
					},
					{
						url: "https://assets.example.org/maximal/favicon-dark.svg",
						media: "(prefers-color-scheme: dark)",
					},
				],
			},
		},
	])(
		"builds metadata for $expected.name from the active revision",
		({ config, expected }) => {
			const metadata = buildLibraryMetadata(config.identity);

			expect(metadata.title).toBe(expected.name);
			expect(metadata.description).toBe(expected.description);
			expect(metadata.applicationName).toBe(expected.shortName);
			expect(metadata.metadataBase).toEqual(
				new URL(expected.baseUrl),
			);
			expect(metadata.alternates).toBeUndefined();
			expect(metadata.icons).toEqual({
				icon: expected.icons,
				shortcut: expected.favicon,
			});
			expect(
				buildSiteUrl("/lib", config.identity.baseUrl),
			).toBe(
				`${expected.baseUrl}/lib`,
			);
		},
	);

	it("describes the library by its tagline when it has no description", () => {
		const identity = {
			...minimalConfig.identity,
			description: undefined,
			tagline: "Research on education technology",
		};

		expect(buildLibraryMetadata(identity).description).toBe(
			"Research on education technology",
		);
	});

	it("renders different configured logo URLs and names from the same component", () => {
		const minimalMarkup = renderIdentity(minimalConfig);
		const maximalMarkup = renderIdentity(maximalConfig);

		expect(minimalMarkup).toContain(
			"https://assets.example.org/minimal/logo.svg",
		);
		expect(minimalMarkup).toContain(
			"Logo for Minimal Evidence Library in light mode",
		);
		// A PNG or WebP logo reaches the optimizer through /brand; an SVG loads from its own address.
		expect(maximalMarkup).toContain(
			encodeURIComponent(
				`/brand/${encodeURIComponent(maximalConfig.revision)}/logo-light.webp`,
			),
		);
		expect(maximalMarkup).toContain(
			"https://assets.example.org/maximal/logo-dark.svg",
		);
		expect(maximalMarkup).toContain(
			"Logo for Maximal Evidence Library in dark mode",
		);
	});

	it("uses the library name for descriptions and no share image when none is set", () => {
		const metadata = buildLibraryMetadata(minimalConfig.identity);

		expect(metadata.description).toBe("Minimal Evidence Library");
		expect(metadata.openGraph).toEqual({
			title: "Minimal Evidence Library",
			description: "Minimal Evidence Library",
			siteName: "Minimal Evidence Library",
			images: undefined,
		});
		expect(metadata.twitter).toEqual({
			card: "summary",
			title: "Minimal Evidence Library",
			description: "Minimal Evidence Library",
			images: undefined,
		});
	});

	it("uses the configured description and share image for page and social previews", () => {
		const identity = {
			...maximalConfig.identity,
			description: "Evidence about education, searchable and citable.",
			assets: {
				...maximalConfig.identity.assets,
				shareImage: "https://assets.example.org/maximal/share.png",
			},
		};
		const metadata = buildLibraryMetadata(identity);

		expect(metadata.description).toBe(
			"Evidence about education, searchable and citable.",
		);
		expect(metadata.openGraph).toEqual({
			title: "Maximal Evidence Library",
			description: "Evidence about education, searchable and citable.",
			siteName: "Maximal Evidence Library",
			images: ["https://assets.example.org/maximal/share.png"],
		});
		expect(metadata.twitter).toEqual({
			card: "summary_large_image",
			title: "Maximal Evidence Library",
			description: "Evidence about education, searchable and citable.",
			images: ["https://assets.example.org/maximal/share.png"],
		});
	});

	it("deduplicates the favicon while keeping it first", () => {
		const identity = {
			...maximalConfig.identity,
			assets: {
				...maximalConfig.identity.assets,
				icons: [
					maximalConfig.identity.assets.favicon,
					...maximalConfig.identity.assets.icons,
				],
			},
		};

		expect(buildLibraryMetadata(identity).icons).toEqual({
			icon: [
				"https://assets.example.org/maximal/favicon.png",
				"https://assets.example.org/maximal/icon.svg",
				"https://assets.example.org/maximal/icon.ico",
				{
					url: "https://assets.example.org/maximal/favicon-light.svg",
					media: "(prefers-color-scheme: light)",
				},
				{
					url: "https://assets.example.org/maximal/favicon-dark.svg",
					media: "(prefers-color-scheme: dark)",
				},
			],
			shortcut:
				"https://assets.example.org/maximal/favicon.png",
		});
	});

	it("renders funding partners in manifest order", () => {
		const markup = renderIdentity(maximalConfig);

		expect(markup.indexOf("Partner One")).toBeLessThan(
			markup.indexOf("Partner Two"),
		);
		expect(renderIdentity(minimalConfig)).not.toContain(
			'aria-label="Funding partner"',
		);
	});

	it("emits the configured raw logo CSS against the shared logo selector", () => {
		expect(buildLibraryLogoCss(minimalConfig.identity)).toBeNull();
		expect(buildLibraryLogoCss(maximalConfig.identity)).toBe(
			"[data-library-logo] {\nborder-radius: 8px;\nfilter: saturate(1.1);\n}",
		);
	});

	it.each([
		"border-radius: 9999px;\nborder: 3px solid #818cf8;\nfilter: saturate(1.1);",
		// Capital letters, loose spacing, a missing last semicolon and
		// "!important" are all ordinary CSS and must still be accepted.
		"  BORDER-RADIUS :  8px !important ;\n\tBox-Shadow: inset 0 1px 2px rgb(0 0 0 / 0.2)  ",
		"background-color: #fff; color: #111; border-top-left-radius: 4px;",
		// A corner radius only ever cuts inwards, so it has no size limit.
		"border-radius: 50%;",
		"box-shadow: inset 0 0 4px rgb(0 0 0 / 0.3);",
		// A shadow drawn inside the logo may name its colour any way it likes.
		"box-shadow: inset 0 0 4px color-mix(in oklab, currentColor 30%, transparent);",
		"filter: saturate(110%) brightness(1.05);",
		// A colour may be written any way CSS allows. The angle and the
		// percentages inside it are not sizes.
		"color: hsl(120deg 100% 50%);",
		"background-color: oklch(0.7 0.1 200);",
		"border-color: color-mix(in srgb, #fff 40%, #000);",
		"color: light-dark(#111, #eee);",
		"filter: hue-rotate(90deg) opacity(50%);",
	])("keeps logo CSS that only changes how the logo looks: %s", (logoStyles) => {
		const input = structuredClone(maximalLibraryConfig);
		input.identity.assets.logoStyles = logoStyles;

		expect(libraryConfigSchema.safeParse(input).success).toBe(true);
	});

	it("puts the configured logo CSS on the page unchanged", () => {
		const logoStyles =
			"box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.2);\nfilter: saturate(1.1);";
		const identity = {
			...maximalConfig.identity,
			assets: { ...maximalConfig.identity.assets, logoStyles },
		};

		expect(
			renderToStaticMarkup(<LibraryLogoStyles identity={identity} />),
		).toContain(logoStyles);
	});

	it.each([
		"} nav { display: none;",
		"</style><script>alert(1)</script>",
		"not a CSS declaration",
		"x".repeat(10_001),
		// Size and place belong to the bar. These used to let a library push
		// its logo straight out of the header.
		"height: 150px;",
		"width: 20rem;",
		"max-height: 200px;",
		"MIN-WIDTH: 30rem;",
		"border-radius: 4px; padding: 2rem;",
		"margin-top: -40px;",
		"transform: scale(3);",
		"position: absolute; top: -20px;",
		"display: none;",
		"aspect-ratio: 1 / 4;",
		// Anything outside the written-out list is refused, however it is
		// spelled: layout rules with other names, a browser prefix, a custom
		// property, an at-rule, or a comment.
		"flex: 1 1 40rem;",
		"flex-basis: 30rem;",
		"align-self: stretch;",
		"offset: path('M 0 0 L 200 0') 100%;",
		"zoom: 4;",
		"-webkit-transform: scale(3);",
		"-moz-box-sizing: content-box;",
		"--logo-height: 200px;",
		"@media (min-width: 1px) { color: red; }",
		"@import url('https://example.org/theme.css');",
		"/* just a comment */",
		"background-image: url('https://assets.example.org/logo.png');",
		"content: 'x';",
		// A comment can carry a source-map address, which asks the CSS reader
		// to open a file of the attacker's choosing.
		"color: red; /*# sourceMappingURL=../../../../etc/passwd.map */",
		"/*# sourceMappingURL=https://evil.example/a.map */",
		"color: /* sneaky */ red;",
		// Nothing may reach outside the page for a picture or a value.
		"filter: url('https://evil.example/f.svg#x');",
		"filter: src('https://evil.example/f.svg');",
		"background-color: image('a.png');",
		"background-color: element(#other);",
		"color: var(--anything);",
		"color: env(safe-area-inset-top);",
		"color: attr(data-x);",
		"color: expression(alert(1));",
		"filter: \\75 rl('https://evil.example/f.svg');",
		// Nothing may paint far outside the logo's own box.
		"border-width: 40px;",
		"border: 30px solid red;",
		"border-left-width: 12px;",
		"box-shadow: 0 0 4px 60px red;",
		"box-shadow: 200px 0 0 red;",
		"box-shadow: 0 0 1em #000;",
		"filter: blur(80px);",
		"filter: drop-shadow(0 0 100px black);",
		"border-width: 2rem;",
		"border-width: 2vw;",
		// Sums hide their real size, so no sum of any kind is allowed.
		"filter: blur(calc(8px + 8px));",
		"border-width: calc(2px * 20);",
		"color: min(1px, 2px);",
		"border-radius: clamp(1px, 2px, 3px);",
		"box-shadow: 0 0 max(4px, 40px) #000;",
		// Nothing may be drawn outside the logo, however small it is.
		"box-shadow: 0 1px 2px #000;",
		"box-shadow: inset 0 0 4px #000, 0 1px 2px #000;",
		"filter: drop-shadow(0 1px 1px #000);",
		"filter: blur(2px);",
		// One unit, so there is nothing to convert and nothing to get wrong.
		"border-radius: 0.5rem;",
		"border-width: 0.25em;",
		// Not CSS at all.
		"color: red // blue;",
	])("rejects unconfined logo CSS: %s", (logoStyles) => {
		const input = structuredClone(maximalLibraryConfig);
		input.identity.assets.logoStyles = logoStyles;

		expect(libraryConfigSchema.safeParse(input).success).toBe(false);
	});
});
