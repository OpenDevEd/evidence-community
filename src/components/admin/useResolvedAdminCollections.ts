"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

import {
	peekResolvedAdminCollection,
	readResolvedAdminCollection,
	resolveAdminCollectionKeys,
} from "./admin-collection-resolution-cache";
import { onAdminCollectionsChanged } from "./admin-collection-events";

type ResolutionState = {
	entries: AdminCollectionCatalogEntry[];
	error: boolean;
	signature: string;
};

const EMPTY_RESOLUTION: ResolutionState = {
	entries: [],
	error: false,
	signature: "",
};

export function useResolvedAdminCollections(
	keys: readonly string[],
	options: { maxAutoRetries?: number; retryDelayMs?: number } = {},
) {
	const maxAutoRetries = options.maxAutoRetries ?? 0;
	const retryDelayMs = options.retryDelayMs ?? 250;
	const signature = keys.join("\u0000");
	const stableKeys = useMemo(
		() => (signature ? signature.split("\u0000") : []),
		[signature],
	);
	const keySet = useMemo(() => new Set(stableKeys), [stableKeys]);
	const [resolution, setResolution] =
		useState<ResolutionState>(EMPTY_RESOLUTION);
	const [reloadToken, setReloadToken] = useState(0);
	const refresh = useCallback(() => setReloadToken((value) => value + 1), []);
	const retry = refresh;
	useEffect(() => onAdminCollectionsChanged(refresh), [refresh]);

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();
		void (async () => {
			if (!stableKeys.length) {
				await Promise.resolve();
				if (!cancelled) setResolution(EMPTY_RESOLUTION);
				return;
			}
			let pendingKeys = stableKeys;
			const resolvedThisRequest = new Map<
				string,
				AdminCollectionCatalogEntry | null
			>();
			for (let attempt = 0; attempt <= maxAutoRetries; attempt += 1) {
				const { entries, failedKeys } =
					await resolveAdminCollectionKeys(
						pendingKeys,
						controller.signal,
					);
				if (cancelled) return;
				for (const [key, entry] of entries) {
					resolvedThisRequest.set(key, entry);
				}
				setResolution((current) => {
					const retained = current.entries.filter(
						({ key }) => keySet.has(key) && failedKeys.has(key),
					);
					const byKey = new Map<string, AdminCollectionCatalogEntry>(
						retained.map((entry) => [entry.key, entry]),
					);
					for (const key of stableKeys) {
						const entry = resolvedThisRequest.has(key)
							? resolvedThisRequest.get(key)
							: readResolvedAdminCollection(key);
						if (entry) byKey.set(key, entry);
						else if (entry === null) byKey.delete(key);
					}
					return {
						entries: stableKeys.flatMap((key) => {
							const entry = byKey.get(key);
							return entry ? [entry] : [];
						}),
						error: failedKeys.size > 0,
						signature,
					};
				});
				if (failedKeys.size === 0 || attempt === maxAutoRetries) {
					return;
				}
				pendingKeys = [...failedKeys];
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, retryDelayMs * 2 ** attempt);
				});
				if (cancelled) return;
			}
		})();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [
		keySet,
		maxAutoRetries,
		reloadToken,
		retryDelayMs,
		signature,
		stableKeys,
	]);

	// Every key already known shows straight away, so changing the selection
	// never empties the list while the new keys are looked up.
	const byKey = new Map(resolution.entries.map((entry) => [entry.key, entry]));
	const known = (key: string) => byKey.get(key) ?? peekResolvedAdminCollection(key);
	const current = resolution.signature === signature;
	return {
		entries: stableKeys.flatMap((key) => {
			const entry = known(key);
			return entry ? [entry] : [];
		}),
		error: current ? resolution.error : false,
		keySet,
		// Pending only until this selection's lookup has answered, even when some keys failed.
		loading: !current && stableKeys.some((key) => known(key) === undefined),
		retry,
		stableKeys,
	};
}
