export type RevisionAwareResource<TValue> = {
	value: TValue;
	dispose?: () => Promise<void>;
};

type ActiveResource<TConfiguration, TValue> = {
	configuration: TConfiguration;
	resource: RevisionAwareResource<TValue>;
	revision: string;
	updatedAt: string;
	updatedAtMilliseconds: number;
};

export class RevisionResourceConflictError extends Error {
	constructor(resourceName: string, revision: string) {
		super(
			`${resourceName} configuration changed without a new configuration revision: ${revision}`,
		);
		this.name = "RevisionResourceConflictError";
	}
}

export class RevisionResourceOrderError extends Error {
	constructor({
		activeRevision,
		activeUpdatedAt,
		requestedRevision,
		requestedUpdatedAt,
		resourceName,
	}: {
		activeRevision: string;
		activeUpdatedAt: string;
		requestedRevision: string;
		requestedUpdatedAt: string;
		resourceName: string;
	}) {
		super(
			`Refused stale ${resourceName} configuration ${requestedRevision} (${requestedUpdatedAt}); active revision is ${activeRevision} (${activeUpdatedAt})`,
		);
		this.name = "RevisionResourceOrderError";
	}
}

type RevisionAwareResourceFactoryOptions<TConfiguration> = {
	configurationEquals?: (
		left: TConfiguration,
		right: TConfiguration,
	) => boolean;
	createConflictError?: (revision: string) => Error;
	createOrderError?: (details: {
		activeRevision: string;
		activeUpdatedAt: string;
		requestedRevision: string;
		requestedUpdatedAt: string;
	}) => Error;
	onDisposeError?: (error: unknown) => void;
};

export class RevisionAwareResourceFactory<TConfiguration, TValue> {
	readonly #configurationEquals: (
		left: TConfiguration,
		right: TConfiguration,
	) => boolean;
	readonly #createConflictError: (revision: string) => Error;
	readonly #createOrderError: (
		details: {
			activeRevision: string;
			activeUpdatedAt: string;
			requestedRevision: string;
			requestedUpdatedAt: string;
		},
	) => Error;
	readonly #createResource: (
		configuration: TConfiguration,
	) =>
		| RevisionAwareResource<TValue>
		| Promise<RevisionAwareResource<TValue>>;
	readonly #onDisposeError: (error: unknown) => void;
	#active: ActiveResource<TConfiguration, TValue> | null = null;
	#transition: Promise<void> | null = null;

	constructor(
		resourceName: string,
		createResource: (
			configuration: TConfiguration,
		) =>
			| RevisionAwareResource<TValue>
			| Promise<RevisionAwareResource<TValue>>,
		options: RevisionAwareResourceFactoryOptions<TConfiguration> = {},
	) {
		this.#configurationEquals =
			options.configurationEquals ?? Object.is;
		this.#createConflictError =
			options.createConflictError ??
			((revision) =>
				new RevisionResourceConflictError(resourceName, revision));
		this.#createOrderError =
			options.createOrderError ??
			((details) =>
				new RevisionResourceOrderError({
					...details,
					resourceName,
				}));
		this.#createResource = createResource;
		this.#onDisposeError =
			options.onDisposeError ??
			((error) => {
				console.error(
					`Failed to dispose replaced ${resourceName} resource`,
					error,
				);
			});
	}

	async get({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: TConfiguration;
		revision: string;
		updatedAt: string;
	}): Promise<TValue> {
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
				if (
					!this.#configurationEquals(
						active.configuration,
						configuration,
					)
				) {
					throw this.#createConflictError(revision);
				}

				return active.resource.value;
			}

			const transition = this.#activate({
				configuration,
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
		await active?.resource.dispose?.();
	}

	async #activate({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: TConfiguration;
		revision: string;
		updatedAt: string;
	}) {
		const current = this.#active;
		if (current?.revision === revision) {
			if (
				!this.#configurationEquals(
					current.configuration,
					configuration,
				)
			) {
				throw this.#createConflictError(revision);
			}
			return;
		}

		const updatedAtMilliseconds = Date.parse(updatedAt);
		if (
			current &&
			updatedAtMilliseconds <= current.updatedAtMilliseconds
		) {
			throw this.#createOrderError({
				activeRevision: current.revision,
				activeUpdatedAt: current.updatedAt,
				requestedRevision: revision,
				requestedUpdatedAt: updatedAt,
			});
		}

		const resource = await this.#createResource(configuration);
		const previous = this.#active;
		this.#active = {
			configuration,
			resource,
			revision,
			updatedAt,
			updatedAtMilliseconds,
		};

		if (previous?.resource.dispose) {
			void previous.resource
				.dispose()
				.catch(this.#onDisposeError);
		}
	}
}
