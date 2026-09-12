"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ADMIN_PUBLISH_PERMISSION, adminRoleHasPermission, type AdminRole } from "@/lib/admin/permissions";

type LibraryAdminSession = { role: AdminRole; userId: string };
const SessionContext = createContext<LibraryAdminSession | null>(null);
export function AdminSessionProvider({ session, children }: { session: LibraryAdminSession; children: ReactNode }) {
	return <SessionContext value={session}>{children}</SessionContext>;
}
export function useAdminSession() {
	const session = useContext(SessionContext);
	if (!session) throw new Error("AdminSessionProvider is required");
	return { ...session, canPublish: adminRoleHasPermission(session.role, ADMIN_PUBLISH_PERMISSION) };
}
