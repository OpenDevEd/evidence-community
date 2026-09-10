import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
	close: vi.fn(),
	createTransport: vi.fn(),
	sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
	default: {
		createTransport: harness.createTransport,
	},
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	buildSmtpTransportOptions,
	isEmailChannelEnabled,
	sendEmailForConfig,
	sendNotificationEmail,
} from "@/lib/nodemailer";
import { RevisionResourceConflictError } from "@/lib/revision-aware-resource";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

function emailConfig() {
	return libraryConfigSchema.parse(
		cloneLibraryConfig(maximalLibraryConfig),
	);
}

describe("runtime email", () => {
	beforeEach(() => {
		harness.createTransport.mockReset();
		harness.close.mockReset();
		harness.sendMail.mockReset();
		harness.createTransport.mockReturnValue({
			close: harness.close,
			sendMail: harness.sendMail,
		});
	});

	it("does not build a transport when email is disabled", async () => {
		const config = libraryConfigSchema.parse(
			cloneLibraryConfig(minimalLibraryConfig),
		);

		expect(isEmailChannelEnabled(config, "contact")).toBe(false);
		expect(isEmailChannelEnabled(config, "takedown")).toBe(
			false,
		);
		await expect(
			sendEmailForConfig(config, "contact", {
				replyTo: "reader@example.org",
				subject: "Runtime proof",
				text: "No delivery",
			}),
		).resolves.toBeNull();
		expect(harness.createTransport).not.toHaveBeenCalled();
	});

	it.each([
		[
			"tls",
			{
				secure: true,
				tls: { minVersion: "TLSv1.2" },
			},
		],
		[
			"starttls",
			{
				requireTLS: true,
				secure: false,
				tls: { minVersion: "TLSv1.2" },
			},
		],
		[
			"none",
			{
				ignoreTLS: true,
				secure: false,
			},
		],
	] as const)("maps %s security to SMTP options", (security, expected) => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		if (!input.email?.smtp) {
			throw new Error("Fixture email config is missing");
		}
		input.email.smtp.security = security;
		const config = libraryConfigSchema.parse(input);

		expect(buildSmtpTransportOptions(config)).toEqual({
			auth: {
				pass: "smtp-password",
				user: "smtp-user",
			},
			host: "smtp.example.org",
			port: 587,
			connectionTimeout: 15_000,
			greetingTimeout: 15_000,
			socketTimeout: 60_000,
			...expected,
		});
	});

	it("omits SMTP authentication when credentials are absent", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		if (!input.email?.smtp) {
			throw new Error("Fixture email config is missing");
		}
		delete input.email.smtp.username;
		delete input.email.smtp.password;
		const config = libraryConfigSchema.parse(input);

		expect(buildSmtpTransportOptions(config)).not.toHaveProperty(
			"auth",
		);
	});

	it("routes both channels and enforces revision-aware transport lifecycle", async () => {
		harness.sendMail.mockResolvedValue({
			accepted: ["contact@example.org"],
		});
		const config = emailConfig();

		await expect(
			sendEmailForConfig(config, "contact", {
				replyTo: "reader@example.org",
				subject: "Maximal Library - Feedback",
				text: "Runtime email proof",
			}),
		).resolves.toMatchObject({
			accepted: ["contact@example.org"],
		});
		await sendEmailForConfig(config, "takedown", {
			replyTo: "rights-holder@example.org",
			subject: "Maximal Library - Takedown Request",
			text: "Runtime takedown proof",
		});

		expect(harness.createTransport).toHaveBeenCalledOnce();
		expect(harness.createTransport).toHaveBeenCalledWith({
			auth: {
				pass: "smtp-password",
				user: "smtp-user",
			},
			host: "smtp.example.org",
			port: 587,
			connectionTimeout: 15_000,
			greetingTimeout: 15_000,
			socketTimeout: 60_000,
			requireTLS: true,
			secure: false,
			tls: {
				minVersion: "TLSv1.2",
			},
		});
		expect(harness.sendMail).toHaveBeenNthCalledWith(1, {
			from: { name: "Maximal Evidence Library", address: "library@example.org" },
			replyTo: "reader@example.org",
			subject: "Maximal Library - Feedback",
			text: "Runtime email proof",
			to: "contact@example.org",
		});
		expect(harness.sendMail).toHaveBeenNthCalledWith(2, {
			from: { name: "Maximal Evidence Library", address: "library@example.org" },
			replyTo: "rights-holder@example.org",
			subject: "Maximal Library - Takedown Request",
			text: "Runtime takedown proof",
			to: "takedown@example.org",
		});

		const nextInput = cloneLibraryConfig(maximalLibraryConfig);
		if (!nextInput.email?.smtp) {
			throw new Error("Fixture email config is missing");
		}
		nextInput.revision = "maximal-2";
		nextInput.updatedAt = "2026-07-27T12:31:00.000Z";
		nextInput.email.smtp.host = "smtp-next.example.org";
		const nextConfig = libraryConfigSchema.parse(nextInput);

		await sendEmailForConfig(nextConfig, "contact", {
			replyTo: "next-reader@example.org",
			subject: "Maximal Library - Feedback",
			text: "Next revision proof",
		});

		expect(harness.createTransport).toHaveBeenCalledTimes(2);
		expect(harness.createTransport).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				host: "smtp-next.example.org",
			}),
		);
		expect(harness.close).toHaveBeenCalledOnce();

		await sendNotificationEmail({ ...nextConfig, identity: { ...nextConfig.identity, name: "Renamed library" } }, {
			to: "subscriber@example.org", subject: "Updates", text: "Updates", html: "<p>Updates</p>", messageId: "<updates@example.org>",
		});
		expect(harness.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({
			from: { name: "Renamed library", address: "library@example.org" },
			to: "subscriber@example.org",
		}));

		const conflictingInput = cloneLibraryConfig(nextInput);
		if (!conflictingInput.email?.smtp) {
			throw new Error("Fixture email config is missing");
		}
		conflictingInput.email.smtp.host = "smtp-conflict.example.org";
		const conflictingConfig =
			libraryConfigSchema.parse(conflictingInput);

		await expect(
			sendEmailForConfig(conflictingConfig, "contact", {
				replyTo: "conflict-reader@example.org",
				subject: "Maximal Library - Feedback",
				text: "Conflict proof",
			}),
		).rejects.toBeInstanceOf(RevisionResourceConflictError);
	});
});
