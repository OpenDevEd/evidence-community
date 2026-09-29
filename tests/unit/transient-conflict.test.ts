import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { retryTransientConflicts } from "@/db/transient-conflict";

const postgresError = (code: string) =>
	new DrizzleQueryError("SELECT 1", [], Object.assign(new Error("database error"), { code }));

function failing(errors: Error[]) {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		run: async () => {
			const error = errors[calls++];
			if (error) throw error;
			return "written";
		},
	};
}

describe("retryTransientConflicts", () => {
	it("runs a transaction again after PostgreSQL rolled it back to break a deadlock", async () => {
		const operation = failing([postgresError("40P01")]);
		await expect(retryTransientConflicts(operation.run)).resolves.toBe("written");
		expect(operation.calls).toBe(2);
	});

	it("gives up after three deadlocks in a row", async () => {
		const deadlock = postgresError("40P01");
		const operation = failing([deadlock, deadlock, deadlock, deadlock]);
		await expect(retryTransientConflicts(operation.run)).rejects.toBe(deadlock);
		expect(operation.calls).toBe(3);
	});

	it("does not repeat other failures", async () => {
		const duplicate = postgresError("23505");
		const operation = failing([duplicate]);
		await expect(retryTransientConflicts(operation.run)).rejects.toBe(duplicate);
		expect(operation.calls).toBe(1);
	});
});
