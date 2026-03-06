import "server-only";

import { parseCompanyName } from "@/lib/utils";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { cache } from "react";

const POLICY_DOCUMENT_PATHS = {
	privacy: join(process.cwd(), "docs/privacy-policy.md"),
	cookiePolicy: join(process.cwd(), "docs/cookie-policy.md"),
} as const;

const DEFAULT_POLICY_SITE_HOST = "docs.opendeved.net";
const POLICY_SITE_HOST_TOKEN = "{{SITE_HOST}}";
const POLICY_CONDITIONAL_CLOSE_TOKEN = "{{::}}";
const POLICY_SITE_URL_ENV_KEYS = [
	"BASE_URL",
	"VERCEL_PROJECT_PRODUCTION_URL",
	"VERCEL_URL",
] as const;
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

function normalizeSiteHost(rawValue: string | undefined) {
	if (!rawValue) return null;

	const trimmedValue = rawValue.trim();
	if (!trimmedValue) return null;

	try {
		const normalizedUrl = new URL(
			trimmedValue.includes("://")
				? trimmedValue
				: `https://${trimmedValue}`
		);

		return normalizedUrl.host || null;
	} catch {
		return (
			trimmedValue
				.replace(/^[a-z]+:\/\//i, "")
				.replace(/\/.*$/, "")
				.trim() || null
		);
	}
}

function getPolicySiteHost() {
	for (const envKey of POLICY_SITE_URL_ENV_KEYS) {
		const siteHost = normalizeSiteHost(process.env[envKey]);
		if (siteHost) return siteHost;
	}

	return DEFAULT_POLICY_SITE_HOST;
}

function getPolicyConditionalTags() {
	return new Set(
		POLICY_VERCEL_ENV_KEYS.some((envKey) => hasEnvValue(process.env[envKey]))
			? ["Vercel"]
			: ["DigitalOcean"]
	);
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
				throw new Error("Encountered a policy conditional closing tag without an opening tag.");
			}

			if (!tag) {
				throw new Error("Encountered a policy conditional opening tag without a provider name.");
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

function populatePolicyDocument(content: string) {
	const siteHost = getPolicySiteHost();
	const enabledTags = getPolicyConditionalTags();

	return parsePolicyTemplate(content)
		.map((node) => {
			if (node.type === "conditional" && !enabledTags.has(node.tag)) {
				return "";
			}

			return node.value.replaceAll(POLICY_SITE_HOST_TOKEN, siteHost);
		})
		.join("");
}

export const readPolicyDocument = cache(
	async (document: keyof typeof POLICY_DOCUMENT_PATHS) =>
		populatePolicyDocument(
			await readFile(POLICY_DOCUMENT_PATHS[document], "utf-8")
		)
);

export const getPolicyLastModified = cache(
	async (document: keyof typeof POLICY_DOCUMENT_PATHS) =>
		(await stat(POLICY_DOCUMENT_PATHS[document])).mtime
);

export function getPolicyMetadata(
	title: "Privacy Policy" | "Cookie Policy",
	description: string
) {
	const { companyName, siteName } = parseCompanyName(process.env.NEXT_PUBLIC_COMPANY_NAME);

	return {
		title: `${title} | ${companyName} - ${siteName}`,
		description,
	};
}
