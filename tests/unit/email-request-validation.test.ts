import { beforeEach, describe, expect, it, vi } from "vitest";

const areLinksValid = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions", () => ({ areLinksValid }));

import { parseRequestLinks } from "@/lib/utils";
import { contactRequestSchema, takedownRequestSchema, validateTakedownRequest } from "@/lib/request-validation";

const request = {
	email: "reader@example.org",
	links: ["https://library.example.org/lib/TEST1234"],
	description: "Please investigate this publication.",
};

describe("email request validation", () => {
	beforeEach(() => areLinksValid.mockReset());

	it("rejects missing links and blank descriptions", () => {
		expect(takedownRequestSchema.safeParse({ ...request, links: [] }).success).toBe(false);
		expect(contactRequestSchema.safeParse({ ...request, description: " ".repeat(20) }).success).toBe(false);
	});

	it.each([
		{ results: [{ status: "fulfilled", value: false }] },
		{ results: [{ status: "rejected", reason: new Error("Lookup unavailable") }] },
	])("rejects a takedown when a publication cannot be verified", async ({ results }) => {
		areLinksValid.mockResolvedValue(results);
		expect(await validateTakedownRequest(request.email, request.links, request.description)).toHaveProperty("error");
	});

	it("uses the same trimmed links for form validation and delivery", () => {
		expect(parseRequestLinks(`  ${request.links[0]}  \n  \n`)).toEqual(request.links);
	});

	it("accepts a takedown only when every linked publication exists", async () => {
		areLinksValid.mockResolvedValue([{ status: "fulfilled", value: true }]);
		expect(await validateTakedownRequest(request.email, request.links, request.description)).toEqual({ success: true });
	});
});
