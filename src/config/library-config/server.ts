import "server-only";

import { loadLibraryConfig } from "./source";

export function getLibraryConfig() {
	return loadLibraryConfig();
}
