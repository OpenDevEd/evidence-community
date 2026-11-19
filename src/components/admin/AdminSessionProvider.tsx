"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FileAccess } from "@/lib/licences";
import { ADMIN_PUBLISH_PERMISSION, adminRoleHasPermission, type AdminRole } from "@/lib/admin/permissions";

/**
 * Who is signed in to the admin: their role, their OpenScholar account, and their name and photo as that account has
 * them. With it, which DOI providers the community has set up, so nothing offers a DOI it can't register.
 */
type LibraryAdminSession = { role: AdminRole; userId: string; name: string; image: string | null; doiProviders: { crossref: boolean; zenodo: boolean };
	/** The licence records made here start with: the community's default licence, by its Zenodo id. */
	defaultLicence: string;
	/** The community's default for who gets a new record's files; null when its licence decides. */
	defaultFileAccess: FileAccess | null;
};
const SessionContext = createContext<LibraryAdminSession | null>(null);
export function AdminSessionProvider({ session, children }: { session: LibraryAdminSession; children: ReactNode }) {
	return <SessionContext value={session}>{children}</SessionContext>;
}
export function useAdminSession() {
	const session = useContext(SessionContext);
	if (!session) throw new Error("AdminSessionProvider is required");
	return { ...session, canPublish: adminRoleHasPermission(session.role, ADMIN_PUBLISH_PERMISSION) };
}
