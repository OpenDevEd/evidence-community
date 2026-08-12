import { eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { doiNamespace } from "@/db/schema/publication";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AllocateManagedCrossrefDoiInput = {
	environment: "test";
	prefix: string;
	suffixNamespace: string;
};

export class DoiNamespaceConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DoiNamespaceConfigurationError";
	}
}

function validateInput(input: AllocateManagedCrossrefDoiInput) {
	if (!/^10\.\d{4,9}$/u.test(input.prefix)) {
		throw new DoiNamespaceConfigurationError(
			"The configured Crossref prefix is not valid",
		);
	}
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.suffixNamespace)) {
		throw new DoiNamespaceConfigurationError(
			"The configured DOI suffix namespace is not valid",
		);
	}
}

export async function allocateManagedCrossrefDoi(
	transaction: Transaction,
	input: AllocateManagedCrossrefDoiInput,
) {
	validateInput(input);

	await transaction
		.insert(doiNamespace)
		.values({
			environment: input.environment,
			prefix: input.prefix,
			suffixNamespace: input.suffixNamespace,
		})
		.onConflictDoNothing();

	const [stored] = await transaction
		.select()
		.from(doiNamespace)
		.where(eq(doiNamespace.environment, input.environment))
		.for("update");

	if (!stored) {
		throw new Error("The DOI namespace row could not be created");
	}

	if (
			stored.prefix !== input.prefix ||
			stored.suffixNamespace !== input.suffixNamespace
	) {
			if (stored.nextSequence !== 1) {
				throw new DoiNamespaceConfigurationError(
					"The DOI prefix or suffix namespace cannot change after the first DOI is reserved",
				);
			}

		await transaction
			.update(doiNamespace)
			.set({
				prefix: input.prefix,
				suffixNamespace: input.suffixNamespace,
				updatedAt: new Date(),
			})
			.where(eq(doiNamespace.environment, input.environment));
	}

	await transaction
		.update(doiNamespace)
		.set({
			nextSequence: stored.nextSequence + 1,
			updatedAt: new Date(),
		})
		.where(eq(doiNamespace.environment, input.environment));

	const sequence = String(stored.nextSequence).padStart(6, "0");
	return `${input.prefix}/${input.suffixNamespace}${sequence}`;
}
