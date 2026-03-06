import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema/tables/user";

type LocalUser = typeof users.$inferSelect;

function buildName(firstName: string | null, lastName: string | null, username: string | null) {
	const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
	if (fullName.length > 0) {
		return fullName;
	}
	return username ?? null;
}

function getPrimaryEmailAddress(clerkUser: Awaited<ReturnType<typeof currentUser>>) {
	if (!clerkUser) {
		return null;
	}

	const primaryEmailId = clerkUser.primaryEmailAddressId;
	if (primaryEmailId) {
		const primary = clerkUser.emailAddresses.find((email) => email.id === primaryEmailId);
		if (primary?.emailAddress) {
			return primary.emailAddress;
		}
	}

	return clerkUser.emailAddresses[0]?.emailAddress ?? null;
}

async function findUserByClerkAccount(clerkUserId: string) {
	const account = await db.query.accounts.findFirst({
		where: and(eq(accounts.provider, "clerk"), eq(accounts.providerAccountId, clerkUserId)),
	});

	if (!account) {
		return null;
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, account.userId),
	});
	return user ?? null;
}

async function findUserByEmail(email: string) {
	const user = await db.query.users.findFirst({
		where: eq(users.email, email),
	});
	return user ?? null;
}

async function createLocalUserFromClerk(email: string) {
	const clerkUser = await currentUser();
	if (!clerkUser) {
		return null;
	}

	const name = buildName(clerkUser.firstName, clerkUser.lastName, clerkUser.username);
	try {
		const [createdUser] = await db
			.insert(users)
			.values({
				email,
				name,
				image: clerkUser.imageUrl,
			})
			.returning();

		return createdUser ?? null;
	} catch {
		// Handle concurrent sign-ins racing on unique email.
		return findUserByEmail(email);
	}
}

async function ensureClerkAccountLink(userId: string, clerkUserId: string) {
	await db
		.insert(accounts)
		.values({
			userId,
			type: "oauth",
			provider: "clerk",
			providerAccountId: clerkUserId,
		})
		.onConflictDoNothing();
}

export async function getAuthenticatedDbUser(): Promise<LocalUser | null> {
	const { userId: clerkUserId } = await auth();
	if (!clerkUserId) {
		return null;
	}

	const linkedUser = await findUserByClerkAccount(clerkUserId);
	if (linkedUser) {
		return linkedUser;
	}

	const clerkUser = await currentUser();
	const email = getPrimaryEmailAddress(clerkUser);
	if (!email) {
		return null;
	}

	let localUser = await findUserByEmail(email);
	if (!localUser) {
		localUser = await createLocalUserFromClerk(email);
	}

	if (!localUser) {
		return null;
	}

	await ensureClerkAccountLink(localUser.id, clerkUserId);
	return localUser;
}
