import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ libraryId: "test-library", secret: "12345678901234567890123456789012", convexSiteUrl: "https://access.example.test", loginPageUrl: "https://app.example.test", machineCredential: "test-credential" }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => ({ authentication: { secret: config.secret, openScholar: config } }) }));

import { createAdminSessionToken, adminSessionCookieName } from "@/lib/admin/access";
import { POST as unpublishItem } from "@/app/api/admin/items/[key]/unpublish/route";
import { POST as activateCrossref } from "@/app/api/admin/items/[key]/publication/crossref/activate/route";
import { POST as activateZenodo } from "@/app/api/admin/items/[key]/publication/zenodo/activate/route";
import { POST as batch } from "@/app/api/admin/items/batch/route";

const cases = [
  ["unpublish item", unpublishItem],
  ["activate Crossref", activateCrossref], ["activate Zenodo", activateZenodo],
  ["batch removal", batch],
] as const;

describe("Creator publication requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(cases)("refuses %s even with an old Owner cookie", async (_name, handler) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "creator" })));
    const token = createAdminSessionToken({ libraryId: config.libraryId, clerkOrganizationId: "owning-org", clerkUserId: "creator", role: "owner", consumedAt: Date.now() }, config);
    const request = new NextRequest("https://library.example.test/api/admin/items/ABC12345/publish", {
      method: "POST", headers: { Cookie: `${adminSessionCookieName()}=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", keys: ["ABCD2345"] }),
    });
    const response = await handler(request, { params: Promise.resolve({ key: "ABC12345" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
