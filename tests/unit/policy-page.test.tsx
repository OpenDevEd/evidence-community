// @vitest-environment jsdom
import type { ComponentProps } from "react";
import messages from "@/messages/en-GB.json";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		throw new Error(`redirect:${url}`);
	},
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));
vi.mock("next/cache", () => ({
	cacheLife: vi.fn(),
	cacheTag: vi.fn(),
}));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	redirect: ({ href, locale }: { href: string; locale: string }) => {
		throw new Error(`redirect:${locale}:${href}`);
	},
}));

import PolicyPage from "@/components/pages/PolicyPage";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	loadPolicyDocument,
	loadPolicyPageDocument,
} from "@/lib/policy-documents";
import {
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

function Policy(props: ComponentProps<typeof PolicyPage>) {
	return (
		<NextIntlClientProvider locale="en-GB" messages={messages}>
			<PolicyPage {...props} />
		</NextIntlClientProvider>
	);
}

const withManifestText = libraryConfigSchema.parse(maximalLibraryConfig);
const withBakedText = libraryConfigSchema.parse(minimalLibraryConfig);

describe("policy documents", () => {
	it.each([
		["privacy", "privacyPolicy"],
		["cookiePolicy", "cookiePolicy"],
		["terms", "termsOfService"],
	] as const)(
		"redirects %s to the configured policy",
		async (kind, field) => {
			const config = libraryConfigSchema.parse(minimalLibraryConfig);
			config.legal[field] = "https://policies.example.org/library";
			await expect(loadPolicyDocument(config, kind)).resolves.toBeNull();
			await expect(loadPolicyPageDocument(config, kind)).rejects.toThrow(
				"redirect:https://policies.example.org/library",
			);
		},
	);

	it.each([
		"/cookie-policy?ref=footer#cookies",
		"https://minimal.example.org/en-GB/cookie-policy?ref=footer#cookies",
	])(
		"keeps the visitor's locale for an internal policy destination: %s",
		async (href) => {
			const config = libraryConfigSchema.parse(minimalLibraryConfig);
			config.legal.privacyPolicy = href;
			await expect(
				loadPolicyPageDocument(config, "privacy"),
			).rejects.toThrow("redirect:fr:/cookie-policy?ref=footer#cookies");
		},
	);

	it.each([
		"/privacy?ref=footer",
		"https://minimal.example.org/en-GB/privacy/",
		"/fr/privacy#contact",
	])("serves the policy without redirecting to itself: %s", async (href) => {
		const config = libraryConfigSchema.parse(minimalLibraryConfig);
		config.legal.privacyPolicy = href;
		await expect(
			loadPolicyPageDocument(config, "privacy"),
		).resolves.toMatchObject({
			content: expect.stringContaining("customer privacy notice"),
		});
	});

	it("uses the owner's privacy text, fills in the site host, and reads its date", async () => {
		const document = await loadPolicyDocument(withManifestText, "privacy");

		expect(document?.content).toContain(
			"maximal.example.org keeps only what the library needs.",
		);
		expect(document?.content).not.toContain("customer privacy notice");
		expect(document?.lastUpdated.toISOString()).toBe(
			"2026-08-01T00:00:00.000Z",
		);
	});

	it("falls back to the manifest date when the owner's text has no date line", async () => {
		const document = await loadPolicyDocument(
			withManifestText,
			"cookiePolicy",
		);

		expect(document?.content).toContain("Only essential cookies are used.");
		expect(document?.lastUpdated.toISOString()).toBe(
			new Date(withManifestText.updatedAt).toISOString(),
		);
	});

	it("serves the built-in privacy text when the owner wrote none", async () => {
		const document = await loadPolicyDocument(withBakedText, "privacy");

		expect(document?.content).toContain(
			"minimal.example.org customer privacy notice",
		);
	});

	it("lists consent and analytics cookies in the built-in cookie policy only where the community runs analytics", async () => {
		const withAnalytics = libraryConfigSchema.parse({
			...minimalLibraryConfig,
			analytics: { posthog: { host: "https://analytics.example.org", key: "phc_1234567890123456" } },
		});
		const off = await loadPolicyDocument(withBakedText, "cookiePolicy");
		const on = await loadPolicyDocument(withAnalytics, "cookiePolicy");

		// Cookie names are the inventory a cookie policy owes its readers, not its wording.
		for (const name of ["analytics_consent", "ph_*", "community_ga"]) {
			expect(off?.content).not.toContain(name);
			expect(on?.content).toContain(name);
		}
		expect(off?.content).toContain("NEXT_LOCALE");
	});

	it("has no terms page without owner-written terms", async () => {
		await expect(
			loadPolicyDocument(withBakedText, "terms"),
		).resolves.toBeNull();
	});
});

describe("policy page", () => {
	it("renders the owner's terms text", async () => {
		const document = await loadPolicyDocument(withManifestText, "terms");
		const markup = renderToStaticMarkup(
			<Policy
				content={document!.content}
				title="Terms of use"
				description="The rules for using this library."
				lastUpdated={document!.lastUpdated}
				otherPolicyLink={{ href: "/privacy", label: "Privacy" }}
			/>,
		);

		expect(markup).toContain("Terms of use");
		expect(markup).toContain("Use the library for research and teaching.");
	});

	it.each(["library@example.org", undefined])(
		"uses only the configured contact address: %s",
		(contactEmail) => {
			const html = renderToStaticMarkup(
				<Policy
					content="Policy content"
					title="Policy"
					description=""
					lastUpdated={new Date("2026-09-11")}
					otherPolicyLink={{ href: "/privacy", label: "Privacy" }}
					contactEmail={contactEmail}
				/>,
			);
			expect(html.includes("mailto:")).toBe(Boolean(contactEmail));
			if (contactEmail)
				expect(html).toContain(`href="mailto:${contactEmail}"`);
		},
	);

	it("exposes the policy revision date as readable text and a machine-readable time", async () => {
		const document = await loadPolicyDocument(withManifestText, "terms");
		// renderToString streams the page the same way the server does, so this
		// is the HTML a reader's browser and a search engine actually receive.
		const html = renderToString(
			<Policy
				content={document!.content}
				title="Terms of use"
				description="The rules for using this library."
				lastUpdated={document!.lastUpdated}
				otherPolicyLink={{ href: "/privacy", label: "Privacy" }}
			/>,
		);

		// The fixture's terms text carries no date, so the page falls back to
		// the date the owner last saved their settings.
		const time = new DOMParser()
			.parseFromString(html, "text/html")
			.querySelector("time");
		expect(time?.textContent).toBe("27 July 2026");
		expect(time?.getAttribute("datetime")).toBe(withManifestText.updatedAt);
	});
});

describe("policy chapter navigation", () => {
	it("preserves Markdown bodies and links while giving repeated headings separate destinations", () => {
		const content = `# Policy

Opening paragraph with [contact details][contact].

# **Your rights**
First section.

## Details
A nested subsection.

# *Your rights*
Second section.

\`\`\`md
## This is a code example
\`\`\`

# ~~Français~~
French section.

# [Further information][contact]
Further section.

[contact]: https://example.org/contact
`;
		const html = renderToStaticMarkup(
			<Policy
				content={content}
				title="Policy"
				description=""
				lastUpdated={new Date("2026-09-11")}
				otherPolicyLink={{ href: "/privacy", label: "Privacy" }}
			/>,
		);
		const document = new DOMParser().parseFromString(html, "text/html");
		const links = Array.from(
			document.querySelectorAll('nav[aria-label="Policy sections"] a'),
		);
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"#your-rights",
			"#your-rights-2",
			"#français",
			"#further-information",
		]);
		for (const link of links) {
			const target = document.getElementById(
				decodeURIComponent(link.getAttribute("href")!.slice(1)),
			);
			expect(target?.textContent).toContain(link.textContent!.slice(2));
		}
		expect(document.querySelector("article")?.textContent).toContain(
			"Opening paragraph with contact details.",
		);
		expect(document.querySelector("article a")?.getAttribute("href")).toBe(
			"https://example.org/contact",
		);
		expect(document.querySelector("pre code")?.textContent).toContain(
			"## This is a code example",
		);
		expect(document.querySelector("article")?.textContent).toContain(
			"A nested subsection.",
		);
		expect(document.getElementById("details")?.tagName).toBe("H3");
		expect(links.map((link) => link.textContent?.slice(2))).toEqual([
			"Your rights",
			"Your rights",
			"Français",
			"Further information",
		]);
	});
});
