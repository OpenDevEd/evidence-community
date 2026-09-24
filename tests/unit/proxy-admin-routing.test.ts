import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// next-intl's middleware entry needs the Next runtime. These checks cover
// proxy routing before locale formatting.
vi.mock("next-intl/middleware", () => ({
	default: () => () => NextResponse.next(),
}));

const mocks = vi.hoisted(() => ({
	loadLibraryConfig: vi.fn(),
}));

vi.mock("@/config/library-config/source", () => ({
	loadLibraryConfig: mocks.loadLibraryConfig,
}));
vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: vi.fn(),
}));

import proxy from "@/proxy";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

const loginPageUrl =
	"https://openscholar.example.org/evidence-libraries/minimal";

function adminRequest(url: string, method = "GET") {
	return new NextRequest(`http://localhost${url}`, { method });
}

function publicAliasRequest(url: string) {
	return new NextRequest(`http://web:3000${url}`, {
		headers: {
			host: "web:3000",
			"x-forwarded-host": "old-library.example.org",
			"x-forwarded-proto": "https",
		},
	});
}

beforeEach(() => {
	const config = libraryConfigSchema.parse(
		structuredClone(minimalLibraryConfig),
	);
	mocks.loadLibraryConfig.mockResolvedValue(config);
});

describe("admin requests through the proxy", () => {
	it("sends a signed-out visitor to OpenScholar with the page to come back to", async () => {
		const response = await proxy(adminRequest("/admin?scope=drafts"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			`${loginPageUrl}?return=%2Fadmin%3Fscope%3Ddrafts`,
		);
	});

	it("answers a HEAD request the same way", async () => {
		const response = await proxy(adminRequest("/admin", "HEAD"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			`${loginPageUrl}?return=%2Fadmin`,
		);
	});

	it.each(["POST", "PUT", "DELETE"])(
		"refuses %s on the admin page",
		async (method) => {
			const response = await proxy(adminRequest("/admin", method));

			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("GET, HEAD");
		},
	);

	it("refuses a method the legacy query rules would have redirected", async () => {
		const response = await proxy(
			adminRequest("/admin?sort=date_desc", "POST"),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, HEAD");
	});

	it("drops a switched-off locale before leaving for OpenScholar", async () => {
		const response = await proxy(adminRequest("/pt/admin?sort=date_desc"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"http://localhost/admin?sort=date_desc",
		);
	});

	it("keeps a switched-on locale in the page to come back to", async () => {
		const response = await proxy(adminRequest("/en-GB/admin/items"));

		expect(response.headers.get("location")).toBe(
			`${loginPageUrl}?return=%2Fen-GB%2Fadmin%2Fitems`,
		);
	});
});

describe("public domain requests through the proxy", () => {
	it.each([
		["/terms", "https://policies.example.org/terms"],
		["/en-GB/terms", "/privacy"],
	])("lets %s reach its configured policy destination", async (pathname, termsOfService) => {
		const config = libraryConfigSchema.parse({
			...structuredClone(minimalLibraryConfig),
			legal: { termsOfService },
		});
		mocks.loadLibraryConfig.mockResolvedValue(config);

		const response = await proxy(adminRequest(pathname));

		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
	});

	it("temporarily redirects an alias because the selected main domain can change", async () => {
		const response = await proxy(publicAliasRequest("/lib?search=proof"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"https://minimal.example.org/lib?search=proof",
		);
	});
});

describe("the address without a path", () => {
	it("opens the listing while the library has no home page", async () => {
		const response = await proxy(adminRequest("/"));

		expect(response.status).toBe(307);
		expect(new URL(response.headers.get("location")!).pathname).toBe("/lib");
	});

	it("is left alone once the home page is on", async () => {
		const config = libraryConfigSchema.parse(structuredClone(minimalLibraryConfig));
		config.features.homePage = true;
		mocks.loadLibraryConfig.mockResolvedValue(config);

		const response = await proxy(adminRequest("/"));

		expect(response.headers.get("location")).toBeNull();
	});
});
