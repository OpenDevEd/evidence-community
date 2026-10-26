import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getItemsPaginationMeta: vi.fn(),
	getLibraryConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/components/pages/EvidenceLibrary", () => ({
	default: () => null,
}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));
vi.mock("@/lib/language-alternates", () => ({
	buildLanguageAlternates: vi.fn(() => ({
		"en-GB": "https://library.example.org/lib",
	})),
	buildLocalizedSiteUrl: vi.fn(
		(pathname: string, _locale: string, _config: unknown, origin: string) =>
			new URL(pathname, origin).toString(),
	),
}));
vi.mock("@/lib/search", () => ({
	getItemsPaginationMeta: mocks.getItemsPaginationMeta,
}));
vi.mock("@/lib/utils", () => ({
	buildItemsQuery: vi.fn((_query: unknown, pathname: string) => pathname),
	defaultParams: vi.fn(() => ({})),
}));
vi.mock("next/cache", () => ({
	cacheLife: vi.fn(),
}));

import { libraryMetadata } from "@/app/[locale]/lib/page";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { cloneLibraryConfig } from "../fixtures/library-config";

beforeEach(() => {
	const input = libraryConfigSchema.parse(cloneLibraryConfig());
	input.features.atomFeed = true;
	input.exports.atom = true;
	mocks.getLibraryConfig.mockResolvedValue(input);
	mocks.getItemsPaginationMeta.mockResolvedValue({
		currentPage: 1,
		totalPages: 1,
	});
});

describe("runtime library metadata", () => {
	it("advertises the configured whole-library Atom route from the library page", async () => {
		const metadata = await libraryMetadata({
			atomFeedPath: "/lib/atom.xml",
			params: Promise.resolve({ locale: "en-GB" }),
			pathname: "/lib",
			searchParams: Promise.resolve(new URLSearchParams()),
		});

		expect(metadata.alternates?.types).toEqual({
			"application/atom+xml":
				"https://maximal.example.org/lib/atom.xml",
		});
	});

	it("does not advertise a library Atom feed from a profile page", async () => {
		const metadata = await libraryMetadata({
			params: Promise.resolve({ locale: "en-GB" }),
			pathname: "/profile/user-one",
			searchParams: Promise.resolve(new URLSearchParams()),
		});

		expect(metadata.alternates?.types).toBeUndefined();
	});

	it("links the pages either side only while they are numbered, since later ones need a cursor", async () => {
		const linksOn = async (currentPage: number) => {
			mocks.getItemsPaginationMeta.mockResolvedValue({ currentPage, perPage: 20, totalPages: 2_805 });
			const metadata = await libraryMetadata({
				params: Promise.resolve({ locale: "en-GB" }),
				pathname: "/lib?page=1&after=CURSOR",
				searchParams: Promise.resolve(new URLSearchParams()),
			});
			return (metadata as { pagination?: { previous: string | null; next: string | null } }).pagination;
		};
		expect(await linksOn(499)).toEqual({
			previous: "https://maximal.example.org/lib?page=498",
			next: "https://maximal.example.org/lib?page=500",
		});
		expect(await linksOn(500)).toEqual({ previous: "https://maximal.example.org/lib?page=499", next: null });
		expect(await linksOn(502)).toEqual({ previous: null, next: null });
	});
});
