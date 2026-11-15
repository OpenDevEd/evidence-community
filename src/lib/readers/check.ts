import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { readerAccount, readerUser } from "@/db/schema/tables/reader";

import type { ReaderAuth } from "./auth";
import { openScholarDiscoveryUrl, openScholarProfileName, OPENSCHOLAR_PROVIDER_ID } from "./openscholar";
import { deleteReaderByClerkUserId } from "./data";

/** A reader's OpenScholar account is checked at most this often while they are active. */
export const READER_CHECK_INTERVAL_MS = 15 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

const discoverySchema = z.object({ userinfo_endpoint: z.url() });
const discoveries = new Map<string, Promise<z.infer<typeof discoverySchema>>>();

function readDiscovery(config: LibraryServerConfig) {
	const url = openScholarDiscoveryUrl(config);
	let discovery = discoveries.get(url);
	if (!discovery) {
		discovery = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
			.then(async (response) => {
				if (!response.ok) throw new Error(`Openscholar discovery answered HTTP ${response.status}`);
				return discoverySchema.parse(await response.json());
			});
		discoveries.set(url, discovery);
		discovery.catch(() => discoveries.delete(url));
	}
	return discovery;
}

const userInfoSchema = z.object({
	sub: z.string().min(1),
	name: z.string().optional(),
	given_name: z.string().optional(),
	family_name: z.string().optional(),
	picture: z.string().optional(),
	email: z.string().optional(),
});

type ReaderCheck = { auth: ReaderAuth; config: LibraryServerConfig; database: Database; userId: string };

/** Refreshes the reader's Clerk token and copies their current name, avatar and email from OpenScholar. */
async function refreshReaderProfile({ auth, config, database, userId }: ReaderCheck, accountRowId: string) {
	const { accessToken } = await auth.api.getAccessToken({ body: { accountId: accountRowId, userId } });
	const { userinfo_endpoint } = await readDiscovery(config);
	const response = await fetch(userinfo_endpoint, {
		cache: "no-store",
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Openscholar user info answered HTTP ${response.status}`);
	const profile = userInfoSchema.parse(await response.json());
	await database
		.update(readerUser)
		.set({
			name: openScholarProfileName(profile),
			image: profile.picture ?? null,
			...(profile.email ? { contactEmail: profile.email } : {}),
			updatedAt: new Date(),
		})
		.where(eq(readerUser.id, userId));
}

const readerStatusSchema = z.object({ status: z.enum(["active", "deleted", "unknown"]) });

/** OpenScholar's answer about one Clerk account. Only "deleted" lets the library remove reader data. */
async function readOpenScholarReaderStatus(config: LibraryServerConfig, clerkUserId: string) {
	const { convexSiteUrl, libraryId, machineCredential } = config.authentication.openScholar;
	const response = await fetch(new URL("/api/v1/evidence-libraries/reader-status", convexSiteUrl), {
		method: "POST",
		cache: "no-store",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${machineCredential}` },
		body: JSON.stringify({ libraryId, clerkUserId }),
	});
	if (!response.ok) throw new Error(`Openscholar reader status answered HTTP ${response.status}`);
	return readerStatusSchema.parse(await response.json()).status;
}

/**
 * Tells OpenScholar the reader was here, so the library is among theirs there
 * (plans/evidence-library-sources in OpenScholar). A failure only logs: the
 * next check tells it again.
 */
async function reportReaderSeen(config: LibraryServerConfig, clerkUserId: string) {
	const { convexSiteUrl, libraryId, machineCredential } = config.authentication.openScholar;
	try {
		const response = await fetch(new URL("/api/v1/evidence-libraries/readers/seen", convexSiteUrl), {
			method: "POST",
			cache: "no-store",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${machineCredential}`, "OpenScholar-Contract": "1" },
			body: JSON.stringify({ libraryId, clerkUserId }),
		});
		if (!response.ok) console.warn("[library sources] Openscholar refused a reader report", { libraryId, clerkUserId, status: response.status });
	} catch (error) {
		console.warn("[library sources] could not report a reader to Openscholar", { libraryId, clerkUserId, error: String(error) });
	}
}

/** Tells OpenScholar a reader signed in, by the OpenScholar account they signed in with. */
export async function reportReaderSignIn({ config, database, userId }: Pick<ReaderCheck, "config" | "database" | "userId">) {
	const account = await database.query.readerAccount.findFirst({
		where: and(eq(readerAccount.userId, userId), eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID)),
		columns: { accountId: true },
	});
	if (account) await reportReaderSeen(config, account.accountId);
}

/**
 * Checks an active reader's OpenScholar account, at most once every 15
 * minutes per reader. Better Auth reports every refresh failure the same way,
 * so a failure asks OpenScholar whether the account still exists: a deleted
 * account signs the reader out and deletes their data here, while an
 * unreachable OpenScholar or Clerk keeps the session.
 */
export async function checkReaderSoon(check: ReaderCheck) {
	const { config, database, userId } = check;
	const [claimed] = await database
		.update(readerUser)
		.set({ checkedAt: new Date() })
		.where(and(eq(readerUser.id, userId), lt(readerUser.checkedAt, new Date(Date.now() - READER_CHECK_INTERVAL_MS))))
		.returning({ id: readerUser.id });
	if (!claimed) return;
	const account = await database.query.readerAccount.findFirst({
		where: and(eq(readerAccount.userId, userId), eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID)),
		columns: { id: true, accountId: true },
	});
	if (!account) return;
	const clerkUserId = account.accountId;
	await reportReaderSeen(config, clerkUserId);

	try {
		await refreshReaderProfile(check, account.id);
		return;
	} catch (refreshError) {
		try {
			const status = await readOpenScholarReaderStatus(config, clerkUserId);
			if (status === "deleted") {
				await deleteReaderByClerkUserId(database, clerkUserId);
				console.info("Removed a reader whose Openscholar account was deleted", { libraryId: config.authentication.openScholar.libraryId, clerkUserId: clerkUserId });
				return;
			}
			console.warn("Reader check could not refresh an active Openscholar account", { libraryId: config.authentication.openScholar.libraryId, clerkUserId: clerkUserId, status, error: String(refreshError) });
		} catch (statusError) {
			console.warn("Reader check could not reach Openscholar; the session stays", { libraryId: config.authentication.openScholar.libraryId, clerkUserId: clerkUserId, refreshError: String(refreshError), statusError: String(statusError) });
		}
	}
}
