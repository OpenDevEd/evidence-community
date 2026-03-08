import type { CompanyFooter } from "@/db/schema/tables/status";
import { db } from "@/db";
import { status as statusTable } from "@/db/schema/tables/status";
import posthogClient from "@/lib/posthog";
import {
	EMPTY_FEATURE_FLAGS,
	type RuntimeFeatureFlags,
	type RuntimeFeatureFlagValue,
} from "@/lib/feature-flags";
import { eq, sql } from "drizzle-orm";

const FEATURE_FLAGS_REVALIDATE_MS = 5 * 60 * 1000;
const FEATURE_FLAGS_LOCK_NAMESPACE = 9062026;

type RuntimeFeatureFlagsState = {
	flags: RuntimeFeatureFlags;
	updatedAt: number;
};

function getFeatureFlagsScope() {
	const rawScope =
		process.env.BASE_URL?.trim() ||
		process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() ||
		"default";

	try {
		return new URL(rawScope).host || rawScope;
	} catch {
		return rawScope;
	}
}

function getFeatureFlagsDistinctId() {
	return `runtime-feature-flags:${getFeatureFlagsScope()}`;
}

function getFeatureFlagsLockKey() {
	const scope = getFeatureFlagsScope();
	let hash = 0;

	for (const character of scope) {
		hash = (hash * 31 + character.charCodeAt(0)) | 0;
	}

	return Math.abs(hash) || 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeFeatureFlagValue(
	value: unknown
): value is RuntimeFeatureFlagValue {
	return typeof value === "boolean" || typeof value === "string";
}

export function sanitizeFeatureFlags(value: unknown): RuntimeFeatureFlags {
	if (!isPlainObject(value)) {
		return EMPTY_FEATURE_FLAGS;
	}

	return Object.fromEntries(
		Object.entries(value).filter(([, flagValue]) =>
			isRuntimeFeatureFlagValue(flagValue)
		)
	) as RuntimeFeatureFlags;
}

export function parseRuntimeFeatureFlagsState(
	value: string | null | undefined
) {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as {
			flags?: unknown;
			updatedAt?: unknown;
		};
		const flags = sanitizeFeatureFlags(parsed.flags);
		const updatedAt =
			typeof parsed.updatedAt === "number" ? parsed.updatedAt : Number.NaN;

		if (Object.keys(flags).length === 0 || !Number.isFinite(updatedAt)) {
			return null;
		}

		return {
			flags,
			updatedAt,
		} satisfies RuntimeFeatureFlagsState;
	} catch {
		return null;
	}
}

export function serializeRuntimeFeatureFlagsState(
	state: RuntimeFeatureFlagsState
) {
	return JSON.stringify(state);
}

export function readStoredRuntimeFeatureFlags(
	companyFooter: CompanyFooter | null | undefined
): RuntimeFeatureFlags {
	return (
		parseRuntimeFeatureFlagsState(companyFooter?.featureFlagsState)?.flags ??
		EMPTY_FEATURE_FLAGS
	);
}

async function tryAcquireFeatureFlagsRefreshLock() {
	const result = await db.execute<{ locked: boolean }>(
		sql`select pg_try_advisory_lock(${FEATURE_FLAGS_LOCK_NAMESPACE}, ${getFeatureFlagsLockKey()}) as locked`
	);

	return Boolean(result.rows[0]?.locked);
}

async function releaseFeatureFlagsRefreshLock() {
	await db.execute(
		sql`select pg_advisory_unlock(${FEATURE_FLAGS_LOCK_NAMESPACE}, ${getFeatureFlagsLockKey()})`
	);
}

async function fetchFeatureFlagsFromPostHog() {
	if (
		!process.env.NEXT_PUBLIC_POSTHOG_HOST ||
		!process.env.NEXT_PUBLIC_POSTHOG_KEY
	) {
		return EMPTY_FEATURE_FLAGS;
	}

	const response = await posthogClient.getAllFlagsAndPayloads(
		getFeatureFlagsDistinctId()
	);

	return sanitizeFeatureFlags(response?.featureFlags);
}

async function getFeatureFlagsStatusRecord() {
	return db.query.status.findFirst({
		columns: {
			id: true,
			companyFooter: true,
		},
	});
}

function isFeatureFlagsStateFresh(state: RuntimeFeatureFlagsState | null) {
	return Boolean(
		state && state.updatedAt >= Date.now() - FEATURE_FLAGS_REVALIDATE_MS
	);
}

export async function syncRuntimeFeatureFlags() {
	const scope = getFeatureFlagsScope();
	const status = await getFeatureFlagsStatusRecord();

	if (!status) {
		return {
			flags: EMPTY_FEATURE_FLAGS,
			refreshed: false,
			reason: "missing-status" as const,
		};
	}

	const storedState = parseRuntimeFeatureFlagsState(
		status.companyFooter?.featureFlagsState
	);

	if (storedState && isFeatureFlagsStateFresh(storedState)) {
		return {
			flags: storedState.flags,
			refreshed: false,
			reason: "fresh" as const,
		};
	}

	const hasLock = await tryAcquireFeatureFlagsRefreshLock();

	if (!hasLock) {
		console.info("Feature flag sync lock not acquired", { scope });
		return {
			flags: storedState?.flags ?? EMPTY_FEATURE_FLAGS,
			refreshed: false,
			reason: "lock-not-acquired" as const,
		};
	}

	console.info("Feature flag sync lock acquired", { scope });

	try {
		const freshFlags = await fetchFeatureFlagsFromPostHog();

		if (Object.keys(freshFlags).length === 0) {
			console.warn("Feature flag sync skipped due to empty response", {
				scope,
			});
			return {
				flags: storedState?.flags ?? EMPTY_FEATURE_FLAGS,
				refreshed: false,
				reason: "empty-response" as const,
			};
		}

		await db
			.update(statusTable)
			.set({
				companyFooter: {
					...(status.companyFooter || {}),
					featureFlagsState: serializeRuntimeFeatureFlagsState({
						flags: freshFlags,
						updatedAt: Date.now(),
					}),
				},
				updatedAt: new Date(),
			})
			.where(eq(statusTable.id, status.id));

		console.info("Feature flag sync succeeded", {
			scope,
			count: Object.keys(freshFlags).length,
		});

		return {
			flags: freshFlags,
			refreshed: true,
			reason: "updated" as const,
		};
	} catch (error) {
		console.error("Feature flag sync failed", {
			scope,
			error,
		});
		return {
			flags: storedState?.flags ?? EMPTY_FEATURE_FLAGS,
			refreshed: false,
			reason: "error" as const,
		};
	} finally {
		await releaseFeatureFlagsRefreshLock();
	}
}
