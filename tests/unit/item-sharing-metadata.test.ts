import { beforeEach, expect, it, vi } from "vitest";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async (original) => ({ ...(await original<typeof import("next-intl/server")>()), getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/actions", () => ({}));

const boundary = vi.hoisted(() => ({ item: vi.fn(), config: vi.fn(), withdrawn: vi.fn() }));
vi.mock("@/db", () => ({ getDatabaseForConfig: async () => ({}) }));
vi.mock("@/lib/withdrawn-record", () => ({ readWithdrawnRecord: boundary.withdrawn }));
vi.mock("@/app/api/cache", () => ({ getCachedItemSmall: boundary.item }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: boundary.config }));
vi.mock("@/app/[locale]/lib/[key]/ServerComponent", () => ({ default: () => null }));
vi.mock("@/app/[locale]/lib/[key]/LoadingComponent", () => ({ default: () => null }));

import { generateMetadata } from "@/app/[locale]/lib/[key]/page";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const publication = { key: "ABCDEFGH", title: "Published report", abstractNote: "Report abstract", creators: [], attachmentsData: [] };
const metadata = () => generateMetadata({ params: Promise.resolve({ key: publication.key }) });

beforeEach(() => {
 boundary.withdrawn.mockResolvedValue(null);
 boundary.config.mockResolvedValue(config);
 boundary.item.mockResolvedValue({ item: structuredClone(publication) });
});

it("uses the library share image when a published report has no cover", async () => {
 const result = await metadata();
 expect(result.openGraph).toMatchObject({ images: [{ url: config.identity.assets.shareImage }], title: publication.title });
 expect(result.twitter).toMatchObject({ title: publication.title, description: publication.abstractNote });
 expect(result.alternates?.canonical).toBe(`${config.identity.baseUrl}/lib/ABCDEFGH`);
});

it("uses a public PDF cover before the library image", async () => {
 boundary.item.mockResolvedValue({ item: { ...publication, attachmentsData: [{ key: "PDFABCDE", PDFCoverPageImage: "https://files.example.org/cover.png", PDFCoverPageWidth: 1600, PDFCoverPageHeight: 2263 }] } });
 expect((await metadata()).openGraph).toMatchObject({ images: [{ url: "https://files.example.org/cover.png", width: 1600, height: 2263 }] });
});

it("does not advertise indexing or publication metadata when the public item is absent", async () => {
 boundary.item.mockResolvedValue({ item: undefined });
 const result = await metadata();
 expect(result.robots).toEqual({ index: false, follow: false });
 expect(result.other).toBeUndefined();
});


// A withdrawn record's DOI still leads to its page, which names the work but is no longer one of the community's records.
it("names a withdrawn record's tombstone after it and keeps it out of search engines", async () => {
 boundary.item.mockResolvedValue({ item: undefined });
 boundary.withdrawn.mockResolvedValue({ key: publication.key, title: publication.title, authors: [], year: "2026", withdrawnAt: "2026-11-20T09:00:00.000Z", reason: "A duplicate.", dois: [] });
 const result = await metadata();
 expect(result.title).toBe("recordWithdrawnTitle");
 expect(result.robots).toEqual({ index: false, follow: false });
 expect(result.other).toBeUndefined();
});

it("uses a generated public title card when neither a cover nor a library share image exists", async () => {
 const withoutImage = structuredClone(config);
 delete withoutImage.identity.assets.shareImage;
 boundary.config.mockResolvedValue(withoutImage);
 expect((await metadata()).openGraph).toMatchObject({images: [{url: `${config.identity.baseUrl}/lib/ABCDEFGH/share-image`}]});
});


it("publishes author names without internal profile IDs or institution fields", async () => {
 boundary.item.mockResolvedValue({item: {...publication, creators: [{creatorType: "author", firstName: "Maya", lastName: "Chen", authorProfileId: "internal-profile-id", institution: "A university"}, {creatorType: "author", name: "Research group"}]}});
 const result = await metadata();
 expect(result.other?.citation_author).toEqual(["Maya Chen", "Research group"]);
 expect(result.openGraph).toMatchObject({authors: ["Maya Chen", "Research group"]});
});

it("omits an Open Graph locale when the configured language has no territory", async () => {
 const french = structuredClone(config);
 french.localization.defaultLocale = "fr";
 boundary.config.mockResolvedValue(french);
 expect((await metadata()).openGraph).toMatchObject({locale: undefined});
});
