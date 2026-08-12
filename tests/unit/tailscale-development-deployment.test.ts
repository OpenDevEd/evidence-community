import { describe, expect, it } from "vitest";

import { inspectTailscaleDevelopmentDeployment } from "../../tools/verifyTailscaleDevelopmentDeployment";

describe("Tailscale development deployment", () => {
	it("keeps the admin bypass behind private Tailscale ingress", () => {
		expect(inspectTailscaleDevelopmentDeployment(process.cwd())).toEqual(
			[],
		);
	});
});
