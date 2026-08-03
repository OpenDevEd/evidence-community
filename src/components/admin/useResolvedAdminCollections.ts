"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

import { resolveAdminCollectionCatalog } from "./admin-api";

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

export function useResolvedAdminCollections(keys: readonly string[]) {
	const signature = keys.join("\u0000");
	const stableKeys = useMemo(
		() => (signature ? signature.split("\u0000") : []),
		[signature],
	);
	const keySet = useMemo(() => new Set(stableKeys), [stableKeys]);
	const [resolution, setResolution] =
		useState<ResolutionState>(EMPTY_RESOLUTION);
	const [reloadToken, setReloadToken] = useState(0);
	const retry = useCallback(() => setReloadToken((value) => value + 1), []);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			if (!stableKeys.length) {
				await Promise.resolve();
				if (!controller.signal.aborted) setResolution(EMPTY_RESOLUTION);
				return;
			}
			const chunks = Array.from(
				{ length: Math.ceil(stableKeys.length / 100) },
				(_, index) => stableKeys.slice(index * 100, index * 100 + 100),
			);
			const responses = await Promise.allSettled(
				chunks.map((chunk) =>
					resolveAdminCollectionCatalog(chunk, controller.signal),
				),
			);
			if (controller.signal.aborted) return;
			const resolved = responses.flatMap((response) =>
				response.status === "fulfilled" ? response.value.items : [],
			);
			const rejectedKeys = new Set(
				responses.flatMap((response, index) =>
					response.status === "rejected" ? chunks[index]! : [],
				),
			);
			setResolution((current) => {
				const retained = current.entries.filter(
					({ key }) => keySet.has(key) && rejectedKeys.has(key),
				);
				const byKey = new Map(
					retained.map((entry) => [entry.key, entry]),
				);
				for (const entry of resolved) byKey.set(entry.key, entry);
				return {
					entries: stableKeys.flatMap((key) => {
						const entry = byKey.get(key);
						return entry ? [entry] : [];
					}),
					error: responses.some(
						(response) => response.status === "rejected",
					),
					signature,
				};
			});
		})();
		return () => controller.abort();
	}, [keySet, reloadToken, signature, stableKeys]);

	const current = resolution.signature === signature;
	return {
		entries: current ? resolution.entries : [],
		error: current ? resolution.error : false,
		keySet,
		loading: stableKeys.length > 0 && !current,
		retry,
		stableKeys,
	};
}
