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
const ADMIN_SEARCH_INDEX_STATUS_FAILURE_LIMIT = 3;

type ReceiptWaiter = {
	pending: Map<string, AdminSearchIndexReceipt>;
	reject: (error: Error) => void;
	resolve: () => void;
};

function receiptCompletionError(receipt: AdminSearchIndexReceiptStatus) {
	const detail = receipt.error ? ` ${receipt.error}` : "";
	return new Error(
		`The record was saved, but public search did not finish.${detail}`,
	);
}

function settleReceiptWaiters(
	waiters: Set<ReceiptWaiter>,
	statuses: readonly AdminSearchIndexReceiptStatus[],
) {
	const byIdentity = new Map(
		statuses.map((status) => [
			adminSearchIndexReceiptIdentity(status),
			status,
		]),
	);
	for (const waiter of waiters) {
		let failure: AdminSearchIndexReceiptStatus | null = null;
		for (const identity of waiter.pending.keys()) {
			const status = byIdentity.get(identity);
			if (!status) continue;
			if (status.state === "failed" || status.state === "unknown") {
				failure = status;
				break;
			}
			if (status.state === "indexed") waiter.pending.delete(identity);
		}
		if (failure) {
			waiters.delete(waiter);
			waiter.reject(receiptCompletionError(failure));
		} else if (waiter.pending.size === 0) {
			waiters.delete(waiter);
			waiter.resolve();
		}
	}
}

function rejectReceiptWaiters(waiters: Set<ReceiptWaiter>, error: Error) {
	for (const waiter of waiters) waiter.reject(error);
	waiters.clear();
}

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
	const [statusRequestFailures, setStatusRequestFailures] = useState(0);
	const receiptsRef = useRef(receipts);
	const statusRequestFailuresRef = useRef(0);
	const latestRevisionByEntityRef = useRef(new Map<string, number>());
	const receiptWaitersRef = useRef(new Set<ReceiptWaiter>());
	const requestRef = useRef<AbortController | null>(null);
	const retryingRef = useRef(false);
	receiptsRef.current = receipts;

	const refresh = useCallback(async () => {
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		try {
			const tracked = new Map(
				receiptsRef.current.map((receipt) => [
					adminSearchIndexReceiptIdentity(receipt),
					receipt,
				]),
			);
			for (const waiter of receiptWaitersRef.current) {
				for (const [identity, receipt] of waiter.pending) {
					tracked.set(identity, receipt);
				}
			}
			const receiptChunks = chunkValues(
				[...tracked.values()].map(({ entityKey, entityType, revision }) => ({
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
			const receivedStatuses = receiptResponses.flatMap(
				(response) => response.receipts,
			);
			const merged = mergeAdminSearchIndexStatuses(
				receiptsRef.current,
				receivedStatuses,
			);
			const hasUnknown = merged.some(({ state }) => state === "unknown");
			const remaining = merged.filter(({ state }) => state !== "indexed");
			settleReceiptWaiters(receiptWaitersRef.current, receivedStatuses);
			if (merged.length > 0 && remaining.length === 0 && !hasUnknown) {
				setCompleted(true);
			}
			setReceiptUnavailable(hasUnknown);
			receiptsRef.current = remaining;
			setReceipts(remaining);
			statusRequestFailuresRef.current = 0;
			setStatusRequestFailures(0);
			setError(null);
		} catch (caught) {
			if (!isAbortError(caught)) {
				const failureCount = statusRequestFailuresRef.current + 1;
				statusRequestFailuresRef.current = failureCount;
				setStatusRequestFailures(failureCount);
				if (failureCount >= ADMIN_SEARCH_INDEX_STATUS_FAILURE_LIMIT) {
					const message = errorMessage(caught);
					setError(message);
					rejectReceiptWaiters(
						receiptWaitersRef.current,
						new Error(message),
					);
				}
			}
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
	}, [
		error,
		fastPolling,
		overview,
		receiptUnavailable,
		receipts,
		refresh,
		statusRequestFailures,
	]);

	const queueReceipts = useCallback(
		(incoming: readonly AdminSearchIndexReceipt[]) => {
			if (incoming.length === 0) return [];
			const latestRevisionByEntity = latestRevisionByEntityRef.current;
			const accepted = incoming.filter((receipt) => {
				const identity = adminSearchIndexEntityIdentity(receipt);
				const latest = latestRevisionByEntity.get(identity) ?? 0;
				if (receipt.revision === latest) return true;
				return rememberLatestRevision(
					latestRevisionByEntity,
					identity,
					receipt.revision,
				);
			});
			if (accepted.length === 0) return [];
			const next = mergeAdminSearchIndexReceipts(
				receiptsRef.current,
				accepted,
			);
			receiptsRef.current = next;
			setCompleted(false);
			setReceiptUnavailable(false);
			setReceipts(next);
			return accepted;
		},
		[],
	);

	const track = useCallback(
		(incoming: readonly AdminSearchIndexReceipt[]) => {
			if (queueReceipts(incoming).length > 0) void refresh();
		},
		[queueReceipts, refresh],
	);

	const trackAndWait = useCallback(
		(incoming: readonly AdminSearchIndexReceipt[]) => {
			if (incoming.length === 0) return Promise.resolve();
			const accepted = queueReceipts(incoming);
			if (accepted.length !== incoming.length) {
				return Promise.reject(
					new Error(
						"A newer public search update replaced this one. Refresh and try again.",
					),
				);
			}
			const completion = new Promise<void>((resolve, reject) => {
				receiptWaitersRef.current.add({
					pending: new Map(
						accepted.map((receipt) => [
							adminSearchIndexReceiptIdentity(receipt),
							receipt,
						]),
					),
					reject,
					resolve,
				});
			});
			void refresh();
			return completion;
		},
		[queueReceipts, refresh],
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
		trackAndWait,
		view,
	};
}
