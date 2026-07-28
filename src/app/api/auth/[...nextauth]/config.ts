import { getDatabase } from "@/db";
import { userCollection } from "@/db/schema/tables/userCollection";
import { authorize, getProfile } from "@/lib/actions";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { InferSelectModel } from "drizzle-orm";
import NextAuth, { CredentialsSignin, NextAuthConfig, User } from "next-auth";
import { encode as defaultEncode } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";

export const credentialsSchema = z.object({
	email: z.string().email({
		message: "invalidEmail"
	}),
	password: z.string().min(8, {
		message: "invalidPassword"
	}),
	register: z
		.union([z.boolean(), z.string()])
		.optional()
		.transform((value) => {
			if (typeof value === 'boolean') return value;
			return value === 'true';
		}),
});

declare module "next-auth" {
	interface Session {
		user: {
			likes: {
				[key: string]: Date;
			};
			following: {
				[key: string]: Date;
			};
			followers: {
				[key: string]: Date;
			};
			collections: InferSelectModel<typeof userCollection>[];
			id: string;
			createdAt?: Date;
			itemsCollections: {
				[key: string]: {
					[key: string]: Date;
				};
			};
		} & User;
	}
}

export class InvalidLoginError extends CredentialsSignin {
	constructor(message: string) {
		super(message);
		this.message = message;
	}
	message: string;
}

export async function getAuthOptions(): Promise<NextAuthConfig> {
	const adapter = DrizzleAdapter(await getDatabase());

	return {
		trustHost: true,
		adapter,
		providers: [
			Google,
			CredentialsProvider({
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
					const user = await authorize(
						credentials as z.infer<typeof credentialsSchema>,
					);
					if ("error" in user) {
						return null;
					}
					return user;
				},
			}),
		],
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
				const updatedUser = await getProfile(user.id, session);
				session.user = updatedUser;
				return session;
			},
		},
		jwt: {
			encode: async function (params) {
				if (params.token?.credentials) {
					const sessionToken = crypto.randomUUID();

					if (!params.token.sub) {
						throw new Error("No user ID found in token");
					}

					const createdSession = await adapter.createSession?.({
						sessionToken,
						userId: params.token.sub,
						expires: new Date(
							Date.now() + 30 * 24 * 60 * 60 * 1000,
						),
					});

					if (!createdSession) {
						throw new Error("Failed to create session");
					}

					return sessionToken;
				}
				return defaultEncode(params);
			},
		},
	};
}

export const { auth, handlers, signIn, signOut } = NextAuth(
	getAuthOptions,
);
