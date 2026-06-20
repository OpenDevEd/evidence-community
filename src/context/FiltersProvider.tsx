"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useFilters } from "@/hooks/useFilters";

/**
 * App-level provider for the shared filter state ({@link useFilters}).
 *
 * Mounted once in the persistent layout (above both the navbar and the page),
 * so the collections / hierarchy / params stay resident across navigation. The
 * library page, the navbar filter chips, and the Explore modal all read this
 * single instance instead of each spinning up their own `useItemsList`.
 */
const FiltersContext = createContext<ReturnType<typeof useFilters> | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
	const filters = useFilters();
	return (
		<FiltersContext.Provider value={filters}>
			{children}
		</FiltersContext.Provider>
	);
}

export function useFiltersContext() {
	const context = useContext(FiltersContext);
	if (!context) {
		throw new Error(
			"useFiltersContext must be used within a FiltersProvider"
		);
	}
	return context;
}
