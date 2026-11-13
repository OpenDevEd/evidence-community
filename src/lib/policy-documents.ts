import "server-only";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect as redirectLocalized } from "@/i18n/routing";
import { analyticsCapabilities, sharesConsentOnHost } from "@/lib/analytics-consent";
import { POLICY_DESTINATIONS, type PolicyDocumentKind } from "@/lib/legal-links";
import { getRuntimeLinkHref, getRuntimePagePath } from "@/config/library-config/links";

import { readFile, stat } from "fs/promises";
import { join } from "path";
import { cacheLife, cacheTag } from "next/cache";

import type { LibraryServerConfig } from "@/config/library-config/schema";

const POLICY_DOCUMENT_PATHS = {
	privacy: join(process.cwd(), "docs", "privacy-policy.md"),
	cookiePolicy: join(process.cwd(), "docs", "cookie-policy.md"),
} as const;

const POLICY_MANIFEST_FIELDS = {
	cookiePolicy: "cookieMarkdown",
	privacy: "privacyMarkdown",
	terms: "termsMarkdown",
} as const satisfies Record<PolicyDocumentKind, keyof LibraryServerConfig["legal"]>;

const POLICY_SITE_HOST_TOKEN = "{{SITE_HOST}}";
const POLICY_CONDITIONAL_CLOSE_TOKEN = "{{::}}";
const POLICY_VERCEL_ENV_KEYS = [
	"VERCEL",
	"VERCEL_ENV",
	"VERCEL_URL",
	"VERCEL_BRANCH_URL",
	"VERCEL_PROJECT_PRODUCTION_URL",
] as const;

type PolicyTemplateNode =
	| {
			type: "text";
			value: string;
	  }
	| {
			type: "conditional";
			tag: string;
			value: string;
	  };

function hasEnvValue(rawValue: string | undefined) {
	return Boolean(rawValue?.trim());
}

function getPolicyConditionalTags(siteHost: string, analytics: boolean) {
	return new Set([
		POLICY_VERCEL_ENV_KEYS.some((envKey) => hasEnvValue(process.env[envKey])) ? "Vercel" : "DigitalOcean",
		// A community that runs analytics asks for consent, Openscholar's shared choice or its own (analytics-consent.ts).
		// One that runs none asks nothing, so it has no consent to describe.
		...(analytics
			? ["Analytics", sharesConsentOnHost(new URL(`https://${siteHost}`).hostname) ? "SharedConsent" : "OwnConsent"]
			: ["NoAnalytics"]),
	]);
}

function parsePolicyTemplate(content: string): PolicyTemplateNode[] {
	const nodes: PolicyTemplateNode[] = [];
	const tokenPattern = /\{\{([A-Za-z][A-Za-z0-9_-]*)::\}\}|\{\{::\}\}/g;
	let lastTokenEnd = 0;
	let openBlock: { tag: string; contentStart: number } | null = null;

	for (const tokenMatch of content.matchAll(tokenPattern)) {
		const token = tokenMatch[0];
		const tokenStart = tokenMatch.index ?? 0;
		const tag = tokenMatch[1];

		if (!openBlock) {
			if (tokenStart > lastTokenEnd) {
				nodes.push({
					type: "text",
					value: content.slice(lastTokenEnd, tokenStart),
				});
			}

			if (token === POLICY_CONDITIONAL_CLOSE_TOKEN) {
				throw new Error(
					"Encountered a policy conditional closing tag without an opening tag."
				);
			}

			if (!tag) {
				throw new Error(
					"Encountered a policy conditional opening tag without a provider name."
				);
			}

			openBlock = {
				tag,
				contentStart: tokenStart + token.length,
			};
			lastTokenEnd = tokenStart + token.length;
			continue;
		}

		if (token !== POLICY_CONDITIONAL_CLOSE_TOKEN) {
			throw new Error(
				`Nested policy conditional blocks are not supported. Found "${tag}" inside "${openBlock.tag}".`
			);
		}

		nodes.push({
			type: "conditional",
			tag: openBlock.tag,
			value: content.slice(openBlock.contentStart, tokenStart),
		});
		openBlock = null;
		lastTokenEnd = tokenStart + token.length;
	}

	if (openBlock) {
		throw new Error(
			`Unclosed policy conditional block "${openBlock.tag}" in policy document.`
		);
	}

	if (lastTokenEnd < content.length) {
		nodes.push({
			type: "text",
			value: content.slice(lastTokenEnd),
		});
	}

	return nodes;
}

function populatePolicyDocument(content: string, siteHost: string, analytics: boolean) {
	const enabledTags = getPolicyConditionalTags(siteHost, analytics);

	return parsePolicyTemplate(content)
		.map((node) => {
			if (node.type === "conditional" && !enabledTags.has(node.tag)) {
				return "";
			}

			return node.value.replaceAll(POLICY_SITE_HOST_TOKEN, siteHost);
		})
		.join("");
}

