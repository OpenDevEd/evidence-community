import { libraryEmailIdentity } from "./identity";
import { libraryRequestMessage } from "./request";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	notificationMessage,
	type EmailEdition,
} from "@/lib/notifications/message";
import { renderLibraryInvitation } from "./library-template";
import { suggestionAnswerMessage } from "./suggestion";

/** Development fixtures pass through the same renderers as sent messages. */
export async function libraryEmailPreviews(config: LibraryServerConfig) {
	const publications = [
		{
			key: "RHSRAM6J",
			title: "Designing for attention in the age of AI",
			creators: ["Maya Chen", "Alex Rivera"],
			abstract:
				"A framework for understanding when classroom technology supports attention, and when it interrupts it.",
			publicationType: "Report",
		},
		{
			key: "YPLK86VH",
			title: "Feedback that moves learning forward",
			creators: ["Sam Patel", "Maya Chen"],
			abstract:
				"Timely guidance, reflection and opportunities to revise work are the focus of this new report.",
			publicationType: "Report",
		},
		{
			key: "K24D9DI3",
			title: "Small moments, lasting learning",
			creators: ["Maya Chen", "Alex Rivera"],
			abstract:
				"Brief classroom routines and their role in sustaining learning throughout the school day.",
			publicationType: "Practice guide",
		},
	];
	const edition: EmailEdition = {
		id: "preview",
		stream: "digest",
		title: "Attention, feedback and the everyday classroom",
		// Shown only when the library tells readers who checks its digests.
		checkedBy: { id: "preview", name: "Ama Mensah", photo: null, role: "editor" },
		note: "Start with the paper on attention: it is the one the others build on.",
		windowStart: new Date("2026-09-07T00:00:00Z"),
		windowEnd: new Date("2026-09-14T00:00:00Z"),
		publications,
		publicationCount: publications.length,
		markdown:
			"These additions look at what helps learners stay engaged, and how teachers can make feedback easier to act on.\n\n## Making room for attention\n\nAttention is part of the learning environment. [Designing for attention in the age of AI](/lib/RHSRAM6J) examines the choices that shape engagement, including when digital tools help and when they interrupt.\n\n## Feedback learners can use\n\nThe other additions connect timely feedback with everyday practice. Short cycles of reflection and revision give learners space to try again, while consistent classroom routines make that work easier to sustain. [2](/lib/YPLK86VH), [3](/lib/K24D9DI3)",
	};
	const subscriber = {
		email: "preview@example.org",
		token: "preview",
		digest: true,
		instant: false,
		confirmedAt: new Date(),
	};
	const [digest, items, confirm] = await Promise.all([
		notificationMessage(config, subscriber, edition, "preview:digest"),
		notificationMessage(
			config,
			subscriber,
			{ ...edition, stream: "hourly", title: "3 new publications" },
			"preview:items",
		),
		notificationMessage(
			config,
			{ ...subscriber, confirmedAt: null },
			null,
			"preview:confirm",
		),
	]);
	return [
		...[
			{
				id: "contact",
				label: "Contact",
				email: "reader@example.org",
				description:
					"I’m looking for research on classroom feedback and would like to suggest a publication for the community.\n\nCould you let me know how to share it with your editors?",
			},
			{
				id: "takedown",
				label: "Takedown request",
				email: "rights-holder@example.org",
				description:
					"I’m contacting you about the publication below. Please review its availability while we confirm the permission to distribute it.",
				links: [new URL("/lib/RHSRAM6J", config.identity.baseUrl).href],
			},
		].map(({ id, label, ...request }) => ({
			id,
			label,
			...libraryRequestMessage(config, request),
		})),
		{
			id: "digest",
			label: "Community digest",
			subject: digest.subject,
			html: digest.html,
		},
		{
			id: "items",
			label: "New publications",
			subject: items.subject,
			html: items.html,
		},
		{
			id: "invitation",
			label: "Invitation",
			subject: `Invitation to ${config.identity.name}`,
			html: renderLibraryInvitation({
				identity: libraryEmailIdentity(config),
				role: "editor",
				acceptUrl: new URL("/admin", config.identity.baseUrl).href,
			}),
		},
		{
			id: "confirm",
			label: "Confirmation",
			subject: confirm.subject,
			html: confirm.html,
		},
		...[
			{ id: "suggestion-live", label: "Suggestion published", published: true, reason: null },
			{ id: "suggestion-declined", label: "Suggestion declined", published: false, reason: "It studies university students. We collect research on primary and secondary schools." },
		].map(({ id, label, ...answer }) => ({
			id,
			label,
			...suggestionAnswerMessage({
				...answer,
				identity: libraryEmailIdentity(config),
				paper: { title: "Feedback that moves learning forward", authors: "Sam Patel, Maya Chen", year: 2024 },
				recordUrl: new URL("/lib/YPLK86VH", config.identity.baseUrl).href,
				submissionsUrl: new URL("/evidence-communities?view=submissions", new URL(config.authentication.openScholar.accountUrl).origin).href,
			}),
		})),
	];
}
