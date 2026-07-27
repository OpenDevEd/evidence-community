import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { buildLibraryLogoCss } from "@/config/library-config/identity";

export function LibraryLogoStyles({
	identity,
}: {
	identity: LibraryPublicConfig["identity"];
}) {
	const css = buildLibraryLogoCss(identity);
	if (!css) return null;

	return (
		<style
			id="library-logo-styles"
			dangerouslySetInnerHTML={{ __html: css }}
		/>
	);
}
