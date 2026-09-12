import { z } from "zod";

export const adminRoleSchema = z.enum(["owner", "editor", "creator"]);

export const ADMIN_CONTENT_PERMISSION = "content:manage";
export const ADMIN_PUBLISH_PERMISSION = "content:publish";
export const ADMIN_LIBRARY_PERMISSION = "library:manage";

export type AdminPermission =
	| typeof ADMIN_PUBLISH_PERMISSION
	| typeof ADMIN_CONTENT_PERMISSION
	| typeof ADMIN_LIBRARY_PERMISSION;
export type AdminRole = z.infer<typeof adminRoleSchema>;

export function adminRoleHasPermission(
	role: AdminRole,
	permission: AdminPermission,
) {
	return permission === ADMIN_CONTENT_PERMISSION || role === "owner" ||
		(permission === ADMIN_PUBLISH_PERMISSION && role === "editor");
}
