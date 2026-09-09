"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AdminRole } from "@/lib/admin/access";

type LibraryAdminSession = { role: AdminRole; userId: string };
const SessionContext = createContext<LibraryAdminSession | null>(null);
export function AdminSessionProvider({ session, children }: { session: LibraryAdminSession; children: ReactNode }) {
	return <SessionContext value={session}>{children}</SessionContext>;
}
export function useAdminSession() {
	const session = useContext(SessionContext);
	if (!session) throw new Error("AdminSessionProvider is required");
	return session;
}
