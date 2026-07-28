export type DatabaseResource<TDatabase> = {
	database: TDatabase;
	dispose: () => Promise<void>;
};

type ActiveDatabase<TDatabase> = {
	databaseUrl: string;
	resource: DatabaseResource<TDatabase>;
	revision: string;
	updatedAt: string;
	updatedAtMilliseconds: number;
};

export class DatabaseRevisionConflictError extends Error {
	constructor(revision: string) {
		super(
			`Database URL changed without a new configuration revision: ${revision}`,
		);
		this.name = "DatabaseRevisionConflictError";
	}
}

export class DatabaseRevisionOrderError extends Error {
	constructor({
		activeRevision,
		activeUpdatedAt,
		requestedRevision,
		requestedUpdatedAt,
	}: {
		activeRevision: string;
		activeUpdatedAt: string;
		requestedRevision: string;
		requestedUpdatedAt: string;
	}) {
		super(
			`Refused stale database configuration ${requestedRevision} (${requestedUpdatedAt}); active revision is ${activeRevision} (${activeUpdatedAt})`,
		);
		this.name = "DatabaseRevisionOrderError";
	}
}

type RevisionAwareDatabaseFactoryOptions = {
	onDisposeError?: (error: unknown) => void;
};

export class RevisionAwareDatabaseFactory<TDatabase> {
	readonly #createResource: (
		databaseUrl: string,
	) => DatabaseResource<TDatabase> | Promise<DatabaseResource<TDatabase>>;
	readonly #onDisposeError: (error: unknown) => void;
	#active: ActiveDatabase<TDatabase> | null = null;
	#transition: Promise<void> | null = null;

	constructor(
		createResource: (
			databaseUrl: string,
		) =>
			| DatabaseResource<TDatabase>
			| Promise<DatabaseResource<TDatabase>>,
		options: RevisionAwareDatabaseFactoryOptions = {},
	) {
		this.#createResource = createResource;
		this.#onDisposeError =
			options.onDisposeError ??
			((error) => {
				console.error("Failed to dispose replaced database pool", error);
			});
	}

	async get({
		databaseUrl,
		revision,
		updatedAt,
	}: {
		databaseUrl: string;
		revision: string;
		updatedAt: string;
	}): Promise<TDatabase> {
		while (true) {
			if (this.#transition) {
				try {
					await this.#transition;
				} catch {
					// The caller that started the transition receives its error.
					// Waiters re-evaluate their own revision against the active
					// resource instead of inheriting an unrelated failure.
				}
				continue;
			}

			const active = this.#active;
			if (active?.revision === revision) {
				if (active.databaseUrl !== databaseUrl) {
					throw new DatabaseRevisionConflictError(revision);
				}

				return active.resource.database;
			}

			const transition = this.#activate({
				databaseUrl,
				revision,
				updatedAt,
			});
			this.#transition = transition;
			try {
				await transition;
			} finally {
				if (this.#transition === transition) {
					this.#transition = null;
				}
			}
		}
	}

	getActiveRevision() {
		return this.#active?.revision ?? null;
	}

	async dispose() {
		if (this.#transition) {
			await this.#transition.catch(() => undefined);
		}

		const active = this.#active;
		this.#active = null;
		await active?.resource.dispose();
	}

	async #activate({
		databaseUrl,
		revision,
		updatedAt,
	}: {
		databaseUrl: string;
		revision: string;
		updatedAt: string;
	}) {
		const current = this.#active;
		if (current?.revision === revision) {
			if (current.databaseUrl !== databaseUrl) {
				throw new DatabaseRevisionConflictError(revision);
			}
			return;
		}

		const updatedAtMilliseconds = Date.parse(updatedAt);
		if (
			current &&
			updatedAtMilliseconds <= current.updatedAtMilliseconds
		) {
			throw new DatabaseRevisionOrderError({
				activeRevision: current.revision,
				activeUpdatedAt: current.updatedAt,
				requestedRevision: revision,
				requestedUpdatedAt: updatedAt,
			});
		}

		const resource = await this.#createResource(databaseUrl);
		const previous = this.#active;
		this.#active = {
			databaseUrl,
			resource,
			revision,
			updatedAt,
			updatedAtMilliseconds,
		};

		if (previous) {
			void previous.resource
				.dispose()
				.catch(this.#onDisposeError);
		}
	}
}
