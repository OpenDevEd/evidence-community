import type { LibraryServerConfig } from "@/config/library-config/schema";
import { OpenScholarServiceError, postToOpenScholar } from "@/lib/openscholar-service";

type ZenodoConfig = Pick<LibraryServerConfig, "services"> & Partial<Pick<LibraryServerConfig, "authentication">>;

/** A token renewed this close to its end is asked for again. */
const RENEW_MS = 5 * 60 * 1000;

/** The connected account's current token, kept until it nears its end: one per runtime, as one account is used. */
let held: { accessToken: string; expiresAt: number } | null = null;

/** Thrown when the community owner's Zenodo account, connected on Openscholar, can't be used now. */
export class ZenodoReconnectError extends Error {
	constructor() {
		super("The Zenodo account this community archives in isn't connected on Openscholar any more. Its owner connects it again on Openscholar's Settings > Connections, then publishing tries again.");
		this.name = "ZenodoReconnectError";
	}
}

/**
 * The token a Zenodo request is made with: the one in the configuration, or, for a community that archives in its
 * owner's own account (`account: "openscholar"`), the account's current token, which Openscholar keeps and renews
 * (Openscholar #1237) and gives this community for its machine credential.
 */
export async function zenodoToken(config: ZenodoConfig, options: { fetch?: typeof fetch; now?: () => number } = {}): Promise<string> {
	const zenodo = config.services.publication.zenodo;
	if (!zenodo.enabled) throw new Error("Zenodo publishing is not fully configured");
	if (zenodo.account === "token") {
		if (!zenodo.token) throw new Error("Zenodo publishing is not fully configured");
		return zenodo.token;
	}
	const now = (options.now ?? Date.now)();
	if (held && held.expiresAt - now > RENEW_MS) return held.accessToken;
	const service = config.authentication?.openScholar;
	if (!service) throw new Error("Zenodo publishing through Openscholar needs this community's Openscholar connection");
	const answer = (await postToOpenScholar(service, "/api/v1/evidence-libraries/zenodo-token", {}, { fetch: options.fetch }).catch((error: unknown) => {
		if (error instanceof OpenScholarServiceError && error.status === 409) throw new ZenodoReconnectError();
		throw error;
	})) as { accessToken?: unknown; expiresAt?: unknown };
	if (typeof answer.accessToken !== "string" || typeof answer.expiresAt !== "number") throw new Error("Openscholar answered without a Zenodo token");
	held = { accessToken: answer.accessToken, expiresAt: answer.expiresAt };
	return held.accessToken;
}

/** Forgets the token held, for a test. */
export const forgetZenodoToken = () => {
	held = null;
};
