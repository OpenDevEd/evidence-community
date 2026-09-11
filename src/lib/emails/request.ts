import type { LibraryServerConfig } from "@/config/library-config/schema";
import { escapeHtml } from "@/lib/escape-html";
import { libraryEmailIdentity } from "./identity";
import {
	emailButton,
	emailStyles,
	renderLibraryEmail,
} from "./library-template";

/** Contact and takedown forms use the same email frame as library updates. */
export function libraryRequestMessage(
	config: LibraryServerConfig,
	request: {
		email: string;
		description: string;
		links?: string[];
	},
) {
	const { email, description, links } = request;
	const identity = libraryEmailIdentity(config);
	const title = links ? "Takedown request" : "New contact message";
	const body = escapeHtml(description).replace(/\r?\n/g, "<br>");
	return {
		replyTo: email,
		subject: `${config.identity.shortName} - ${title}`,
		text: `From: ${email}\n\n${description}${links ? `\n\nPublications:\n${links.join("\n")}` : ""}`,
		html: renderLibraryEmail({
			identity,
			title,
			content: `<p style="font-size:13px;color:#797b73;margin:0 0 6px">From</p><p style="font-size:18px;font-weight:700;margin:0 0 24px;overflow-wrap:anywhere"><a href="mailto:${escapeHtml(email)}" style="color:#202822;text-decoration:none">${escapeHtml(email)}</a></p><p style="${emailStyles.paragraph};overflow-wrap:anywhere">${body}</p>${links ? `<h2 style="${emailStyles.heading}">Publications</h2>${links.map((link) => `<p style="margin:0 0 14px;overflow-wrap:anywhere">${/^https?:\/\//i.test(link) ? `<a href="${escapeHtml(link)}" style="font-size:14px;line-height:1.7;${emailStyles.link}">${escapeHtml(link)}</a>` : escapeHtml(link)}</p>`).join("")}` : ""}<div style="margin-top:28px">${emailButton("Reply to sender", `mailto:${email}`, identity.accent)}</div>`,
			footerHtml: `Submitted through the ${links ? "takedown" : "contact"} form on ${escapeHtml(identity.name)}.`,
		}),
	};
}
