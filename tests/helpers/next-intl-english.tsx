import { vi } from "vitest";
import messages from "@/messages/en-US.json";

/** The real translator over the English messages, for tests that render without a provider. Stable between renders, as the real hooks are. */
export async function englishIntl() {
	const { createFormatter, createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
	const translators = new Map<string | undefined, unknown>();
	const formatter = createFormatter({ locale: "en-US", timeZone: "UTC" });
	return {
		useLocale: () => "en-US",
		useFormatter: () => formatter,
		useTranslations: (namespace?: string) => {
			if (!translators.has(namespace)) translators.set(namespace, createTranslator({ locale: "en-US", messages, namespace: namespace as never }));
			return translators.get(namespace) as ReturnType<typeof createTranslator>;
		},
	};
}
