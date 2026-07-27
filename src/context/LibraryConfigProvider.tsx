"use client";

import {
	createContext,
	type ReactNode,
	useContext,
} from "react";

import type { LibraryPublicConfig } from "@/config/library-config/schema";

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
