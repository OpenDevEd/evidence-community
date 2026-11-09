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
	it.each(["document", "redirect", "neither"])("offers terms links with %s configured", (mode) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.legal.termsMarkdown = mode === "document" ? "Test terms" : undefined;
		config.legal.termsOfService = mode === "redirect" ? "https://example.org/terms" : undefined;
		const link = { id: "terms-check", label: "Terms", href: "/fr/terms#details", target: "self" as const, visible: true };
		config.navigation.links.push({ ...link, children: [] });
		config.footer.sections[0].links.push(link);
		const projected = projectPublicLibraryConfig(config);
		expect(projected.navigation.links.some(entry => entry.id === "terms-check")).toBe(mode !== "neither");
		expect(projected.footer.sections[0].links.some(entry => entry.id === "terms-check")).toBe(mode !== "neither");
	});

	it.each(["form", "details", "neither"])("offers contact links with %s available", (mode) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.email.contactRecipient = mode === "form" ? "contact@example.org" : undefined;
		config.email.takedownRecipient = undefined;
		config.contact = mode === "details" ? { email: "hello@example.org" } : {};
		const link = { id: "contact-check", label: "Contact", href: "/contact", target: "self" as const, visible: true };
		config.navigation.links.push({ ...link, children: [] });
		config.footer.sections[0].links.push(link, {...link, id: "takedown-check", href: "/takedown"});
		const projected = projectPublicLibraryConfig(config);
		expect(projected.navigation.links.some(entry => entry.id === "contact-check")).toBe(mode !== "neither");
		expect(projected.footer.sections[0].links.some(entry => entry.id === "contact-check")).toBe(mode !== "neither");
		expect(projected.footer.sections[0].links.some(entry => entry.id === "takedown-check")).toBe(false);
	});

	it.each([true, false])("only offers map links while the map page is enabled: %s", (enabled) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.features.countryFocus = enabled;
		const link = {id: "map", label: "Map", href: "/map?view=country", target: "self" as const, visible: true};
		config.navigation.links.push({...link, children: []});
		config.navigation.links[0].children.push(link);
		config.footer.sections[0].links.push(link);
		const projected = projectPublicLibraryConfig(config);
		for (const links of [projected.navigation.links, projected.navigation.links[0].children, projected.footer.sections[0].links]) {
			expect(links.some(entry => entry.id === "map")).toBe(enabled);
		}
		expect(config.navigation.links.at(-1)?.id).toBe("map");
	});

	it("removes absolute and localized links to its disabled map, but keeps external maps", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.features.countryFocus = false;
		config.navigation.links = ["/fr/map/", "/map?country=KE", `${config.identity.baseUrl}/en-GB/map#country`, "https://elsewhere.example.org/map"].map((href, index) => ({ id: `map-${index}`, label: "Map", href, visible: true, target: "self", children: [] }));
		expect(projectPublicLibraryConfig(config).navigation.links.map(link => link.href)).toEqual(["https://elsewhere.example.org/map"]);
	});

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
				"notifications",
				"resultLimit",
				"revision",
				"schemaVersion",
				"search",
				"sourcePublishTags",
				"theme",
				"topics",
				"updatedAt",
			].sort(),
		);
	});

	it("includes the tagline, description, share image, and powered-by setting", () => {
		expect(publicConfig.identity.tagline).toBe(
			maximalLibraryConfig.identity.tagline,
		);
		expect(publicConfig.identity.description).toBe(
			maximalLibraryConfig.identity.description,
		);
		expect(publicConfig.identity.assets.shareImage).toBe(
			maximalLibraryConfig.identity.assets.shareImage,
		);
		expect(publicConfig.footer.poweredBy).toBe(false);
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
		expect(publicConfig.search).not.toHaveProperty("embedder");
		expect(publicConfig.search.embeddings).toBe(true);
		expect(publicConfig.citations).toEqual({
			enabled: serverConfig.citations.enabled,
			showUrl: serverConfig.citations.showUrl,
		});
		// Only the account page and the library's ID reach the browser: never the OAuth client secret,
		// the machine credential or the session secret.
		expect(publicConfig.authentication).toEqual({
			openScholar: {
				accountUrl: serverConfig.authentication.openScholar.accountUrl,
				// For the link to apply to join its team.
				libraryId: serverConfig.authentication.openScholar.libraryId,
				// Only the site of the library's page on OpenScholar, never the page itself.
				siteUrl: new URL(serverConfig.authentication.openScholar.libraryUrl).origin,
			},
		});

		for (const privateValue of [
			"postgresql://library:password@database:5432/library",
			"maximal-search-key",
			"maximal-embedding-api-key",
			"text-embedding-3-small",
			"https://storage.example.org",
			"maximal-storage-service-role-key",
			"maximal-private",
			"maximal-public",
			"maximal-zotero-api-key",
			"google-api-key",
			"google-client-id",
			"google-client-secret-value",
			"12345678901234567890123456789012",
			"els_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			// Not the library's OpenScholar ID: the link to join its team names it, and OpenScholar's public directory lists it.
			"https://spotted-woodpecker-546.convex.site",
			"smtp-password",
			"smtp-user",
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

	it("passes the export switches through to the browser", () => {
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
				models: ["gemini-2.5-flash", "gemini-2.5-pro"],
				defaultModel: "gemini-2.5-flash",
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
