import { createHash } from "node:crypto";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type {
	notificationEdition,
	notificationSubscriber,
} from "@/db/schema/notifications";
import { escapeHtml } from "@/lib/escape-html";
import { createSafeMarkdownRenderer } from "@/lib/markdown-html";
import {
	emailButton,
	emailPanel,
	emailStyles,
	renderLibraryEmail,
} from "@/lib/emails/library-template";

export type EmailSubscriber = Pick<
	typeof notificationSubscriber.$inferSelect,
	"email" | "token" | "weekly" | "instant" | "confirmedAt"
>;
export type EmailEdition = Pick<
	typeof notificationEdition.$inferSelect,
	"id" | "title" | "stream" | "windowStart" | "windowEnd" | "markdown"
> & {
	publications: Pick<
		(typeof notificationEdition.$inferSelect)["publications"][number],
		"key" | "title" | "creators" | "abstract" | "publicationType"
	>[];
};

function subscriptionUrl(
	config: LibraryServerConfig,
	token: string,
	action = "preferences",
) {
	return new URL(
		`/${config.localization.defaultLocale}/digests/${action}?token=${encodeURIComponent(token)}`,
		config.identity.baseUrl,
	).toString();
}

export function libraryEmailIdentity(
	config: Pick<LibraryServerConfig, "identity" | "theme">,
) {
	return {
		name: config.identity.name,
		baseUrl: config.identity.baseUrl,
		accent: config.theme.colors.accent,
		logoUrl:
			config.identity.assets.icons.find((icon) =>
				/\.png(?:\?|$)/.test(icon),
			) ||
			config.identity.assets.logoLight ||
			config.identity.assets.logoDark,
	};
}

/** Builds the exact message used by the delivery worker and development preview. */
export async function notificationMessage(
	config: LibraryServerConfig,
	subscriber: EmailSubscriber,
	edition: EmailEdition | null,
	messageKey: string,
) {
	const identity = libraryEmailIdentity(config);
	const preferences = subscriptionUrl(config, subscriber.token);
	const unsubscribe = subscriptionUrl(
		config,
		subscriber.token,
		"unsubscribe",
	);
	const { subject, text, content, title, detail } = edition
		? await editionContent(config, edition)
		: subscriptionContent(config, subscriber);
	const footerHtml = `You receive updates from this library.<br><a href="${escapeHtml(preferences)}" style="color:#555653">Email preferences</a> &nbsp; <a href="${escapeHtml(unsubscribe)}" style="color:#555653">Unsubscribe</a>`;
	return {
		to: subscriber.email,
		subject,
		text: `${text}\n\nEmail preferences: ${preferences}\nUnsubscribe: ${unsubscribe}`,
		html: renderLibraryEmail({
			identity,
			title,
			content,
			detail,
			footerHtml,
		}),
		messageId: `<${createHash("sha256").update(messageKey).digest("hex")}@${new URL(identity.baseUrl).hostname}>`,
		headers: { "List-Unsubscribe": `<${unsubscribe}>` },
	};
}

function subscriptionContent(
	config: LibraryServerConfig,
	subscriber: EmailSubscriber,
) {
	const identity = libraryEmailIdentity(config);
	const preferences = subscriptionUrl(config, subscriber.token);
	const button = (label: string, href: string) =>
		emailButton(label, href, identity.accent);
	let subject: string,
		text: string,
		content: string,
		title: string,
		detail: { dateRange: string; publicationCount: number } | undefined;
	if (subscriber.confirmedAt) {
		subject = `Email preferences for ${identity.name}`;
		title = "Email preferences";
		text = `Manage your email updates: ${preferences}`;
		content = `<p style="${emailStyles.paragraph}">Manage email updates from <strong style="color:#202822">${escapeHtml(identity.name)}</strong>.</p>${button("Manage email updates", preferences)}`;
	} else {
		const confirm = subscriptionUrl(config, subscriber.token, "confirm");
		subject = `Confirm email updates from ${identity.name}`;
		title = "Confirm your email updates";
		text = `Confirm your email updates: ${confirm}\n\nThis link expires after 24 hours. If you did not subscribe, ignore this email.`;
		content = `<p style="${emailStyles.paragraph}">One last step to receive updates from <strong style="color:#202822">${escapeHtml(identity.name)}</strong>.</p>${subscriber.weekly ? emailPanel("Weekly digest", "A summary of the week’s additions, with links to the publications.") : ""}${subscriber.instant ? emailPanel("New publications", "New items added to the library, collected into hourly emails.") : ""}${button("Confirm email updates", confirm)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">This link is valid for 24 hours. If you didn’t request these updates, you can ignore this email.</p>`;
	}
	return { subject, text, content, title, detail };
}

