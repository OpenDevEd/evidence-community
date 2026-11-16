import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// next-intl's middleware entry needs the Next runtime; these checks stop before locale formatting.
vi.mock("next-intl/middleware", () => ({
	default: () => () => NextResponse.next(),
}));

const mocks = vi.hoisted(() => ({
	loadLibraryConfig: vi.fn(),
	readItemRedirect: vi.fn(),
}));

vi.mock("@/config/library-config/source", () => ({ loadLibraryConfig: mocks.loadLibraryConfig }));
vi.mock("@/lib/item-redirects", () => ({ readItemRedirect: mocks.readItemRedirect }));

import proxy from "@/proxy";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

beforeEach(() => {
	const config = libraryConfigSchema.parse(structuredClone(minimalLibraryConfig));
	config.generation.redirects = true;
	mocks.loadLibraryConfig.mockResolvedValue(config);
	mocks.readItemRedirect.mockReset();
});

it("sends an old record key to the record's current key, keeping the rest of the path", async () => {
	mocks.readItemRedirect.mockResolvedValue("NEWKEY01");
	const response = await proxy(new NextRequest("http://localhost/lib/OLDKEY01/export/ris"));
	expect(response.status).toBe(301);
	expect(new URL(response.headers.get("location")!).pathname).toBe("/lib/NEWKEY01/export/ris");
	expect(mocks.readItemRedirect).toHaveBeenCalledWith(expect.anything(), "OLDKEY01");
});

it("shows the record under the key asked for when the lookup finds nothing or fails", async () => {
	mocks.readItemRedirect.mockResolvedValueOnce(null);
	expect((await proxy(new NextRequest("http://localhost/lib/OLDKEY01"))).status).not.toBe(301);
	mocks.readItemRedirect.mockRejectedValueOnce(new Error("Redirect lookup timeout"));
	expect((await proxy(new NextRequest("http://localhost/lib/OLDKEY01"))).status).not.toBe(301);
});

it("looks a configured redirect up over plain HTTP from this server, which reads as https://localhost:3000 behind the community's proxy", async () => {
	const fetchMock = vi.fn(async () => Response.json({ destination: "/lib/NEWKEY01" }));
	vi.stubGlobal("fetch", fetchMock);
	try {
		const response = await proxy(new NextRequest("https://localhost:3000/old-report"));
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("http://localhost:3000/api/redirects/old-report");
		expect(new URL(response.headers.get("location")!, "https://localhost:3000").pathname).toBe("/lib/NEWKEY01");
	} finally {
		vi.unstubAllGlobals();
	}
});
