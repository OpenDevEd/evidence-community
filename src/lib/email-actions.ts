"use server";

import { getLibraryConfig } from "@/config/library-config/server";
import {
	isEmailChannelEnabled,
	sendEmailForConfig,
} from "@/lib/nodemailer";
import {
	validateContactRequest,
	validateTakedownRequest,
} from "@/lib/utils";

export async function sendTakedownRequest(
	email: string,
	links: string[],
	description: string,
) {
	const config = await getLibraryConfig();
	if (!isEmailChannelEnabled(config, "takedown")) {
		return { error: "Takedown email is disabled" };
	}

	const validator = await validateTakedownRequest(
		email,
		links,
		description,
	);
	if ("error" in validator) {
		return { error: validator.error };
	}

	try {
		const result = await sendEmailForConfig(config, "takedown", {
			replyTo: email,
			subject: `${config.identity.shortName} - Takedown Request`,
			text: `Email: ${email}\nLinks: ${links.join("\n")}\nDescription: ${description}`,
		});
		return { success: Boolean(result?.accepted.length) };
	} catch (error) {
		console.error("Unable to send takedown email", error);
		return { error: "Email delivery failed" };
	}
}

export async function sendContactRequest(
	email: string,
	description: string,
) {
	const config = await getLibraryConfig();
	if (!isEmailChannelEnabled(config, "contact")) {
		return { error: "Contact email is disabled" };
	}

	const validator = await validateContactRequest(email, description);
	if ("error" in validator) {
		return { error: validator.error };
	}

	try {
		const result = await sendEmailForConfig(config, "contact", {
			replyTo: email,
			subject: `${config.identity.shortName} - Feedback`,
			text: `Email: ${email}\nDescription: ${description}`,
		});
		return { success: Boolean(result?.accepted.length) };
	} catch (error) {
		console.error("Unable to send contact email", error);
		return { error: "Email delivery failed" };
	}
}
