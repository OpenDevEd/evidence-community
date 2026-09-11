import type { LibraryPublicConfig, LibraryServerConfig } from "./schema";

export function hasContactDetails(contact: LibraryPublicConfig["contact"]) {
	return Boolean(contact.email || contact.phone || contact.address);
}

export function getRuntimePageAvailability(config: LibraryServerConfig) {
	return {
		"/map": config.features.countryFocus,
		"/contact": hasContactDetails(config.contact) || Boolean(config.email.contactRecipient),
		"/takedown": Boolean(config.email.takedownRecipient),
	};
}
