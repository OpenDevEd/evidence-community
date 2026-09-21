import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCitations } from "@/lib/citation-client";
import { itemToCitationData } from "@/lib/citation-data";

const item = { key: "REPORT01", itemType: "Report", title: "Schools in Kenya", date: "2025", publisher: "Education Press",
 creators: [{ firstName: "Jane", lastName: "Smith", creatorType: "author" }] };
afterEach(() => vi.unstubAllGlobals());

describe("citations from the loaded record", () => {
 it("formats all styles without a server request and honors the library URL", async () => {
  const fetch = vi.fn(() => { throw new Error("Network unavailable"); });
  vi.stubGlobal("fetch", fetch);
  const result = await loadCitations(["citations", { record: itemToCitationData(item) }, "en-GB", "https://library.example.org/lib/REPORT01"]);
  expect(result.citations?.apa).toBe("Smith, J. (2025). Schools in Kenya. Education Press. Available at https://library.example.org/lib/REPORT01.");
  expect(result.citations?.bibtex).toContain("url = {https://library.example.org/lib/REPORT01}");
  expect(fetch).not.toHaveBeenCalled();
 });
 it("formats updated metadata instead of reusing an older record citation", async () => {
  await loadCitations(["citations", { record: itemToCitationData(item) }, "en-GB", undefined]);
  const result = await loadCitations(["citations", { record: itemToCitationData({ ...item, title: "Updated school evidence" }) }, "en-GB", undefined]);
  expect(result.citations?.apa).toContain("Updated school evidence.");
  expect(result.citations?.apa).not.toContain("Schools in Kenya.");
 });
});
