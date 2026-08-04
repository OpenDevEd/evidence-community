"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ADMIN_SEARCH_INDEX_RECEIPT_LIMIT } from "@/lib/admin/search-index-contract";
import { adminSearchIndexReceiptIdentity } from "@/lib/admin/search-index-contract";
import { chunkValues } from "@/lib/chunk-values";
import type {
	AdminSearchIndexOverview,
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
} from "@/lib/admin/search-index-contract";

import {
	getAdminSearchIndexOverview,
	getAdminSearchIndexReceipts,
	retryAdminSearchIndex,
} from "./admin-api";
import {
	ADMIN_SEARCH_INDEX_ACTIVE_POLL_MS,
	ADMIN_SEARCH_INDEX_IDLE_POLL_MS,
	adminSearchIndexEntityIdentity,
	adminSearchIndexShouldPollFast,
	deriveAdminSearchIndexView,
	mergeAdminSearchIndexReceipts,
	mergeAdminSearchIndexStatuses,
} from "./admin-search-index";

function errorMessage(error: unknown) {
	return error instanceof Error
		? error.message
		: "Search indexing status could not be loaded.";
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

const ADMIN_SEARCH_INDEX_REVISION_HISTORY_LIMIT = 500;
const ADMIN_SEARCH_INDEX_STATUS_CONCURRENCY = 4;

function rememberLatestRevision(
	history: Map<string, number>,
	identity: string,
	revision: number,
) {
	const latest = history.get(identity) ?? 0;
	if (revision <= latest) return false;
	history.delete(identity);
	history.set(identity, revision);
	while (history.size > ADMIN_SEARCH_INDEX_REVISION_HISTORY_LIMIT) {
		const oldest = history.keys().next().value;
		if (oldest === undefined) break;
		history.delete(oldest);
	}
	return true;
}

export function useAdminSearchIndex() {
	const [overview, setOverview] = useState<AdminSearchIndexOverview | null>(
		null,
	);
	const [receipts, setReceipts] = useState<AdminSearchIndexReceiptStatus[]>(
		[],
	);
	const [error, setError] = useState<string | null>(null);
	const [completed, setCompleted] = useState(false);
	const [receiptUnavailable, setReceiptUnavailable] = useState(false);
	const [loading, setLoading] = useState(true);
	const [retrying, setRetrying] = useState(false);
	const receiptsRef = useRef(receipts);
	const latestRevisionByEntityRef = useRef(new Map<string, number>());
	const requestRef = useRef<AbortController | null>(null);
	const retryingRef = useRef(false);
	receiptsRef.current = receipts;

	const refresh = useCallback(async () => {
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		try {
			const tracked = receiptsRef.current;
			const receiptChunks = chunkValues(
				tracked.map(({ entityKey, entityType, revision }) => ({
					entityKey,
					entityType,
					revision,
				})),
				ADMIN_SEARCH_INDEX_RECEIPT_LIMIT,
			);
			const nextOverview = await getAdminSearchIndexOverview(
				controller.signal,
			);
			const receiptResponses: Awaited<
				ReturnType<typeof getAdminSearchIndexReceipts>
			>[] = [];
			for (const requestBatch of chunkValues(
				receiptChunks,
				ADMIN_SEARCH_INDEX_STATUS_CONCURRENCY,
			)) {
				receiptResponses.push(
					...(await Promise.all(
						requestBatch.map((chunk) =>
							getAdminSearchIndexReceipts(chunk, controller.signal),
						),
					)),
				);
			}
			if (controller.signal.aborted) return;
			setOverview(nextOverview);
			const merged = mergeAdminSearchIndexStatuses(
				receiptsRef.current,
				receiptResponses.flatMap((response) => response.receipts),
			);
			const hasUnknown = merged.some(({ state }) => state === "unknown");
			const remaining = merged.filter(({ state }) => state !== "indexed");
			if (merged.length > 0 && remaining.length === 0 && !hasUnknown) {
				setCompleted(true);
			}
			setReceiptUnavailable(hasUnknown);
			receiptsRef.current = remaining;
			setReceipts(remaining);
			setError(null);
		} catch (caught) {
			if (!isAbortError(caught)) setError(errorMessage(caught));
		} finally {
			if (requestRef.current === controller) {
				requestRef.current = null;
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		void refresh();
		return () => requestRef.current?.abort();
	}, [refresh]);

	const fastPolling = adminSearchIndexShouldPollFast(overview, receipts);
	useEffect(() => {
		if (error || receiptUnavailable) return;
		const timer = window.setTimeout(
			() => void refresh(),
			fastPolling
				? ADMIN_SEARCH_INDEX_ACTIVE_POLL_MS
				: ADMIN_SEARCH_INDEX_IDLE_POLL_MS,
		);
		return () => window.clearTimeout(timer);
	}, [error, fastPolling, overview, receiptUnavailable, receipts, refresh]);

	const track = useCallback(
		(incoming: readonly AdminSearchIndexReceipt[]) => {
			if (incoming.length === 0) return;
			const latestRevisionByEntity = latestRevisionByEntityRef.current;
			const accepted = incoming.filter((receipt) => {
				const identity = adminSearchIndexEntityIdentity(receipt);
				return rememberLatestRevision(
					latestRevisionByEntity,
					identity,
					receipt.revision,
				);
			});
			if (accepted.length === 0) return;
			const next = mergeAdminSearchIndexReceipts(
				receiptsRef.current,
				accepted,
			);
			receiptsRef.current = next;
			setCompleted(false);
			setReceiptUnavailable(false);
			setReceipts(next);
			void refresh();
		},
		[refresh],
	);

	const retry = useCallback(async () => {
		if (retryingRef.current) return;
		retryingRef.current = true;
		setRetrying(true);
		try {
			const failedReceipts = receiptsRef.current.filter(
				({ state }) => state === "failed",
			);
			const requeued = new Set<string>();
			const markRequeued = (identities: ReadonlySet<string>) => {
				const queued = receiptsRef.current.map((receipt) =>
					receipt.state === "failed" &&
					identities.has(adminSearchIndexReceiptIdentity(receipt))
						? {
								...receipt,
								error: null,
								state: "queued" as const,
							}
						: receipt,
				);
				receiptsRef.current = queued;
				setReceipts(queued);
			};
			if (failedReceipts.length > 0) {
				const chunks = chunkValues(
					failedReceipts.map(({ entityKey, entityType, revision }) => ({
						entityKey,
						entityType,
						revision,
					})),
					ADMIN_SEARCH_INDEX_RECEIPT_LIMIT,
				);
				for (const chunk of chunks) {
					const result = await retryAdminSearchIndex({
						receipts: chunk,
						scope: "receipts",
					});
					for (const receipt of result.receipts) {
						requeued.add(adminSearchIndexReceiptIdentity(receipt));
					}
					markRequeued(requeued);
				}
			} else {
				await retryAdminSearchIndex({ scope: "allFailed" });
			}
			setError(null);
			setReceiptUnavailable(false);
			await refresh();
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			retryingRef.current = false;
			setRetrying(false);
		}
	}, [refresh]);

	const view = useMemo(
		() =>
			deriveAdminSearchIndexView({
				completed,
				error,
				loading,
				overview,
				receiptUnavailable,
				receipts,
				retrying,
			}),
		[
			completed,
			error,
			loading,
			overview,
			receiptUnavailable,
			receipts,
			retrying,
		],
	);

	return {
		error,
		overview,
		receipts,
		refresh,
		retry,
		track,
		view,
	};
}
