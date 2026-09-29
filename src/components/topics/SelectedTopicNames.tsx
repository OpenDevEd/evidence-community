"use client";

import { createContext, type ReactNode } from "react";
import type { TopicTree } from "@/lib/topics/contract";

/** The server's names for the topics in the URL; read only until the shared tree has loaded. */
export const SelectedTopicNamesContext = createContext<Promise<TopicTree | null> | null>(null);

export function SelectedTopicNames({ names, children }: { names: Promise<TopicTree | null>; children: ReactNode }) {
	return <SelectedTopicNamesContext value={names}>{children}</SelectedTopicNamesContext>;
}
