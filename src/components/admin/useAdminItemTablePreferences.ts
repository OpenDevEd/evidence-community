"use client";

import { useEffect, useMemo, useState } from "react";

import { type AdminItemColumnId } from "@/lib/admin/item-list-contract";
import {
	ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES,
	ADMIN_ITEM_TABLE_PREFERENCE_KEY,
	normalizeAdminItemTablePreferences,
	requestedAdminItemColumns,
	type AdminItemTablePreferences,
} from "@/lib/admin/item-table-preferences";

function cloneDefaultPreferences(): AdminItemTablePreferences {
	return {
		...ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES,
		columnOrder: [...ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES.columnOrder],
		columnSizing: {},
		columnVisibility: {
			...ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES.columnVisibility,
		},
	};
}

export function useAdminItemTablePreferences() {
	const [preferences, setPreferences] = useState(cloneDefaultPreferences);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(
				ADMIN_ITEM_TABLE_PREFERENCE_KEY,
			);
			if (saved) {
				setPreferences(
					normalizeAdminItemTablePreferences(JSON.parse(saved)),
				);
			}
		} catch {
			try {
				window.localStorage.removeItem(ADMIN_ITEM_TABLE_PREFERENCE_KEY);
			} catch {
				// Storage can be unavailable in hardened/private browser contexts.
			}
		} finally {
			setHydrated(true);
		}
	}, []);

	useEffect(() => {
		if (!hydrated) return;
		try {
			window.localStorage.setItem(
				ADMIN_ITEM_TABLE_PREFERENCE_KEY,
				JSON.stringify(preferences),
			);
		} catch {
			// The table remains usable when persistence is unavailable.
		}
	}, [hydrated, preferences]);

	const requestedColumnKey = requestedAdminItemColumns(preferences).join(",");
	const requestedColumns = useMemo(
		() => requestedColumnKey.split(",") as AdminItemColumnId[],
		[requestedColumnKey],
	);

	return {
		preferences,
		requestedColumns,
		resetPreferences: () => setPreferences(cloneDefaultPreferences()),
		setPreferences,
	};
}
