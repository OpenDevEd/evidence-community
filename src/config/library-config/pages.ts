import type { LibraryPublicConfig, LibraryServerConfig } from "./schema";
import { getRuntimePagePath } from "./links";

export function hasContactDetails(contact: LibraryPublicConfig["contact"]) {
	return Boolean(contact.email || contact.phone || contact.address);
}

export function getRuntimePageAvailability(config: LibraryServerConfig) {
	const { legal, identity: { baseUrl } } = config;
	return {
		"/terms": Boolean(legal.termsMarkdown || (legal.termsOfService && URL.canParse(legal.termsOfService, baseUrl) && getRuntimePagePath(legal.termsOfService, baseUrl) !== "/terms")),
		"/map": config.features.countryFocus,
		"/contact": hasContactDetails(config.contact) || Boolean(config.email.contactRecipient),
		"/takedown": Boolean(config.email.takedownRecipient),
	};
}
