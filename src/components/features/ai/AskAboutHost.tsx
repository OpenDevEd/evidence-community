"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import ChatModal, { type ChatWindowHandle } from "@/components/features/modals/ChatModal";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { usePathname } from "@/i18n/routing";
import { ADMIN_HOME_PATH } from "@/lib/runtime-routing";
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
	const chatRef = useRef<ChatWindowHandle>(null);
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
					publication={opened}
					modelId={selectedModelId}
					onModelChange={setSelectedModelId}
				/>
			)}
		</AskAboutProvider>
	);
}
