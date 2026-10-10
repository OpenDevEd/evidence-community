import { libraryEmailIdentity } from "@/lib/emails/identity";
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
import { digestSignature } from "./public";
import { DIGEST_SIGNER_ROLE } from "./types";

export type EmailSubscriber = Pick<
	typeof notificationSubscriber.$inferSelect,
	"email" | "token" | "digest" | "instant" | "confirmedAt"
>;
export type EmailEdition = Pick<
	typeof notificationEdition.$inferSelect,
	"id" | "title" | "stream" | "windowStart" | "windowEnd" | "markdown" | "publicationCount" | "note" | "checkedBy"
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
		content = `<p style="${emailStyles.paragraph}">One last step to receive updates from <strong style="color:#202822">${escapeHtml(identity.name)}</strong>.</p>${subscriber.digest ? emailPanel("Library digest", "A summary of recent publications, with links to them.") : ""}${subscriber.instant ? emailPanel("New publications", "Updates when publications are added.") : ""}${button("Confirm email updates", confirm)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">This link is valid for 24 hours. If you didn’t request these updates, you can ignore this email.</p>`;
	}
	return { subject, text, content, title, detail };
}

const signedLine = "font-size:13px;margin:0;color:#797b73";

/**
 * Who stands behind a digest, above its text, when the library tells readers: the person who checked it with their
 * note, or that AI wrote it and nobody has. Empty when the library does not say.
 */
function digestSignedBy(config: LibraryServerConfig, edition: EmailEdition) {
	const by = digestSignature(config, edition.checkedBy);
	if (by === undefined) return { html: "", text: "" };
	if (!by) return { html: `<p style="${signedLine};margin-bottom:22px">Written by AI</p>`, text: "Written by AI\n\n" };
	const face = by.photo ? `<img src="${escapeHtml(by.photo)}" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:10px">` : "";
	const name = `<strong style="color:#202822">${escapeHtml(by.name)}</strong>`;
	if (!edition.note) return { html: `<p style="${signedLine};margin-bottom:22px">${face}Checked by ${name}</p>`, text: `Checked by ${by.name}\n\n` };
	const role = DIGEST_SIGNER_ROLE[by.role];
	return {
		html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;background:#f7f7f3;border-radius:12px"><tr><td style="padding:22px"><p style="${emailStyles.paragraph};margin:0 0 12px">${escapeHtml(edition.note).replace(/\n/g, "<br>")}</p><p style="${signedLine}">${face}${name} &nbsp;${role}</p></td></tr></table>`,
		text: `${edition.note}\n${by.name}, ${role}\n\n`,
	};
}

// Hourly emails list up to the edition's cap; this line counts the rest.
function unlisted(edition: EmailEdition) {
	const rest = edition.publicationCount - edition.publications.length;
	return rest > 0 ? [`And ${rest} more in the library.`] : [];
}

async function editionContent(
	config: LibraryServerConfig,
	edition: EmailEdition,
) {
	const identity = libraryEmailIdentity(config);
	const button = (label: string, href: string) =>
		emailButton(label, href, identity.accent);
	let content: string,
		detail: { dateRange: string; publicationCount: number } | undefined;
	const signed = edition.stream === "digest" ? digestSignedBy(config, edition) : { html: "", text: "" };
	const title = edition.title ?? `${edition.publicationCount} new publications`;
	const subject = `${config.identity.shortName}: ${title}`;
	const editionUrl = new URL(
		`/${config.localization.defaultLocale}/digests/${edition.id}`,
		identity.baseUrl,
	).toString();
	const publicationUrl = (key: string) =>
		new URL(`/lib/${key}`, identity.baseUrl).href;
	if (edition.stream === "digest") {
		const render = await createSafeMarkdownRenderer(
			identity.baseUrl,
			emailStyles,
		);
		content = `${signed.html}${await render(edition.markdown ?? "")}<div style="margin-top:28px">${button("Read this edition", editionUrl)}</div>`;
		const date = new Intl.DateTimeFormat(
			config.localization.defaultLocale,
			{
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: config.notifications.schedule.timezone,
			},
		);
		detail = {
			dateRange: date.formatRange(edition.windowStart, edition.windowEnd),
			publicationCount: edition.publicationCount,
		};
	} else {
		content = `<p style="${emailStyles.paragraph}">New additions to ${escapeHtml(identity.name)}.</p>${edition.publications
			.map((publication) => {
				const url = escapeHtml(publicationUrl(publication.key));
				return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;background:#f7f7f3;border-radius:12px"><tr><td style="padding:22px"><p style="font-size:12px;font-weight:700;color:#797b73;margin:0 0 8px">${escapeHtml(publication.publicationType)}</p><a href="${url}" style="font-size:20px;line-height:1.35;font-weight:700;text-decoration:none;color:#202822">${escapeHtml(publication.title)}</a>${publication.creators.length ? `<p style="font-size:13px;color:#797b73;margin:8px 0 14px">${escapeHtml(publication.creators.join(", "))}</p>` : ""}${publication.abstract ? `<p style="font-size:14px;line-height:1.7;color:#555653;margin:0 0 16px">${escapeHtml(publication.abstract)}</p>` : ""}<a href="${url}" style="font-size:13px;font-weight:700;${emailStyles.link}">Read publication</a></td></tr></table>`;
			})
			.join("")}${unlisted(edition).map((line) => `<p style="${emailStyles.paragraph}">${line}</p>`).join("")}`;
	}
	const body =
		edition.stream === "digest"
			? (edition.markdown ?? "").replace(
					/\]\((\/lib\/[A-Z0-9]{8})\)/g,
					(_, href: string) =>
						`](${new URL(href, identity.baseUrl)})`,
				)
			: [
					...edition.publications.map(
						(publication) =>
							`${publication.title}\n${publication.creators.join(", ")}\n\n${publication.abstract ?? ""}\n${publicationUrl(publication.key)}`,
					),
					...unlisted(edition),
				].join("\n\n");
	const text = `${title}\n\n${signed.text}${body}${edition.stream === "digest" ? `\n\nRead online: ${editionUrl}` : ""}`;
	return { subject, text, content, title, detail };
}
