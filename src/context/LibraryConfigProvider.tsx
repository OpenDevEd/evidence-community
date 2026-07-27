"use client";

import {
	createContext,
	type ReactNode,
	useContext,
} from "react";

import type { LibraryPublicConfig } from "@/config/library-config/schema";
import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";

const LibraryConfigContext = createContext<LibraryPublicConfig | null>(
	null,
);

LibraryConfigContext.displayName = "LibraryConfigContext";

export function LibraryConfigProvider({
	children,
	config,
}: {
	children: ReactNode;
	config: LibraryPublicConfig;
}) {
	return (
		<LibraryConfigContext.Provider value={config}>
			{children}
		</LibraryConfigContext.Provider>
	);
}

export function useLibraryConfig() {
	const config = useContext(LibraryConfigContext);
	if (!config) {
		throw new Error(
			"useLibraryConfig must be used within LibraryConfigProvider",
		);
	}
	return config;
}

export function useLibraryFeature(feature: LibraryFeatureId) {
	return isLibraryFeatureEnabled(
		useLibraryConfig().features,
		feature,
	);
}
