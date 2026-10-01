import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));
const config = vi.hoisted(() => ({ libraryId: "test-library", convexSiteUrl: "https://access.example.test", machineCredential: "test-credential" }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => ({ authentication: { openScholar: config } }) }));

import { signedInHeaders } from "../helpers/reader-session";
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
  it.each(cases)("refuses %s for a Creator", async (name, handler) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "creator" })));
    const headers = signedInHeaders(`creator-${name}`);
    headers.set("Content-Type", "application/json");
    const request = new NextRequest("https://library.example.test/api/admin/items/ABC12345/publish", {
      method: "POST", headers, body: JSON.stringify({ action: "remove", keys: ["ABCD2345"] }),
    });
    const response = await handler(request, { params: Promise.resolve({ key: "ABC12345" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
