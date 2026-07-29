export function isAdminBypassEnabled() {
	return process.env.ADMIN_AUTH_BYPASS === "true";
}
