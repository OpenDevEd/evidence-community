"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
	adminSourceWritebackShouldPollFast,
	type AdminSourceWritebackStatus,
} from "@/lib/admin/source-writeback-contract";

import {
	getAdminSourceWritebackStatus,
	retryAdminSourceWriteback,
} from "./admin-api";

const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 15_000;

function message(error: unknown) {
	return error instanceof Error
		? error.message
		: "Writeback status could not be loaded.";
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useAdminSourceWriteback(
	itemKey: string | null,
	sourceKey: string | null,
	revision: number | null,
) {
	const [status, setStatus] = useState<AdminSourceWritebackStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const requestRef = useRef<AbortController | null>(null);

	const refresh = useCallback(async () => {
		if (!itemKey || !sourceKey) {
			setStatus(null);
			setError(null);
			setLoading(false);
			return;
		}
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		try {
			setStatus(
				await getAdminSourceWritebackStatus(
					itemKey,
					sourceKey,
					controller.signal,
				),
			);
			setError(null);
		} catch (caught) {
			if (!isAbortError(caught)) setError(message(caught));
		} finally {
			if (requestRef.current === controller) {
				requestRef.current = null;
				setLoading(false);
			}
		}
	}, [itemKey, sourceKey]);

	useEffect(() => {
		void refresh();
		return () => requestRef.current?.abort();
	}, [refresh, revision]);

	useEffect(() => {
		if (!itemKey || !sourceKey || error) return;
		const timer = window.setTimeout(
			() => void refresh(),
			adminSourceWritebackShouldPollFast(status)
				? ACTIVE_POLL_MS
				: IDLE_POLL_MS,
		);
		return () => window.clearTimeout(timer);
	}, [error, itemKey, refresh, sourceKey, status]);

	const retry = useCallback(async () => {
		if (!itemKey || !sourceKey || retrying) return;
		setRetrying(true);
		try {
			setStatus(await retryAdminSourceWriteback(itemKey, sourceKey));
			setError(null);
		} catch (caught) {
			setError(message(caught));
		} finally {
			setRetrying(false);
		}
	}, [itemKey, retrying]);

	return { error, loading, refresh, retry, retrying, status };
}
