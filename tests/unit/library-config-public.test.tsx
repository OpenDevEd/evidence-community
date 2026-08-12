import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	LibraryConfigProvider,
	useLibraryConfig,
} from "@/context/LibraryConfigProvider";
import { maximalLibraryConfig } from "../fixtures/library-config";

const serverConfig = libraryConfigSchema.parse(maximalLibraryConfig);
const publicConfig = projectPublicLibraryConfig(serverConfig);

describe("public library configuration", () => {
	it("projects only explicitly allowlisted root fields", () => {
		expect(Object.keys(publicConfig).sort()).toEqual(
			[
				"ai",
				"analytics",
				"authentication",
				"citations",
				"collections",
				"contact",
				"content",
				"exports",
				"features",
				"filters",
				"footer",
				"gapMaps",
				"identity",
				"institutions",
				"legal",
				"localization",
				"navigation",
				"revision",
				"schemaVersion",
				"search",
				"theme",
				"updatedAt",
			].sort(),
		);
	});

	it("reuses the projection while the active server revision object is unchanged", () => {
		expect(projectPublicLibraryConfig(serverConfig)).toBe(publicConfig);
	});

	it("never serializes server service or credential values", () => {
		const serialized = JSON.stringify(publicConfig);

		expect(publicConfig).not.toHaveProperty("services");
		expect(publicConfig).not.toHaveProperty("email");
		expect(publicConfig).not.toHaveProperty("generation");
		expect(publicConfig).not.toHaveProperty("processing");
		expect(publicConfig).not.toHaveProperty("sources");
		expect(publicConfig.ai.providers[0]).not.toHaveProperty("apiKey");
		expect(publicConfig.authentication).toEqual({
			google: { enabled: true },
		});
		expect(publicConfig.authentication.google).not.toHaveProperty(
			"clientId",
		);
		expect(publicConfig.authentication.google).not.toHaveProperty(
			"clientSecret",
		);
		expect(publicConfig.authentication).not.toHaveProperty("secret");

		for (const privateValue of [
			"postgresql://library:password@database:5432/library",
			"maximal-search-key",
			"https://storage.example.org",
			"maximal-storage-service-role-key",
			"maximal-private",
			"maximal-public",
			"google-api-key",
			"google-client-id",
			"google-client-secret-value",
			"12345678901234567890123456789012",
			"smtp-password",
			"smtp-user",
			"https://exports.example.org/library.ris",
			"https://exports.example.org/library.bib",
			"https://exports.example.org/library.atom",
			"https://assets.example.org/gapmaps/gap-map-one.html",
			"crossref-login",
			"crossref-password",
			"zenodo-sandbox-token",
		]) {
			expect(serialized).not.toContain(privateValue);
		}
	});

	it("projects enabled gap maps through same-origin paths", () => {
		expect(publicConfig.gapMaps).toEqual([
			{
				slug: "gap-map-one",
				label: "Gap map one",
				description: "A configured evidence gap map.",
				href: "/gapmaps/gap-map-one.html",
			},
		]);
	});

	it("projects export availability without exposing source URLs", () => {
		expect(publicConfig.exports).toEqual({
			ris: true,
			bibtex: true,
			atom: true,
		});
	});

	it("retains safe AI provider metadata without API keys", () => {
		expect(publicConfig.ai.providers).toEqual([
			{
				provider: "google",
				enabled: true,
				defaultModel: "gemini-2.5-flash",
				largeModel: "gemini-2.5-pro",
				smallModel: "gemini-2.5-flash",
			},
		]);
	});
});

describe("LibraryConfigProvider", () => {
	function RevisionConsumer() {
		return <span>{useLibraryConfig().revision}</span>;
	}

	it("makes the public configuration available to client consumers", () => {
		const markup = renderToStaticMarkup(
			<LibraryConfigProvider config={publicConfig}>
				<RevisionConsumer />
			</LibraryConfigProvider>,
		);

		expect(markup).toBe("<span>maximal-1</span>");
	});

	it("fails clearly when the hook is used outside its provider", () => {
		expect(() => renderToStaticMarkup(<RevisionConsumer />)).toThrow(
			"useLibraryConfig must be used within LibraryConfigProvider",
		);
	});
});
