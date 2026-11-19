// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewActions } from "@/components/admin/ReviewActions";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";

vi.mock("sonner", () => ({toast: {success: vi.fn(), error: vi.fn()}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const snapshot: ComponentProps<typeof ReviewActions>["snapshot"] = {
 key: "ABCD2345", reviewId: "bfa57b90-dc78-4b7b-8f36-a75ac4851a31", reviewRevision: 4,
 reviewState: "pending", title: "Feedback in classrooms", submittedAt: "2026-09-09T09:00:00Z",
 publishing: {route: "zenodo", identifierPolicy: "mint-zenodo"},
};
let root: Root;
let container: HTMLDivElement;
const buttons = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.trim() === name);
async function click(name: string) {
 const button = buttons(name).at(-1);
 expect(button).toBeDefined();
 await act(async () => {button!.click();});
}
beforeEach(() => {
 container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(role: "creator" | "editor", onUpdated: ComponentProps<typeof ReviewActions>["onUpdated"]) {
 await act(async () => root.render(<NextUIProvider disableAnimation><AdminSessionProvider session={{role,userId:"reviewer",name:"Reviewer",image:null, doiProviders: { crossref: true, zenodo: true }, defaultLicence: "cc-by-4.0", defaultFileAccess: null }}><ReviewActions snapshot={snapshot} onUpdated={onUpdated}/></AdminSessionProvider></NextUIProvider>));
}

describe("review approval dialog", () => {
 it("requires explicit PDF correction confirmation and closes approval before indexing recovery", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
   requests.push(JSON.parse(String(options.body)));
   return requests.length === 1
    ? Response.json({error:{code:"confirmation_required",message:"Confirm this PDF correction."}},{status:409})
    : Response.json({review:{revision:5},indexingReceipts:[{entityType:"item",entityKey:"ABCD2345",revision:2}]});
  }));
  const onUpdated = vi.fn(async () => {throw new Error("Search indexing unavailable");});
  await render("editor", onUpdated);
  await click("Publish version");
  await click("Publish version");
  expect(requests).toEqual([{action:"approve",expectedRevision:4}]);
  expect(onUpdated).not.toHaveBeenCalled();
  expect(buttons("Publish correction")).toHaveLength(1);
  await click("Publish correction");
  expect(requests).toEqual([{action:"approve",expectedRevision:4},{action:"approve",expectedRevision:4,zenodoFileChange:"minor_correction"}]);
  expect(onUpdated).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
 });
 it("does not offer approval or returning a review to Creators", async () => {
  await render("creator", vi.fn());
  expect(buttons("Publish version")).toHaveLength(0);
  expect(buttons("Request changes")).toHaveLength(0);
 });
});
