import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "./revision-aware-resource";

export type EmailChannel = "contact" | "takedown";

type RuntimeEmailMessage = {
	replyTo: string;
	subject: string;
	text: string;
	html?: string;
};

type SmtpTransporter = Transporter<SMTPTransport.SentMessageInfo>;
type EmailConfiguration = LibraryServerConfig["email"];

function emailConfigurationsEqual(
	left: EmailConfiguration,
	right: EmailConfiguration,
) {
	return (
		left.contactRecipient === right.contactRecipient &&
		left.takedownRecipient === right.takedownRecipient &&
		left.smtp.host === right.smtp.host &&
		left.smtp.port === right.smtp.port &&
		left.smtp.security === right.smtp.security &&
		left.smtp.username === right.smtp.username &&
		left.smtp.password === right.smtp.password &&
		left.smtp.from === right.smtp.from
	);
}

function getEmailRecipient(
	config: LibraryServerConfig,
	channel: EmailChannel,
) {
	return channel === "contact"
		? config.email.contactRecipient
		: config.email.takedownRecipient;
}

export function isEmailChannelEnabled(
	config: LibraryServerConfig,
	channel: EmailChannel,
) {
	return Boolean(getEmailRecipient(config, channel));
}

export function buildSmtpTransportOptions(
	config: Pick<LibraryServerConfig, "email">,
): SMTPTransport.Options {
	const { host, password, port, security, username } =
		config.email.smtp;
	if (!host) {
		throw new Error(
			"Enabled runtime email requires an SMTP host",
		);
	}

	return {
		host,
		port,
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 60_000,
		secure: security === "tls",
		...(security === "starttls" ? { requireTLS: true } : {}),
		...(security === "none" ? { ignoreTLS: true } : {}),
		...(security === "none"
			? {}
			: {
					tls: {
						minVersion: "TLSv1.2",
					},
				}),
		...(username && password
			? {
					auth: {
						user: username,
						pass: password,
					},
				}
			: {}),
	};
}

function createEmailTransport(
	email: EmailConfiguration,
) {
	if (
		!email.smtp.host
	) {
		return { value: null };
	}

	const transporter = nodemailer.createTransport(
		buildSmtpTransportOptions({ email }),
	);
	return {
		value: transporter,
		dispose: async () => transporter.close(),
	};
}

const globalEmailTransport = globalThis as typeof globalThis & {
	__evidenceLibraryEmailTransportFactory?: RevisionAwareResourceFactory<
		EmailConfiguration,
		SmtpTransporter | null
	>;
};

const emailTransportFactory =
	globalEmailTransport.__evidenceLibraryEmailTransportFactory ??
	new RevisionAwareResourceFactory(
		"SMTP",
		createEmailTransport,
		{ configurationEquals: emailConfigurationsEqual },
	);

globalEmailTransport.__evidenceLibraryEmailTransportFactory =
	emailTransportFactory;

function getEmailTransportForConfig(config: LibraryServerConfig) {
	return emailTransportFactory.get({
		configuration: config.email,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}

export async function sendEmailForConfig(
	config: LibraryServerConfig,
	channel: EmailChannel,
	message: RuntimeEmailMessage,
) {
	const recipient = getEmailRecipient(config, channel);
	if (!recipient) return null;

	const from = config.contact.email ?? config.email.smtp.from;
	if (!from) {
		throw new Error(
			"Enabled runtime email requires an SMTP sender",
		);
	}

	const transporter = await getEmailTransportForConfig(config);
	if (!transporter) {
		throw new Error(
			"Enabled runtime email requires an SMTP transport",
		);
	}

	return transporter.sendMail({ from: { name: config.identity.name, address: from }, to: recipient, ...message });
}

/** Shared transport for library-owned subscription jobs. */
export async function sendNotificationEmail(config: LibraryServerConfig, message: {
  to: string; subject: string; text: string; html: string; messageId: string;
  headers?: Record<string, string>;
}) {
  const transporter = await getEmailTransportForConfig(config);
  if (!transporter || !config.email.smtp.from) throw new Error("Library email is not configured");
  const address = config.contact.email ?? config.email.smtp.from;
  return transporter.sendMail({ from: { name: config.identity.name, address }, replyTo: address, ...message });
}
