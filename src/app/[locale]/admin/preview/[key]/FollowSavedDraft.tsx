"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the preview on the latest saved draft. The admin writes each saved version on this page's frame, and a new one
 * refreshes the page in place, so the frame never goes blank or loses its scroll position.
 */
export function FollowSavedDraft() {
	const router = useRouter();
	const loadedVersion = useSearchParams().get("v");
	// Watches the admin's frame element. A draft saved while this page loaded is caught on mount.
	useEffect(() => {
		const frame = window.frameElement;
		if (!frame) return;
		let shownVersion = loadedVersion;
		const follow = () => {
			const savedVersion = frame.getAttribute("data-version");
			if (savedVersion === shownVersion) return;
			shownVersion = savedVersion;
			router.refresh();
		};
		follow();
		const observer = new MutationObserver(follow);
		observer.observe(frame, { attributeFilter: ["data-version"] });
		return () => observer.disconnect();
	}, [router, loadedVersion]);
	return null;
}
