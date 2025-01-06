import { DefaultSession, NextAuthOptions, Session } from "next-auth";
import { db } from "@/db";
import GoogleProvider from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, authenticators, sessions, users, verificationTokens } from "@/db/schema/tables/user";
import { encode as defaultEncode } from "next-auth/jwt";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, InferSelectModel } from "drizzle-orm";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcrypt";
import { fromError } from "zod-validation-error";
import { getProfile } from "@/lib/actions";
import { userCollection } from "@/db/schema/tables/userCollection";

export const credentialsSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	register: z
		.string()
		.optional()
		.transform((value) => value === "true"),
});

export const getUser = async (email: string) => {
	return await db.query.users.findFirst({
		where: eq(users.email, email),
	});
};

export const createUser = async (email: string, password: string) => {
	const hashedPassword = await bcrypt.hash(password, 10);
	const [newUser] = await db
		.insert(users)
		.values({
			email,
			password: hashedPassword,
		})
		.returning();
	return newUser;
};

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
		} & DefaultSession["user"];
	}
}

const adapter = DrizzleAdapter(db);

const authOptions: NextAuthOptions = {
	adapter,
	providers: [
		GoogleProvider({
			clientId: process.env.GOOGLE_CLIENT_ID!,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
		}),
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
			async authorize(credentials, req) {
				console.log("Authorizing credentials", credentials);
		
				const parsedCredentials =
					credentialsSchema.safeParse(credentials);
					
				console.log("Parsed credentials", parsedCredentials);

				if (!parsedCredentials.success)
					throw new Error(
						fromError(parsedCredentials.error).toString()
					);

				const { email, password, register } = parsedCredentials.data;

				const existingUser = await getUser(email);

				if (register && existingUser)
					throw new Error("User already exists");

				if (!existingUser && register)
					return await createUser(email, password);

				if (existingUser) {
					const passwordsMatch = await bcrypt.compare(
						password,
						existingUser.password ?? ""
					);
					if (passwordsMatch) return existingUser;
				}

				throw new Error("Invalid credentials");
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

				const createdSession = await adapter?.createSession?.({
					sessionToken: sessionToken,
					userId: params.token.sub,
					expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

export default authOptions;
