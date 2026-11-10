import { escapeHtml } from "@/lib/escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail, type LibraryEmailIdentity } from "./library-template";

type SuggestedPaper = { title: string; authors: string; year: number | null };

const quote = (text: string) =>
	`<blockquote style="margin:0 0 24px;padding:4px 0 4px 16px;border-left:3px solid #e2e3dc;font-size:15px;line-height:1.7;color:#424c45;white-space:pre-line">${escapeHtml(text)}</blockquote>`;

/**
 * To someone who suggested a paper, once the team answers: it is live, with the way to open it, or it wasn't added,
 * with the team's reason when they gave one. Until now the answer only showed in Openscholar's Your submissions.
 */
export function suggestionAnswerMessage({ identity, paper, published, reason, recordUrl, submissionsUrl }: { identity: LibraryEmailIdentity; paper: SuggestedPaper; published: boolean; reason: string | null; recordUrl: string; submissionsUrl: string }) {
	const name = `<strong style="color:#202822">${escapeHtml(identity.name)}</strong>`;
	const about = [paper.authors, paper.year].filter(Boolean).join(", ");
	const panel = emailPanel(paper.title, about, "The paper you suggested");
	const content = published
		? `<p style="${emailStyles.paragraph}">${name} published a paper you suggested.</p>${panel}${emailButton("Open the paper", recordUrl, identity.accent)}`
		: `<p style="${emailStyles.paragraph}">${name} didn’t add a paper you suggested.</p>${panel}${reason ? `<p style="font-size:13px;color:#797b73;margin:0 0 8px">Their reason</p>${quote(reason)}` : ""}${emailButton("Open your submissions", submissionsUrl, identity.accent)}`;
	return {
		subject: published ? `Your suggestion is live: ${paper.title}` : `About the paper you suggested to ${identity.name}`,
		text: published
			? `${identity.name} published a paper you suggested: ${paper.title}.\n\n${recordUrl}`
			: `${identity.name} didn't add a paper you suggested: ${paper.title}.${reason ? `\n\nTheir reason:\n${reason}` : ""}\n\n${submissionsUrl}`,
		html: renderLibraryEmail({
			identity,
			title: published ? "Your suggestion is live" : "About your suggestion",
			content,
			footerHtml: "You received this email because you suggested a paper to the community.",
		}),
	};
}
