"use client";

import { useCallback, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { usePathname } from "@/i18n/routing";
import { ADMIN_HOME_PATH } from "@/lib/runtime-routing";
import { AskAboutConversation, AskAboutProvider, type AttachedItem } from "./AskAbout";

// Every public page has this host, but few readers open the chat: its code loads with the first Ask AI.
const ChatModal = dynamic(() => import("@/components/features/modals/ChatModal"), { ssr: false });

/**
 * The full-screen chat a public page opens about a publication. The first
 * publication opens it; later ones are attached to the same conversation, which
 * outlives closing the window. The attachment is kept here, so it survives a
 * change of model, which starts the conversation again. The admin has no chat,
 * and neither does a library with AI off, so there nothing offers to ask.
 */
export function AskAboutHost({ children }: { children: ReactNode }) {
	const isAdmin = usePathname().startsWith(ADMIN_HOME_PATH);
	const isAIEnabled = useLibraryFeature("ai");
	const { selectedModelId, setSelectedModelId } = useSelectedModel();
	const [attached, setAttached] = useState<AttachedItem | null>(null);
	const [opened, setOpened] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	// A conversation belongs to the model it was had with: another model starts the window again.
	const [conversation, setConversation] = useState<{ modelId: string | null; started: boolean }>({ modelId: null, started: false });
	const askAbout = useCallback((item: AttachedItem) => {
		setAttached(item);
		setOpened(true);
		setIsOpen(true);
	}, []);
	const available = !isAdmin && isAIEnabled && Boolean(selectedModelId);
	const hasConversation = conversation.started && conversation.modelId === selectedModelId;

	return (
		<AskAboutProvider value={available ? askAbout : null}>
			<AskAboutConversation value={hasConversation}>
				{children}
				{available && opened && (
					<ChatModal
						key={selectedModelId}
						isOpen={isOpen}
						onOpenChange={setIsOpen}
						publication={attached}
						onPublicationChange={setAttached}
						modelId={selectedModelId}
						onModelChange={setSelectedModelId}
						onConversationStateChange={started => setConversation({ modelId: selectedModelId, started })}
					/>
				)}
			</AskAboutConversation>
		</AskAboutProvider>
	);
}
