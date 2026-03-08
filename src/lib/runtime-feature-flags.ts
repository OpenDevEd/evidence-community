import "server-only";

import { getStatusDirect } from "@/app/api/cache";
import { db } from "@/db";
import {
	type CompanyFooter,
	status as statusTable,
} from "@/db/schema/tables/status";
import posthogClient from "@/lib/posthog";
import {
	EMPTY_FEATURE_FLAGS,
	type RuntimeFeatureFlags,
	type RuntimeFeatureFlagValue,
} from "@/lib/feature-flags";
import { eq, sql } from "drizzle-orm";

const FEATURE_FLAGS_REVALIDATE_MS = 5 * 60 * 1000;
const FEATURE_FLAGS_LOCK_NAMESPACE = 9062026;
const featureFlagRefreshAttempts = new Map<string, number>();

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

function getLastFeatureFlagRefreshAttempt(scope: string) {
	return featureFlagRefreshAttempts.get(scope) ?? 0;
}

function markFeatureFlagRefreshAttempt(scope: string) {
	featureFlagRefreshAttempts.set(scope, Date.now());
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

function sanitizeFeatureFlags(
	value: unknown
): RuntimeFeatureFlags {
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

function isFeatureFlagsStateFresh(state: RuntimeFeatureFlagsState | null) {
	return Boolean(
		state && state.updatedAt >= Date.now() - FEATURE_FLAGS_REVALIDATE_MS
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

async function refreshFeatureFlagsFromPostHog() {
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

async function persistFeatureFlagsState(
	companyFooter: CompanyFooter | null | undefined,
	flags: RuntimeFeatureFlags,
	statusId: string
) {
	const nextCompanyFooter: CompanyFooter = {
		...(companyFooter || {}),
		featureFlagsState: serializeRuntimeFeatureFlagsState({
			flags,
			updatedAt: Date.now(),
		}),
	};

	await db
		.update(statusTable)
		.set({
			companyFooter: nextCompanyFooter,
			updatedAt: new Date(),
		})
		.where(eq(statusTable.id, statusId));
}

export async function getRuntimeFeatureFlags(): Promise<RuntimeFeatureFlags> {
	let status;

	try {
		status = await getStatusDirect();
	} catch {
		return EMPTY_FEATURE_FLAGS;
	}

	const storedState = parseRuntimeFeatureFlagsState(
		status.companyFooter?.featureFlagsState
	);

	if (storedState && isFeatureFlagsStateFresh(storedState)) {
		return storedState.flags;
	}

	const scope = getFeatureFlagsScope();
	if (
		getLastFeatureFlagRefreshAttempt(scope) >=
		Date.now() - FEATURE_FLAGS_REVALIDATE_MS
	) {
		return storedState?.flags ?? EMPTY_FEATURE_FLAGS;
	}

	const hasLock = await tryAcquireFeatureFlagsRefreshLock();

	if (!hasLock) {
		console.info("Feature flag sync lock not acquired", { scope });
		return storedState?.flags ?? EMPTY_FEATURE_FLAGS;
	}

	console.info("Feature flag sync lock acquired", { scope });
	markFeatureFlagRefreshAttempt(scope);

	try {
		const freshFlags = await refreshFeatureFlagsFromPostHog();

		if (Object.keys(freshFlags).length === 0) {
			console.warn("Feature flag sync skipped due to empty response", {
				scope,
			});
			return storedState?.flags ?? EMPTY_FEATURE_FLAGS;
		}

		await persistFeatureFlagsState(
			status.companyFooter,
			freshFlags,
			status.id
		);

		console.info("Feature flag sync succeeded", {
			scope,
			count: Object.keys(freshFlags).length,
		});

		return freshFlags;
	} catch (error) {
		console.error("Feature flag sync failed", {
			scope,
			error,
		});
		return storedState?.flags ?? EMPTY_FEATURE_FLAGS;
	} finally {
		await releaseFeatureFlagsRefreshLock();
	}
}
