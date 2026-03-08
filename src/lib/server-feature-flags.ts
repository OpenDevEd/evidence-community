import "server-only";

import type { CompanyFooter } from "@/db/schema/tables/status";
import { readStoredRuntimeFeatureFlags } from "@/lib/runtime-feature-flags";

export function getServerFeatureFlags(
	companyFooter: CompanyFooter | null | undefined
) {
	return readStoredRuntimeFeatureFlags(companyFooter);
}
