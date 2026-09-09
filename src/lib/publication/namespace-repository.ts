import { eq, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "@/db/database-schema";
import { doiNamespace, publicationIdentifier } from "@/db/schema/publication";

export type AllocateManagedCrossrefDoiInput = {
	environment: "test" | "production";
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
	transaction: DatabaseTransaction,
	input: AllocateManagedCrossrefDoiInput,
) {
	validateInput(input);
	await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`doi-namespace:${input.prefix}/${input.suffixNamespace}`}, 0))`);

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

	let sequence = stored.nextSequence;
	let doi: string;
	while (true) {
		doi = `${input.prefix}/${input.suffixNamespace}${String(sequence).padStart(6, "0")}`;
		const [existing] = await transaction.select({ id: publicationIdentifier.id })
			.from(publicationIdentifier).where(eq(publicationIdentifier.doi, doi)).limit(1);
		if (!existing) break;
		sequence += 1;
	}
	await transaction.update(doiNamespace).set({nextSequence: sequence + 1, updatedAt: new Date()})
		.where(eq(doiNamespace.environment, input.environment));
	return doi;
}