async function editionContent(
	config: LibraryServerConfig,
	edition: EmailEdition,
) {
	const identity = libraryEmailIdentity(config);
	const button = (label: string, href: string) =>
		emailButton(label, href, identity.accent);
	let subject: string,
		text: string,
		content: string,
		title: string,
		detail: { dateRange: string; publicationCount: number } | undefined;
	title = edition.title ?? `${edition.publications.length} new publications`;
	subject = `${config.identity.shortName}: ${title}`;
	const editionUrl = new URL(
		`/${config.localization.defaultLocale}/digests/${edition.id}`,
		identity.baseUrl,
	).toString();
	const publicationUrl = (key: string) =>
		new URL(`/lib/${key}`, identity.baseUrl).href;
	if (edition.stream === "weekly") {
		const render = await createSafeMarkdownRenderer(
			identity.baseUrl,
			emailStyles,
		);
		content = `${await render(edition.markdown ?? "")}<div style="margin-top:28px">${button("Read this week’s digest", editionUrl)}</div><p style="font-size:12px;line-height:1.6;color:#82837e;margin:20px 0 0">Prepared from publication metadata. The full edition includes links to every source.</p>`;
		const date = new Intl.DateTimeFormat(
			config.localization.defaultLocale,
			{
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: config.notifications.weekly.timezone,
			},
		);
		detail = {
			dateRange: date.formatRange(edition.windowStart, edition.windowEnd),
			publicationCount: edition.publications.length,
		};
	} else {
		content = `<p style="${emailStyles.paragraph}">New additions to ${escapeHtml(identity.name)}.</p>${edition.publications
			.map((publication) => {
				const url = escapeHtml(publicationUrl(publication.key));
				return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;background:#f7f7f3;border-radius:12px"><tr><td style="padding:22px"><p style="font-size:12px;font-weight:700;color:#797b73;margin:0 0 8px">${escapeHtml(publication.publicationType)}</p><a href="${url}" style="font-size:20px;line-height:1.35;font-weight:700;text-decoration:none;color:#202822">${escapeHtml(publication.title)}</a>${publication.creators.length ? `<p style="font-size:13px;color:#797b73;margin:8px 0 14px">${escapeHtml(publication.creators.join(", "))}</p>` : ""}${publication.abstract ? `<p style="font-size:14px;line-height:1.7;color:#555653;margin:0 0 16px">${escapeHtml(publication.abstract)}</p>` : ""}<a href="${url}" style="font-size:13px;font-weight:700;${emailStyles.link}">Read publication</a></td></tr></table>`;
			})
			.join("")}`;
	}
	const body =
		edition.stream === "weekly"
			? (edition.markdown ?? "").replace(
					/\]\((\/lib\/[A-Z0-9]{8})\)/g,
					(_, href: string) =>
						`](${new URL(href, identity.baseUrl)})`,
				)
			: edition.publications
					.map(
						(publication) =>
							`${publication.title}\n${publication.creators.join(", ")}\n\n${publication.abstract ?? ""}\n${publicationUrl(publication.key)}`,
					)
					.join("\n\n");
	text = `${title}\n\n${body}${edition.stream === "weekly" ? `\n\nRead online: ${editionUrl}` : ""}`;
	return { subject, text, content, title, detail };
}
