import { DefaultSession, NextAuthOptions, Session } from "next-auth";
import { db } from "@/db";
import GoogleProvider from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, authenticators, sessions, verificationTokens, users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq } from "drizzle-orm";

declare module "next-auth" {
	interface Session {
		user: {
			likes: {
				[key: string]: Date;
			};
			id: string;
		} & DefaultSession["user"];
	}
}

const authOptions: NextAuthOptions = {
	adapter: DrizzleAdapter(db),
	providers: [
		GoogleProvider({
			clientId: process.env.GOOGLE_CLIENT_ID!,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
		}),
	],
	callbacks: {
		jwt: async ({ token, user }) => {
			if (user) {
				token.id = user.id;
			}
			return token;
		},
		session: async ({ session, user }: { session: any, user: any }) => {
			const likes = await db.query.usersToLikes.findMany({
				where: eq(usersToLikes.userId, user.id),
				columns: {
					itemKey: true,
					createdAt: true
				}
			});
			if (session.user) {
				session.user.likes = likes.reduce((acc, like) => {
					acc[like.itemKey] = like.createdAt;
					return acc;
				}, {} as Session["user"]["likes"]);
				session.user.id = user.id;
			}
			return session;
		},
	},
};

export default authOptions;