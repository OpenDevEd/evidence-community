import { ZENODO_POLICY_LOCKED_MESSAGE } from "./identifier-policy";

export class PublicationItemNotFoundError extends Error {
	constructor(itemKey: string) {
		super(`Item ${itemKey} was not found`);
		this.name = "PublicationItemNotFoundError";
	}
}

export class CrossrefActivationConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CrossrefActivationConfigurationError";
	}
}

export class CrossrefActivationValidationError extends Error {
	readonly fields: Readonly<Record<string, string>>;

	constructor(
		message: string,
		fields: Readonly<Record<string, string>> = {},
	) {
		super(message);
		this.name = "CrossrefActivationValidationError";
		this.fields = fields;
	}
}

export class CrossrefDoiConflictError extends CrossrefActivationValidationError {
	constructor(conflicts: readonly { source: string; doi: string }[]) {
		super(
			"This record contains different DOI values. Make them match first.",
			{
				DOI: conflicts
					.map(({ source, doi }) => `${source}: ${doi}`)
					.join("; "),
			},
		);
		this.name = "CrossrefDoiConflictError";
	}
}

export class ExternalCrossrefDoiError extends Error {
	readonly doi: string;

	constructor(doi: string) {
		super(
			`This record already uses ${doi}, but this library did not reserve it. Crossref activation is unavailable.`,
		);
		this.name = "ExternalCrossrefDoiError";
		this.doi = doi;
	}
}

export class CrossrefDoiAlreadyManagedError extends Error {
	constructor(doi: string, itemKey: string) {
		super(`DOI ${doi} is already managed by record ${itemKey}.`);
		this.name = "CrossrefDoiAlreadyManagedError";
	}
}

export class ZenodoActivationConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZenodoActivationConfigurationError";
	}
}

export class ZenodoActivationValidationError extends Error {
	readonly fields: Readonly<Record<string, string>>;

	constructor(
		message: string,
		fields: Readonly<Record<string, string>> = {},
	) {
		super(message);
		this.name = "ZenodoActivationValidationError";
		this.fields = fields;
	}
}

export class ZenodoIdentifierPolicyLockedError extends Error {
	constructor() {
		super(ZENODO_POLICY_LOCKED_MESSAGE);
		this.name = "ZenodoIdentifierPolicyLockedError";
	}
}
