"use client";

import ExploreModal from "@/components/features/collections/ExploreModal";

/**
 * Navbar entry point for the Explore filter modal.
 *
 * Renders the same `ExploreModal` the library page uses; the modal reads the
 * shared app-level filter state itself, so there's no per-instance fetch here.
 * Loaded lazily so its heavy graph stays out of the always-present navbar bundle
 * until Explore is opened.
 */
export default function NavbarExplore({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return <ExploreModal isOpen={isOpen} onOpenChange={onOpenChange} />;
}
