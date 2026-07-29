export type SourceCredentialResolver = (
	reference: string,
) => Promise<string | null>;

export class SourceCredentialNotFoundError extends Error {
	constructor(reference: string) {
		super(`Source credential was not found: ${reference}`);
		this.name = "SourceCredentialNotFoundError";
	}
}

export function createEnvironmentCredentialResolver(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): SourceCredentialResolver {
	return async (reference) => {
		const prefix = "env:";
		if (!reference.startsWith(prefix)) {
			throw new SourceCredentialNotFoundError(reference);
		}
		const name = reference.slice(prefix.length);
		if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
			throw new SourceCredentialNotFoundError(reference);
		}
		return environment[name] ?? null;
	};
}
