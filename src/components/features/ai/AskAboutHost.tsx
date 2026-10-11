"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import useSWR from "swr";

import type { ItemGetResponse } from "@/app/api/item/types";
import ChatModal, { type ChatWindowHandle } from "@/components/features/modals/ChatModal";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { usePathname } from "@/i18n/routing";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import { analyticsIdField } from "@/lib/ai/chat-request";
import { ADMIN_HOME_PATH } from "@/lib/runtime-routing";
import { fetcherPOST } from "@/lib/utils";
import { AskAboutProvider, type AttachedItem } from "./AskAbout";

/**
 * The full-screen chat a public page opens about a publication. The first
 * publication opens it; later ones are attached to the same conversation, which
 * outlives closing the window. The admin has no chat, and neither does a library
 * with AI off, so there nothing offers to ask.
 */
export function AskAboutHost({ children }: { children: ReactNode }) {
	const isAdmin = usePathname().startsWith(ADMIN_HOME_PATH);
	const isAIEnabled = useLibraryFeature("ai");
	const { selectedModelId, setSelectedModelId } = useSelectedModel();
	const [opened, setOpened] = useState<AttachedItem | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [hasConversation, setHasConversation] = useState(false);
	const chatRef = useRef<ChatWindowHandle>(null);
	const locale = useLocale();
	// The suggested questions for the publication the window was opened for, until the conversation starts.
	const { data: questions } = useSWR(
		isOpen && opened && !hasConversation
			? ["/ai/questions", { prompt: opened.key, ...analyticsIdField(getAnalyticsDistinctId()) }, { "Accept-Language": locale }]
			: null,
		fetcherPOST,
		{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false },
	);
	const askAbout = useCallback((item: AttachedItem) => {
		// Before the window exists it starts with the publication; once it does, the publication joins its conversation.
		if (chatRef.current) chatRef.current.attach(item);
		else setOpened(item);
		setIsOpen(true);
	}, []);
	const available = !isAdmin && isAIEnabled && Boolean(selectedModelId);

	return (
		<AskAboutProvider value={available ? askAbout : null}>
			{children}
			{available && opened && (
				<ChatModal
					key={selectedModelId}
					ref={chatRef}
					isOpen={isOpen}
					onOpenChange={setIsOpen}
					data={{ item: { key: opened.key, title: opened.title } } as ItemGetResponse}
					modelId={selectedModelId}
					onModelChange={setSelectedModelId}
					onConversationStateChange={setHasConversation}
					questions={questions as string[] | undefined}
				/>
			)}
		</AskAboutProvider>
	);
}
