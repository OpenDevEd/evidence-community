import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { readerAccount, readerSession, readerUser, readerVerification } from "@/db/schema/tables/reader";

import { openScholarDiscoveryUrl, openScholarReader, OPENSCHOLAR_PROVIDER_ID } from "./openscholar";

const DAY_SECONDS = 24 * 60 * 60;

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
		session: {
			expiresIn: 30 * DAY_SECONDS,
			updateAge: DAY_SECONDS,
			cookieCache: { enabled: true, maxAge: 5 * 60 },
		},
		// One reader per Clerk account: never attach another account to a reader.
		account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
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
						mapProfileToUser: openScholarReader,
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