const POLICY_LAST_UPDATED_PATTERN = /^[#*\s]*last\s+updated[*\s]*:?\s*(.*)$/i;
const POLICY_MONTH_NAMES = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
];

function parsePolicyDate(rawValue: string) {
	const value = rawValue.replace(/[*_`#]/g, "").replace(/,/g, " ").trim();
	const monthFirst = value.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
	const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);

	if (!monthFirst && !dayFirst) return null;

	const [monthName, day, year] = monthFirst
		? [monthFirst[1], monthFirst[2], monthFirst[3]]
		: [dayFirst![2], dayFirst![1], dayFirst![3]];

	const monthIndex = POLICY_MONTH_NAMES.indexOf(monthName.toLowerCase());
	if (monthIndex === -1) return null;

	// UTC so the rendered date cannot shift a day based on server timezone.
	return new Date(Date.UTC(Number(year), monthIndex, Number(day)));
}

function parsePolicyLastUpdated(content: string) {
	const lines = content.split("\n");

	// Search from the end: both policies close with their "Last updated" line,
	// and the privacy notice mentions the phrase earlier in prose.
	for (let index = lines.length - 1; index >= 0; index--) {
		const match = lines[index].match(POLICY_LAST_UPDATED_PATTERN);
		if (!match) continue;

		const inlineDate = parsePolicyDate(match[1]);
		if (inlineDate) return inlineDate;

		// Heading form: the date sits in the next non-empty line.
		const nextLine = lines.slice(index + 1).find((line) => line.trim());
		const followingDate = nextLine ? parsePolicyDate(nextLine) : null;
		if (followingDate) return followingDate;
	}

	return null;
}

async function readPolicyDocument(
	document: keyof typeof POLICY_DOCUMENT_PATHS,
	siteHost: string,
	analytics: boolean,
) {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag(`policy-doc-${document}-${siteHost}`)
	return populatePolicyDocument(
		await readFile(/* turbopackIgnore: true */ POLICY_DOCUMENT_PATHS[document], "utf-8"),
		siteHost,
		analytics,
	);
}

async function getPolicyLastModified(document: keyof typeof POLICY_DOCUMENT_PATHS) {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag('policy-modified-' + document)

	const path = POLICY_DOCUMENT_PATHS[document];
	const statedLastUpdated = parsePolicyLastUpdated(
		await readFile(/* turbopackIgnore: true */ path, "utf-8")
	);

	// The document's own "Last updated" line is authoritative. File mtime only
	// records when the image was built, so it drifts on every redeploy.
	return statedLastUpdated ?? (await stat(/* turbopackIgnore: true */ path)).mtime;
}

type PolicyDocumentConfig = Pick<LibraryServerConfig, "identity" | "legal" | "updatedAt" | "analytics">;

function getPolicyRedirect(config: PolicyDocumentConfig, document: PolicyDocumentKind) {
	const destination = POLICY_DESTINATIONS[document];
	const href = config.legal[destination.field];
	if (href && getRuntimePagePath(href, config.identity.baseUrl) !== destination.path) return href;
	return null;
}

export async function loadPolicyPageDocument(config: PolicyDocumentConfig, document: PolicyDocumentKind) {
	const destination = getPolicyRedirect(config, document);
	if (destination) {
		const href = getRuntimeLinkHref(destination, config.identity.baseUrl);
		if (href.startsWith("/")) redirectLocalized({ href, locale: await getLocale() });
		redirect(destination);
	}
	return loadPolicyDocument(config, document);
}

/**
 * A configured destination takes precedence. For a local policy page, owner
 * text replaces the built-in document. Terms require owner-written text.
 */
export async function loadPolicyDocument(
	config: PolicyDocumentConfig,
	document: PolicyDocumentKind,
): Promise<{ content: string; lastUpdated: Date } | null> {
	if (getPolicyRedirect(config, document)) return null;
	const siteHost = new URL(config.identity.baseUrl).host;
	const analytics = analyticsCapabilities(config.analytics).analytics;
	const manifestText = config.legal[POLICY_MANIFEST_FIELDS[document]];
	if (manifestText) {
		return {
			content: populatePolicyDocument(manifestText, siteHost, analytics),
			lastUpdated:
				parsePolicyLastUpdated(manifestText) ?? new Date(config.updatedAt),
		};
	}
	if (document === "terms") return null;
	const [content, lastUpdated] = await Promise.all([
		readPolicyDocument(document, siteHost, analytics),
		getPolicyLastModified(document),
	]);
	return { content, lastUpdated };
}

export function getPolicyMetadata(
	title: string,
	description: string,
	libraryName: string,
) {
	return {
		title: `${title} | ${libraryName}`,
		description,
	};
}
