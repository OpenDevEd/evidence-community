import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	isEmailChannelEnabled: vi.fn(),
	sendEmailForConfig: vi.fn(),
	validateContactRequest: vi.fn(),
	validateTakedownRequest: vi.fn(),
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: harness.getLibraryConfig,
}));

vi.mock("@/lib/nodemailer", () => ({
	isEmailChannelEnabled: harness.isEmailChannelEnabled,
	sendEmailForConfig: harness.sendEmailForConfig,
}));

vi.mock("@/lib/request-validation", () => ({
	validateContactRequest: harness.validateContactRequest,
	validateTakedownRequest: harness.validateTakedownRequest,
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	sendContactRequest,
	sendTakedownRequest,
} from "@/lib/email-actions";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

describe("runtime email actions", () => {
	beforeEach(() => {
		const config = libraryConfigSchema.parse(
			cloneLibraryConfig(maximalLibraryConfig),
		);
		harness.getLibraryConfig.mockReset();
		harness.isEmailChannelEnabled.mockReset();
		harness.sendEmailForConfig.mockReset();
		harness.validateContactRequest.mockReset();
		harness.validateTakedownRequest.mockReset();

		harness.getLibraryConfig.mockResolvedValue(config);
		harness.isEmailChannelEnabled.mockReturnValue(true);
		harness.validateContactRequest.mockResolvedValue({
			success: true,
		});
		harness.validateTakedownRequest.mockResolvedValue({
			success: true,
		});
	});

	it("maps contact delivery failures to a stable action error", async () => {
		const deliveryError = new Error("SMTP unavailable");
		harness.sendEmailForConfig.mockRejectedValue(deliveryError);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			sendContactRequest(
				"reader@example.org",
				"This feedback description is long enough.",
			),
		).resolves.toEqual({ error: "Email delivery failed" });
		expect(consoleError).toHaveBeenCalledWith(
			"Unable to send contact email",
			deliveryError,
		);
	});

	it("maps takedown delivery failures to a stable action error", async () => {
		const deliveryError = new Error("SMTP unavailable");
		harness.sendEmailForConfig.mockRejectedValue(deliveryError);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			sendTakedownRequest(
				"rights-holder@example.org",
				["https://example.org/lib/ITEM"],
				"This takedown description is long enough.",
			),
		).resolves.toEqual({ error: "Email delivery failed" });
		expect(consoleError).toHaveBeenCalledWith(
			"Unable to send takedown email",
			deliveryError,
		);
	});
});
