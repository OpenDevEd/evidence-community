"use client";

import { FilterChips } from "@/components/features/resources/ResourcesView";

/**
 * Active-filter chips under the navbar search bar.
 *
 * Reuses the library's `FilterChips`, which reads the shared app-level filter
 * state directly — the same resident instance the library page uses — so the
 * collection names are ready immediately (no remount flash) and removing a chip
 * updates the query everywhere. Loaded lazily so the heavy `ResourcesView` graph
 * stays out of the always-present navbar bundle.
 */
export default function NavbarFilterChips() {
	return <FilterChips />;
}
