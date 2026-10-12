/** Each policy page's heading and summary: on the page, and while its document is read. */
export const POLICY_PAGES = {
	privacy: {
		title: "Privacy Policy",
		description:
			"How this public library collects, uses, stores, and protects personal information across support, analytics, and site operations.",
	},
	terms: { title: "Terms of Service", description: "The rules for using this public library and its content." },
	"cookie-policy": {
		title: "Cookie Policy",
		description:
			"Which cookies and local storage entries the site uses, which are essential, and which only activate after analytics consent is granted.",
	},
} as const;
