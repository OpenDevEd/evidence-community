import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { after } from "next/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { readerAccount, readerSession, readerUser, readerVerification } from "@/db/schema/tables/reader";

export const OPENSCHOLAR_PROVIDER_ID = "openscholar";
/** OpenScholar registers this callback for every origin of the library. */
export const OPENSCHOLAR_CALLBACK_PATH = `/api/auth/callback/${OPENSCHOLAR_PROVIDER_ID}`;

const DAY_SECONDS = 24 * 60 * 60;

type ProfileName = { name?: unknown; given_name?: unknown; family_name?: unknown };

/** Clerk sends no name for an account without one; the library then shows "Reader". */
export function openScholarProfileName(profile: ProfileName) {
	const parts = [profile.given_name, profile.family_name].filter(
		(part): part is string => typeof part === "string" && part.trim() !== "",
	);
	if (parts.length > 0) return parts.join(" ").trim();
	return typeof profile.name === "string" ? profile.name.trim() : "";
}

export function openScholarDiscoveryUrl(config: LibraryServerConfig) {
	return new URL("/.well-known/openid-configuration", config.authentication.openScholar.oauth.issuer).toString();
}

export function createReaderAuth(
	config: LibraryServerConfig,
	database: Database,
	onSessionRead?: (userId: string) => void,
) {
	const { oauth } = config.authentication.openScholar;
	return betterAuth({
		appName: config.identity.name,
		baseURL: config.identity.baseUrl,
		basePath: "/api/auth",
		secret: config.authentication.secret,
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: {
				user: readerUser,
				session: readerSession,
				account: readerAccount,
				verification: readerVerification,
			},
		}),
		user: {
			additionalFields: {
				clerkUserId: { type: "string", required: true, input: false },
			},
		},
		session: {
			expiresIn: 30 * DAY_SECONDS,
			updateAge: DAY_SECONDS,
			cookieCache: { enabled: true, maxAge: 5 * 60 },
		},
		account: { encryptOAuthTokens: true },
		rateLimit: { enabled: true },
		advanced: { cookiePrefix: "evidence-library" },
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: OPENSCHOLAR_PROVIDER_ID,
						discoveryUrl: openScholarDiscoveryUrl(config),
						clientId: oauth.clientId,
						clientSecret: oauth.clientSecret,
						scopes: ["openid", "email", "profile", "offline_access"],
						pkce: true,
						overrideUserInfo: true,
						mapProfileToUser: (profile) => ({
							clerkUserId: String(profile.sub ?? profile.id ?? ""),
							name: openScholarProfileName(profile),
							image: typeof profile.picture === "string" ? profile.picture : undefined,
						}),
					},
				],
			}),
			nextCookies(),
		],
		hooks: {
			// Reading the session is when a reader is active, so it is when their
			// OpenScholar account gets checked. The check runs after the response.
			after: createAuthMiddleware(async (context) => {
				if (context.path !== "/get-session" || !onSessionRead) return;
				const userId = context.context.session?.user.id;
				if (userId) onSessionRead(userId);
			}),
		},
	});
}

export type ReaderAuth = ReturnType<typeof createReaderAuth>;

const instances = new WeakMap<LibraryServerConfig, Promise<{ auth: ReaderAuth; database: Database }>>();

/** One auth instance per active configuration revision. */
export async function getReaderAuthForConfig(config: LibraryServerConfig) {
	let instance = instances.get(config);
	if (!instance) {
		instance = (async () => {
			const database = await getDatabaseForConfig(config);
			const { checkReaderSoon } = await import("./check");
			const auth: ReaderAuth = createReaderAuth(config, database, (userId) =>
				after(() => checkReaderSoon({ auth, config, database, userId })),
			);
			return { auth, database };
		})();
		instances.set(config, instance);
		instance.catch(() => instances.delete(config));
	}
	return instance;
}

export async function getReaderAuth() {
	return getReaderAuthForConfig(await getLibraryConfig());
}
