import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { adminErrorResponse } from "@/lib/admin/http";
import { NativeItemValidationError } from "@/lib/admin/native-item-validation";

function wrappedDatabaseError(code: string) {
	const cause = Object.assign(new Error("database rejected write"), {
		code,
	});
	return new DrizzleQueryError("insert into item", [], cause);
}

describe("admin API error mapping", () => {
	it("unwraps Drizzle foreign-key and check violations as bad requests", async () => {
		for (const code of ["23503", "23514"]) {
			const response = adminErrorResponse(
				wrappedDatabaseError(code),
			);
			expect(response.status).toBe(400);
			expect(response.headers.get("cache-control")).toBe(
				"private, no-store",
			);
			expect(await response.json()).toEqual({
				error: "Draft references missing or invalid records",
			});
		}
	});

	it("unwraps Drizzle unique violations as conflicts", async () => {
		const response = adminErrorResponse(
			wrappedDatabaseError("23505"),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Record already exists",
		});
	});

	it("classifies validation errors without matching message text", async () => {
		const response = adminErrorResponse(
			new NativeItemValidationError("Invalid draft"),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid draft",
		});
	});
});
