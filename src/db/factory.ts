import { RevisionAwareResourceFactory } from "@/lib/revision-aware-resource";

export type DatabaseResource<TDatabase> = {
	database: TDatabase;
	dispose: () => Promise<void>;
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
	readonly #factory: RevisionAwareResourceFactory<string, TDatabase>;

	constructor(
		createResource: (
			databaseUrl: string,
		) =>
			| DatabaseResource<TDatabase>
			| Promise<DatabaseResource<TDatabase>>,
		options: RevisionAwareDatabaseFactoryOptions = {},
	) {
		this.#factory = new RevisionAwareResourceFactory(
			"database",
			async (databaseUrl) => {
				const resource = await createResource(databaseUrl);
				return {
					value: resource.database,
					dispose: resource.dispose,
				};
			},
			{
				createConflictError: (revision) =>
					new DatabaseRevisionConflictError(revision),
				createOrderError: (details) =>
					new DatabaseRevisionOrderError(details),
				onDisposeError:
					options.onDisposeError ??
					((error) => {
						console.error(
							"Failed to dispose replaced database pool",
							error,
						);
					}),
			},
		);
	}

	get({
		databaseUrl,
		revision,
		updatedAt,
	}: {
		databaseUrl: string;
		revision: string;
		updatedAt: string;
	}): Promise<TDatabase> {
		return this.#factory.get({
			configuration: databaseUrl,
			revision,
			updatedAt,
		});
	}

	getActiveRevision() {
		return this.#factory.getActiveRevision();
	}

	dispose() {
		return this.#factory.dispose();
	}
}
