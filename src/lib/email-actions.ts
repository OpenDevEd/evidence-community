"use server";

import { getLibraryConfig } from "@/config/library-config/server";
import { libraryRequestMessage } from "@/lib/emails/request";
import { isEmailChannelEnabled, sendEmailForConfig } from "@/lib/nodemailer";
import { validateContactRequest, validateTakedownRequest } from "@/lib/request-validation";

export async function sendTakedownRequest(
	email: string,
	links: string[],
	description: string,
) {
	const config = await getLibraryConfig();
	if (!isEmailChannelEnabled(config, "takedown")) {
		return { error: "Takedown email is disabled" };
	}

	const validator = await validateTakedownRequest(email, links, description);
	if ("error" in validator) {
		return { error: validator.error };
	}

	try {
		const result = await sendEmailForConfig(
			config,
			"takedown",
			libraryRequestMessage(config, { email, links, description }),
		);
		return { success: Boolean(result?.accepted.length) };
	} catch (error) {
		console.error("Unable to send takedown email", error);
		return { error: "Email delivery failed" };
	}
}

export async function sendContactRequest(email: string, description: string) {
	const config = await getLibraryConfig();
	if (!isEmailChannelEnabled(config, "contact")) {
		return { error: "Contact email is disabled" };
	}

	const validator = await validateContactRequest(email, description);
	if ("error" in validator) {
		return { error: validator.error };
	}

	try {
		const result = await sendEmailForConfig(
			config,
			"contact",
			libraryRequestMessage(config, { email, description }),
		);
		return { success: Boolean(result?.accepted.length) };
	} catch (error) {
		console.error("Unable to send contact email", error);
		return { error: "Email delivery failed" };
	}
}
