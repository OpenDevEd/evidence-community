"use client";

import { useCallback, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import type { AdminFieldErrors } from "@/lib/admin/errors";
import type { AdminPublicationView } from "@/lib/publication/admin-publication-view";

import {
	activateAdminCrossrefPublication,
	activateAdminZenodoPublication,
	AdminApiError,
	getAdminPublication,
	retryAdminCrossrefPublication,
	retryAdminZenodoPublication,
} from "./admin-api";

export const ADMIN_PUBLICATION_POLL_MS = 1_000;

type PublicationAction =
	| "activate-crossref"
	| "activate-zenodo"
	| "retry-crossref"
	| "retry-zenodo";

type ActionState = {
	action: PublicationAction;
	error: string | null;
	fields: AdminFieldErrors;
	itemKey: string;
	pending: boolean;
};

function shouldPoll(publication: AdminPublicationView | undefined) {
	return publication
		? Object.values(publication.providers).some(
				(provider) => provider.status.shouldPoll,
			)
		: false;
}

function messageFor(error: unknown) {
	return error instanceof Error
		? error.message
		: "DOI publishing could not be updated. Try again.";
}

export function useAdminPublication(
	itemKey: string | null,
	inputVersion: string | null = null,
) {
	const { mutate: mutateCache } = useSWRConfig();
	const cacheKey = itemKey
		? (["admin-publication", itemKey, inputVersion] as const)
		: null;
	const { data, error, isLoading, isValidating, mutate } = useSWR(
		cacheKey,
		([, key]) => getAdminPublication(key),
		{
			keepPreviousData: false,
			refreshInterval: (publication) =>
				shouldPoll(publication) ? ADMIN_PUBLICATION_POLL_MS : 0,
		},
	);
	const [actionState, setActionState] = useState<ActionState | null>(null);
	const activeAction = useRef<{
		itemKey: string;
		token: symbol;
	} | null>(null);

	const run = useCallback(
		async (
			action: PublicationAction,
			request: (key: string) => Promise<{ publication: AdminPublicationView }>,
		) => {
			if (!itemKey || activeAction.current?.itemKey === itemKey) return false;
			const actionCacheKey = [
				"admin-publication",
				itemKey,
				inputVersion,
			] as const;
			const token = Symbol(action);
			activeAction.current = { itemKey, token };
			setActionState({
				action,
				error: null,
				fields: {},
				itemKey,
				pending: true,
			});
			try {
				const response = await request(itemKey);
				await mutateCache(actionCacheKey, response.publication, {
					revalidate: false,
				});
				setActionState({
					action,
					error: null,
					fields: {},
					itemKey,
					pending: false,
				});
				return true;
			} catch (caught) {
				setActionState({
					action,
					error: messageFor(caught),
					fields: caught instanceof AdminApiError ? caught.fields : {},
					itemKey,
					pending: false,
				});
				await mutateCache(actionCacheKey).catch(() => undefined);
				return false;
			} finally {
				if (activeAction.current?.token === token) activeAction.current = null;
			}
		},
		[inputVersion, itemKey, mutateCache],
	);

	const selectedAction = actionState?.itemKey === itemKey ? actionState : null;
	return {
		action: selectedAction?.action ?? null,
		actionError: selectedAction?.error ?? null,
		actionFieldErrors: selectedAction?.fields ?? {},
		activateCrossref: () =>
			run("activate-crossref", activateAdminCrossrefPublication),
		activateZenodo: (policy: "mint-zenodo" | "reuse-crossref") =>
			run("activate-zenodo", (key) =>
				activateAdminZenodoPublication(key, policy),
			),
		clearActionError: () => setActionState(null),
		error: error ? messageFor(error) : null,
		isLoading,
		isMutating: selectedAction?.pending ?? false,
		isValidating,
		publication: data?.itemKey === itemKey ? data : null,
		refresh: () => mutate(),
		retryCrossref: () =>
			run("retry-crossref", retryAdminCrossrefPublication),
		retryZenodo: () => run("retry-zenodo", retryAdminZenodoPublication),
	};
}
