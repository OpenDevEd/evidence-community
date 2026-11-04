import type { ReactNode } from "react";
import type { Element } from "hast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/i18n/routing";
import { getRuntimeLinkHref } from "@/config/library-config/links";
import type { HomeContent, HomeRich } from "./HomePage";
import { defaultContent } from "./home-content";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";

type Rendered = { children?: ReactNode; node?: Element };

/**
 * Text from the bold-and-links editor, as the home page sets it: body text, or a band's large statement. Anything else
 * in it is unwrapped to its words; bare addresses become links. Rendered on the server, so the page does not ship a
 * Markdown parser to every reader.
 */
function HomeRichText({ text, baseUrl, statement = false }: { text: string; baseUrl: string; statement?: boolean }) {
	// A link in an owner's answer; one to this library's own address becomes a path, so it keeps the reader's language.
	const a = ({ children, node }: Rendered) => {
		const href = String(node?.properties.href ?? "");
		// An address that does not parse ("https://") is shown as its words rather than breaking the page.
		if (!URL.canParse(href, baseUrl)) return <>{children}</>;
		return <Link href={getRuntimeLinkHref(href, baseUrl)} className="font-medium text-accent underline decoration-1 underline-offset-4">{children}</Link>;
	};
	const strong = ({ children }: Rendered) => <strong className="font-semibold opacity-100">{children}</strong>;
	const components = statement
		? { p: ({ children }: Rendered) => <p className="mb-4 last:mb-0">{children}</p>, a, strong }
		: {
				p: ({ children }: Rendered) => <p className="mb-4 max-w-[40rem] text-[17px] leading-[1.75] opacity-85 last:mb-0">{children}</p>,
				ul: ({ children }: Rendered) => <ul className="mb-4 max-w-[40rem] list-disc space-y-1 pl-5 text-[17px] leading-[1.75] opacity-85 marker:text-current last:mb-0 [&_p]:mb-0 [&_p]:opacity-100">{children}</ul>,
				a,
				strong,
			};
	return <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={["p", "strong", "em", "a", "ul", "li"]} unwrapDisallowed components={components}>{text}</ReactMarkdown>;
}

/** The page's answers from the bold-and-links editor, rendered; a blank one is left out, and its section with it. */
export function homeRich(about: HomeContent, baseUrl: string): HomeRich {
	const render = (text: string | undefined, statement = false) => (text?.trim() ? <HomeRichText text={text} baseUrl={baseUrl} statement={statement} /> : undefined);
	return { intro: render(about.intro), curation: render(about.curation?.text, true), team: render(about.team, true), extra: render(about.extra?.text) };
}

/**
 * What the home page's placeholder needs from the server, null while the library has none. The browser's copy of the
 * settings gives it the rest of the hero, but not the intro, which sets how tall the hero is.
 */
export function homePlaceholderContent(config: LibraryServerConfig, defaultIntro: string) {
	if (!isLibraryFeatureEnabled(config.features, "homePage")) return null;
	return { intro: homeRich({ intro: (config.home ?? defaultContent(defaultIntro)).intro }, config.identity.baseUrl).intro };
}
