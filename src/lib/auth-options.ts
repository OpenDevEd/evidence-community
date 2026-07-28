import "server-only";

import { randomBytes } from "node:crypto";
import type { Adapter } from "next-auth/adapters";
import type { NextAuthConfig, Session, User } from "next-auth";
import { encode as defaultEncode } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { CredentialsInput } from "@/lib/auth-credentials";

type RuntimeAuthDependencies = {
	adapter: Adapter;
	authorize: (
		credentials: CredentialsInput,
	) => Promise<User | null>;
	getProfile: (
		userId: string,
		session: Session,
	) => Promise<Session["user"]>;
};

const DISABLED_AUTH_SECRET = randomBytes(32).toString("base64url");

function assertRuntimeAuthOriginIsUnambiguous() {
	const conflictingVariables = [
		"AUTH_URL",
		"NEXTAUTH_URL",
	].filter((name) => process.env[name]);

	if (conflictingVariables.length > 0) {
		throw new Error(
			`${conflictingVariables.join(", ")} must be removed; configure the authentication origin with identity.baseUrl`,
		);
	}
}

export function buildAuthOptions(
	config: LibraryServerConfig,
	dependencies?: RuntimeAuthDependencies,
): NextAuthConfig {
	assertRuntimeAuthOriginIsUnambiguous();

	if (!config.features.login) {
		return {
			trustHost: true,
			secret: DISABLED_AUTH_SECRET,
			providers: [],
		};
	}

	if (!dependencies) {
		throw new Error(
			"Enabled login requires runtime authentication dependencies",
		);
	}

	const { adapter } = dependencies;
	const providers: NextAuthConfig["providers"] = [
		...(config.authentication.google.enabled
			? [
					Google({
						clientId:
							config.authentication.google.clientId!,
						clientSecret:
							config.authentication.google.clientSecret!,
					}),
				]
			: []),
		Credentials({
			name: "Credentials",
			credentials: {
				email: {
					label: "Email",
					type: "text",
				},
				password: { label: "Password", type: "password" },
				register: { label: "Register", type: "boolean" },
			},
			type: "credentials",
			async authorize(credentials) {
				return dependencies.authorize(
					credentials as CredentialsInput,
				);
			},
		}),
	];

	return {
		trustHost: true,
		secret: config.authentication.secret!,
		adapter,
		providers,
		callbacks: {
			jwt: async ({ token, user, account }) => {
				if (account?.provider === "credentials") {
					token.credentials = true;
				}
				if (user) {
					token.id = user.id;
				}
				return token;
			},
			session: async ({ session, user }: { session: any; user: any }) => {
				session.user = await dependencies.getProfile(
					user.id,
					session,
				);
				return session;
			},
		},
		jwt: {
			encode: async (params) => {
				if (params.token?.credentials) {
					const sessionToken = crypto.randomUUID();

					if (!params.token.sub) {
						throw new Error("No user ID found in token");
					}

					const createdSession =
						await adapter.createSession?.({
							sessionToken,
							userId: params.token.sub,
							expires: new Date(
								Date.now() +
									30 * 24 * 60 * 60 * 1000,
							),
						});

					if (!createdSession) {
						throw new Error(
							"Failed to create session",
						);
					}

					return sessionToken;
				}
				return defaultEncode(params);
			},
		},
	};
}
