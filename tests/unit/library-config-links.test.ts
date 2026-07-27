import { describe, expect, it } from "vitest";

import {
	getRuntimeHomeHref,
	getRuntimeInternalHrefPath,
	getRuntimeLinkAnchorProps,
	getVisibleRuntimeLinks,
	hasRuntimeLinkPath,
	hasRuntimeNavigationPath,
} from "@/config/library-config/links";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

describe("runtime configuration links", () => {
	it("keeps the minimal configuration empty and defaults the logo home link", () => {
		const config = libraryConfigSchema.parse(minimalLibraryConfig);

		expect(getVisibleRuntimeLinks(config.navigation.links)).toEqual([]);
		expect(config.footer.sections).toEqual([]);
		expect(getRuntimeHomeHref(config.navigation.links)).toBe("/");
	});

	it("preserves configured order while removing hidden navigation and footer links", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.navigation!.links!.push({
			id: "hidden",
			label: "Hidden",
			href: "/hidden",
			visible: false,
		});
		input.footer!.sections![0]!.links!.push({
			id: "hidden-footer",
			label: "Hidden footer",
			href: "/hidden-footer",
			visible: false,
		});

		const config = libraryConfigSchema.parse(input);

		expect(
			getVisibleRuntimeLinks(config.navigation.links).map(
				(link) => link.id,
			),
		).toEqual(["evidence", "external"]);
		expect(
			getVisibleRuntimeLinks(config.footer.sections[0].links).map(
				(link) => link.id,
			),
		).toEqual(["library"]);
	});

	it("uses a hidden home link for the logo without exposing it in navigation", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.navigation!.links!.unshift({
			id: "home",
			label: "Home",
			href: "/lib",
			visible: false,
		});

		const links = libraryConfigSchema.parse(input).navigation.links;

		expect(getRuntimeHomeHref(links)).toBe("/lib");
		expect(getVisibleRuntimeLinks(links).map((link) => link.id)).not.toContain(
			"home",
		);
	});

	it("finds hidden and nested internal routes without matching external URLs", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.navigation!.links!.push({
			id: "hidden-statistics",
			label: "Statistics",
			href: "/statistics?source=nav",
			visible: false,
		});
		input.navigation!.links![0]!.children!.push({
			id: "nested-route",
			label: "Nested",
			href: "/nested/",
			visible: false,
		});
		input.footer!.sections![0]!.links!.push({
			id: "footer-route",
			label: "Footer route",
			href: "/footer-route#details",
			visible: false,
		});

		const config = libraryConfigSchema.parse(input);
		const links = config.navigation.links;

		expect(hasRuntimeNavigationPath(links, "/statistics")).toBe(true);
		expect(hasRuntimeNavigationPath(links, "/nested")).toBe(true);
		expect(hasRuntimeNavigationPath(links, "/missing")).toBe(false);
		expect(
			hasRuntimeLinkPath(
				config.footer.sections[0].links,
				"/footer-route/",
			),
		).toBe(true);
		expect(getRuntimeInternalHrefPath("https://example.org/statistics")).toBe(
			null,
		);
	});

	it("adds a safe new-tab target only to configured blank links", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		const [internal, external] = config.navigation.links;

		expect(getRuntimeLinkAnchorProps(internal)).toEqual({});
		expect(getRuntimeLinkAnchorProps(external)).toEqual({
			target: "_blank",
			rel: "noopener noreferrer",
		});
	});
});
