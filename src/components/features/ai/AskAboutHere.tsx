"use client";

import { useCallback, type ReactNode } from "react";

import { useInlineChatDraftActions, useInlineChatLayout } from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { usePathname } from "@/i18n/routing";
import { AskAboutProvider, useAskAbout, type AttachedItem } from "./AskAbout";

/**
 * On the library page a publication goes to the chat beside the results,
 * joining its conversation and opening it if it is closed. A reader's own list
 * has no chat beside it, nor does any other page that lists records, so there
 * the page's own choice stands.
 */
export function AskAboutHere({ ownList, children }: { ownList: boolean; children: ReactNode }) {
	const fromPage = useAskAbout();
	const { setEngaged } = useInlineChatLayout();
	const { setAttached } = useInlineChatDraftActions();
	const { selectedModelId } = useSelectedModel();
	const onLibraryPage = /^\/lib\/?$/.test(usePathname());
	const attach = useCallback(
		(item: AttachedItem) => {
			setAttached(item);
			setEngaged(true);
		},
		[setAttached, setEngaged],
	);
	const beside = Boolean(fromPage && selectedModelId) && !ownList && onLibraryPage;
	return <AskAboutProvider value={beside ? attach : fromPage}>{children}</AskAboutProvider>;
}
