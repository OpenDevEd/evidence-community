import { describe, expect, it, vi } from "vitest";

import {
	DatabaseRevisionConflictError,
	DatabaseRevisionOrderError,
	RevisionAwareDatabaseFactory,
} from "@/db/factory";

const firstUpdatedAt = "2026-07-28T00:00:00.000Z";
const secondUpdatedAt = "2026-07-28T00:01:00.000Z";

describe("revision-aware database factory", () => {
	it("reuses one resource for the active revision", async () => {
		const dispose = vi.fn().mockResolvedValue(undefined);
		const createResource = vi.fn().mockReturnValue({
			database: { id: "database-one" },
			dispose,
		});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		const first = await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		const second = await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});

		expect(first).toBe(second);
		expect(createResource).toHaveBeenCalledOnce();
		expect(dispose).not.toHaveBeenCalled();
	});

	it("creates the new revision and disposes the replaced resource", async () => {
		const firstDispose = vi.fn().mockResolvedValue(undefined);
		const secondDispose = vi.fn().mockResolvedValue(undefined);
		const createResource = vi
			.fn()
			.mockReturnValueOnce({
				database: { id: "database-one" },
				dispose: firstDispose,
			})
			.mockReturnValueOnce({
				database: { id: "database-two" },
				dispose: secondDispose,
			});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		const database = await factory.get({
			revision: "revision-two",
			databaseUrl: "postgresql://database-two",
			updatedAt: secondUpdatedAt,
		});

		expect(database).toEqual({ id: "database-two" });
		expect(firstDispose).toHaveBeenCalledOnce();
		expect(factory.getActiveRevision()).toBe("revision-two");

		await factory.dispose();
		expect(secondDispose).toHaveBeenCalledOnce();
		expect(factory.getActiveRevision()).toBeNull();
	});

	it("serializes concurrent activation of the same revision", async () => {
		let releaseCreation: (() => void) | undefined;
		const creationGate = new Promise<void>((resolve) => {
			releaseCreation = resolve;
		});
		const createResource = vi.fn().mockImplementation(async () => {
			await creationGate;
			return {
				database: { id: "database-one" },
				dispose: vi.fn().mockResolvedValue(undefined),
			};
		});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		const first = factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		const second = factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		releaseCreation?.();

		expect(await first).toBe(await second);
		expect(createResource).toHaveBeenCalledOnce();
	});

	it("rejects a database URL change that reuses a revision", async () => {
		const factory = new RevisionAwareDatabaseFactory(() => ({
			database: { id: "database-one" },
			dispose: vi.fn().mockResolvedValue(undefined),
		}));

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});

		await expect(
			factory.get({
				revision: "revision-one",
				databaseUrl: "postgresql://database-two",
				updatedAt: firstUpdatedAt,
			}),
		).rejects.toBeInstanceOf(DatabaseRevisionConflictError);
	});

	it("refuses a stale revision after a concurrent newer activation", async () => {
		let releaseCreation: (() => void) | undefined;
		const creationGate = new Promise<void>((resolve) => {
			releaseCreation = resolve;
		});
		const createResource = vi
			.fn()
			.mockReturnValueOnce({
				database: { id: "database-one" },
				dispose: vi.fn().mockResolvedValue(undefined),
			})
			.mockImplementationOnce(async () => {
				await creationGate;
				return {
					database: { id: "database-two" },
					dispose: vi.fn().mockResolvedValue(undefined),
				};
			});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});

		const newer = factory.get({
			revision: "revision-two",
			databaseUrl: "postgresql://database-two",
			updatedAt: secondUpdatedAt,
		});
		const stale = factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		releaseCreation?.();

		await expect(newer).resolves.toEqual({ id: "database-two" });
		await expect(stale).rejects.toBeInstanceOf(
			DatabaseRevisionOrderError,
		);
		expect(createResource).toHaveBeenCalledTimes(2);
		expect(factory.getActiveRevision()).toBe("revision-two");
	});

	it("serves the active revision behind a rejected stale transition", async () => {
		const activeDatabase = { id: "database-two" };
		const createResource = vi.fn().mockReturnValue({
			database: activeDatabase,
			dispose: vi.fn().mockResolvedValue(undefined),
		});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		await factory.get({
			revision: "revision-two",
			databaseUrl: "postgresql://database-two",
			updatedAt: secondUpdatedAt,
		});

		const stale = factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		const active = factory.get({
			revision: "revision-two",
			databaseUrl: "postgresql://database-two",
			updatedAt: secondUpdatedAt,
		});

		await expect(stale).rejects.toBeInstanceOf(
			DatabaseRevisionOrderError,
		);
		await expect(active).resolves.toBe(activeDatabase);
		expect(createResource).toHaveBeenCalledOnce();
	});

	it("does not block the new revision while the old pool drains", async () => {
		let releaseDisposal: (() => void) | undefined;
		const disposalGate = new Promise<void>((resolve) => {
			releaseDisposal = resolve;
		});
		const firstDispose = vi.fn(() => disposalGate);
		const createResource = vi
			.fn()
			.mockReturnValueOnce({
				database: { id: "database-one" },
				dispose: firstDispose,
			})
			.mockReturnValueOnce({
				database: { id: "database-two" },
				dispose: vi.fn().mockResolvedValue(undefined),
			});
		const factory = new RevisionAwareDatabaseFactory(createResource);

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});

		await expect(
			factory.get({
				revision: "revision-two",
				databaseUrl: "postgresql://database-two",
				updatedAt: secondUpdatedAt,
			}),
		).resolves.toEqual({ id: "database-two" });
		expect(firstDispose).toHaveBeenCalledOnce();

		releaseDisposal?.();
	});

	it("reports replaced-pool disposal failures without rejecting activation", async () => {
		const disposalError = new Error("pool failed to close");
		const onDisposeError = vi.fn();
		const createResource = vi
			.fn()
			.mockReturnValueOnce({
				database: { id: "database-one" },
				dispose: vi.fn().mockRejectedValue(disposalError),
			})
			.mockReturnValueOnce({
				database: { id: "database-two" },
				dispose: vi.fn().mockResolvedValue(undefined),
			});
		const factory = new RevisionAwareDatabaseFactory(createResource, {
			onDisposeError,
		});

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});
		await expect(
			factory.get({
				revision: "revision-two",
				databaseUrl: "postgresql://database-two",
				updatedAt: secondUpdatedAt,
			}),
		).resolves.toEqual({ id: "database-two" });
		await vi.waitFor(() => {
			expect(onDisposeError).toHaveBeenCalledWith(disposalError);
		});
	});

	it("disposes the active resource after a failed transition", async () => {
		let rejectCreation: ((error: Error) => void) | undefined;
		const creationGate = new Promise<never>((_resolve, reject) => {
			rejectCreation = reject;
		});
		const activeDispose = vi.fn().mockResolvedValue(undefined);
		const createResource = vi
			.fn()
			.mockReturnValueOnce({
				database: { id: "database-one" },
				dispose: activeDispose,
			})
			.mockImplementationOnce(() => creationGate);
		const factory = new RevisionAwareDatabaseFactory(createResource);

		await factory.get({
			revision: "revision-one",
			databaseUrl: "postgresql://database-one",
			updatedAt: firstUpdatedAt,
		});

		const failedTransition = factory.get({
			revision: "revision-two",
			databaseUrl: "postgresql://database-two",
			updatedAt: secondUpdatedAt,
		});
		const disposal = factory.dispose();
		const creationError = new Error("database creation failed");
		rejectCreation?.(creationError);

		await expect(failedTransition).rejects.toBe(creationError);
		await expect(disposal).resolves.toBeUndefined();
		expect(activeDispose).toHaveBeenCalledOnce();
		expect(factory.getActiveRevision()).toBeNull();
	});
});
