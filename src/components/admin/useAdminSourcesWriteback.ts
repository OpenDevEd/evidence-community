"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";
import {
	adminSourceWritebackShouldPollFast,
	type AdminSourceWritebackStatus,
} from "@/lib/admin/source-writeback-contract";

import {
	getAdminSourceWritebackStatus,
	resolveAdminSourceWritebackConflict,
	retryAdminSourceWriteback,
} from "./admin-api";

const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 15_000;

export type AdminSourceWritebackEntry = {
	error: string | null;
	status: AdminSourceWritebackStatus | null;
};

function message(error: unknown) {
	return error instanceof Error
		? error.message
		: "Writeback status could not be loaded.";
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Polls the writeback status of one record for every source it writes to,
 * and exposes retry and conflict choices per source. The poll timer is a
 * browser timer (outside system), hence the effect; it is cleaned up on
 * every change.
 */
export function useAdminSourcesWriteback(
	itemKey: string | null,
	sourceKeys: readonly string[],
	revision: number | null,
	onResolved?: (result: AdminSearchIndexMutationResult) => void,
) {
	const [entries, setEntries] = useState<
		Record<string, AdminSourceWritebackEntry>
	>({});
	const [loading, setLoading] = useState(false);
	const [busySource, setBusySource] = useState<string | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const keys = sourceKeys.join(" ");

	const refresh = useCallback(async () => {
		const list = keys ? keys.split(" ") : [];
		if (!itemKey || list.length === 0) {
			setEntries({});
			setLoading(false);
			return;
		}
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		const results = await Promise.all(
			list.map(async (sourceKey) => {
				try {
					return [
						sourceKey,
						{
							error: null,
							status: await getAdminSourceWritebackStatus(
								itemKey,
								sourceKey,
								controller.signal,
							),
						},
					] as const;
				} catch (caught) {
					if (isAbortError(caught)) return null;
					return [
						sourceKey,
						{ error: message(caught), status: null },
					] as const;
				}
			}),
		);
		if (controller.signal.aborted) return;
		setEntries((current) => {
			const next: Record<string, AdminSourceWritebackEntry> = {};
			for (const sourceKey of list) {
				const result = results.find((entry) => entry?.[0] === sourceKey);
				next[sourceKey] = result
					? result[1]
					: (current[sourceKey] ?? { error: null, status: null });
			}
			return next;
		});
		if (requestRef.current === controller) {
			requestRef.current = null;
			setLoading(false);
		}
	}, [itemKey, keys]);

	useEffect(() => {
		void refresh();
		return () => requestRef.current?.abort();
	}, [refresh, revision]);

	// Re-armed after every poll result (`entries` is a new object each time),
	// not only when the summary changes: a source can stay "queued" across
	// several polls and must still be asked again until it settles.
	useEffect(() => {
		if (!itemKey || !keys) return;
		const list = Object.values(entries);
		if (list.some((entry) => entry.error)) return;
		const pollFast = list.some((entry) =>
			adminSourceWritebackShouldPollFast(entry.status),
		);
		const timer = window.setTimeout(
			() => void refresh(),
			pollFast ? ACTIVE_POLL_MS : IDLE_POLL_MS,
		);
		return () => window.clearTimeout(timer);
	}, [entries, itemKey, keys, refresh]);

	const retry = useCallback(
		async (sourceKey: string) => {
			if (!itemKey || busySource) return;
			setBusySource(sourceKey);
			try {
				const status = await retryAdminSourceWriteback(itemKey, sourceKey);
				setEntries((current) => ({
					...current,
					[sourceKey]: { error: null, status },
				}));
			} catch (caught) {
				setEntries((current) => ({
					...current,
					[sourceKey]: {
						error: message(caught),
						status: current[sourceKey]?.status ?? null,
					},
				}));
			} finally {
				setBusySource(null);
			}
		},
		[busySource, itemKey],
	);

	const resolve = useCallback(
		async (sourceKey: string, choice: "load-remote" | "send-local") => {
			if (!itemKey || busySource) return;
			setBusySource(sourceKey);
			try {
				const result = await resolveAdminSourceWritebackConflict(
					itemKey,
					sourceKey,
					choice,
				);
				setEntries((current) => ({
					...current,
					[sourceKey]: { error: null, status: result.status },
				}));
				onResolved?.(result);
			} catch (caught) {
				setEntries((current) => ({
					...current,
					[sourceKey]: {
						error: message(caught),
						status: current[sourceKey]?.status ?? null,
					},
				}));
			} finally {
				setBusySource(null);
			}
		},
		[busySource, itemKey, onResolved],
	);

	return { busySource, entries, loading, refresh, resolve, retry };
}
