import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
	cacheLife: vi.fn(),
	cacheTag: vi.fn(),
}));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/pages/PolicyToc", () => ({
	default: () => null,
}));

import PolicyPage from "@/components/pages/PolicyPage";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { loadPolicyDocument } from "@/lib/policy-documents";
import {
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

const withManifestText = libraryConfigSchema.parse(maximalLibraryConfig);
const withBakedText = libraryConfigSchema.parse(minimalLibraryConfig);

describe("policy documents", () => {
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
		const document = await loadPolicyDocument(withManifestText, "cookiePolicy");

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

	it("has no terms page without owner-written terms", async () => {
		await expect(loadPolicyDocument(withBakedText, "terms")).resolves.toBeNull();
	});
});

describe("policy page", () => {
	it("renders the owner's terms text", async () => {
		const document = await loadPolicyDocument(withManifestText, "terms");
		const markup = renderToStaticMarkup(
			<PolicyPage
				content={document!.content}
				title="Terms of use"
				description="The rules for using this library."
				lastUpdated={document!.lastUpdated}
				otherPolicyLink={{ href: "/privacy", label: "Privacy" }}
				homeLabel="Home"
			/>,
		);

		expect(markup).toContain("Terms of use");
		expect(markup).toContain("Use the library for research and teaching.");
	});
});
