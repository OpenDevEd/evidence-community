import "server-only";

import { getRuntimeFeatureFlags } from "@/lib/runtime-feature-flags";

export async function getServerFeatureFlags() {
	return getRuntimeFeatureFlags();
}
