const POLICY_PATHS = ["/privacy", "/cookie-policy"] as const;

export function isPolicyPage(pathname: string) {
	const normalizedPathname = pathname.replace(/\/+$/, "") || "/";

	return POLICY_PATHS.some(
		(policyPath) =>
			normalizedPathname === policyPath ||
			normalizedPathname.endsWith(policyPath)
	);
}
