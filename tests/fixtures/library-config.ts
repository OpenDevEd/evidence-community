import type { LibraryConfigInput } from "@/config/library-config/schema";

export const libraryCollectionIds = ["collection-one", "collection-two"];
export const libraryInstitutionNames = [
	"Institution One",
	"Indexed Institution Without Branding",
];

export const minimalLibraryConfig = {
	schemaVersion: 1,
	revision: "minimal-1",
	updatedAt: "2026-07-27T12:00:00Z",
	identity: {
		name: "Minimal Evidence Library",
		baseUrl: "https://minimal.example.org",
		assets: {
			logoDark: "https://assets.example.org/minimal/logo.svg",
			favicon: "https://assets.example.org/minimal/favicon.ico",
		},
	},
	theme: {
		colors: {
			accent: "#E68124",
			tertiary: "#5CACFD",
		},
	},
	localization: {
		locales: ["en-GB"],
		defaultLocale: "en-GB",
	},
	services: {
		database: {
			url: "postgresql://library:password@database:5432/library",
		},
		search: {
			host: "http://meilisearch:7700",
			key: "search-key",
			index: "minimal_library",
		},
		storage: {
			url: "http://storage:5000",
			serviceRoleKey: "storage-service-role-key",
			privateBucket: "minimal-private",
			publicBucket: "minimal-public",
			maxPdfBytes: 104_857_600,
		},
	},
} satisfies LibraryConfigInput;

export const maximalLibraryConfig = {
	schemaVersion: 1,
	revision: "maximal-1",
	updatedAt: "2026-07-27T12:30:00.000Z",
	identity: {
		name: "Maximal Evidence Library",
		shortName: "Maximal Library",
		baseUrl: "https://maximal.example.org",
		fundingPartners: [
			{
				id: "partner-one",
				name: "Partner One",
			},
			{
				id: "partner-two",
				name: "Partner Two",
			},
		],
		assets: {
			logoDark: "https://assets.example.org/maximal/logo-dark.svg",
			logoLight: "https://assets.example.org/maximal/logo-light.webp",
			favicon: "https://assets.example.org/maximal/favicon.png",
			icons: [
				"https://assets.example.org/maximal/icon.svg",
				"https://assets.example.org/maximal/icon.ico",
			],
			logoStyles: "max-width: 12rem;\nheight: auto;",
		},
	},
	institutions: [
		{
			id: "institution-one",
			name: "Institution One",
			logoUrl: "https://assets.example.org/maximal/institution-one.png",
		},
	],
	theme: {
		layout: "wide",
		colors: {
			accent: "#E68124",
			link: "#1976D2",
			collection: "#009900",
			doi: "#CC0000",
			tertiary: "#5CACFD",
			backgroundDark: "#0F0F0F",
			backgroundLight: "#F4F2EE",
			cardDark: "#141414",
			cardLight: "#FFFFFF",
		},
		defaultMode: "system",
		forcedMode: null,
		fonts: {
			heading: {
				source: "google",
				family: "Montserrat",
			},
			body: {
				source: "woff2",
				family: "Maximal Sans",
				url: "https://assets.example.org/fonts/maximal-sans.woff2",
				weight: "variable",
			},
			weights: [300, 400, 500, 700],
		},
	},
	navigation: {
		links: [
			{
				id: "evidence",
				label: "Evidence",
				href: "/lib",
				icon: "EvidenceLibrary",
				children: [
					{
						id: "privacy",
						label: "Privacy",
						href: "/privacy",
					},
				],
			},
			{
				id: "external",
				label: "Partner",
				href: "https://partner.example.org",
				icon: "https://assets.example.org/maximal/partner.svg",
				target: "blank",
			},
		],
	},
	footer: {
		sections: [
			{
				id: "resources",
				title: "Resources",
				links: [
					{
						id: "library",
						label: "Library",
						href: "/lib",
					},
				],
			},
		],
		socialLinks: [
			{
				provider: "linkedin",
				href: "https://linkedin.com/company/example",
			},
		],
		funders: [
			{
				id: "funder-one",
				name: "Funder One",
				logoUrl: "https://assets.example.org/maximal/funder.webp",
				href: "https://funder.example.org",
			},
		],
		disclaimer: "Research evidence is provided as-is.",
		attribution: "Built by OpenDevEd.",
	},
	contact: {
		email: "hello@example.org",
		phone: "+212500000000",
		address: "Line one\nLine two",
	},
	legal: {
		privacyPolicy: "/privacy",
		cookiePolicy: "/cookie-policy",
		termsOfService: "https://maximal.example.org/terms",
	},
	localization: {
		locales: ["en-GB", "fr"],
		defaultLocale: "en-GB",
		detectLocale: true,
		localePriority: ["fr", "en-GB"],
	},
	search: {
		fullText: true,
		tags: true,
		country: true,
		authorCountry: true,
		embeddings: true,
		scopes: ["title_abstract_author_and_keywords", "title", "authors"],
		defaultScope: "title_abstract_author_and_keywords",
	},
	filters: {
		institution: {
			mode: "facet-with-featured-value",
			label: "institutions",
			featuredValue: "Institution One",
		},
		countryLibrary: true,
		collectionsExpanded: false,
		years: {
			enabled: true,
			minimum: 2000,
			maximum: 2026,
		},
	},
	content: {
		tags: {
			comingSoon: ["coming-soon"],
			internal: ["internal-only"],
			hidden: ["hidden-record"],
			description: ["collection-description"],
			redirects: ["redirect-record"],
			publish: ["publish-record"],
		},
	},
	citations: {
		showUrl: true,
	},
	features: {
		themeSwitcher: true,
		languageSwitcher: true,
		login: true,
		navbarSearch: true,
		userCollections: true,
		ai: true,
		aiSearch: true,
		deepResearch: true,
		relatedResources: true,
		collections: true,
		collectionNotes: true,
		countryFocus: true,
		authorFilter: true,
		authorLocation: true,
		yearsDropdown: true,
		downloads: true,
		atomFeed: true,
	},
	collections: [
		{
			id: "collection-one",
			title: "Collection One",
			enabled: true,
			order: 10,
		},
	],
	gapMaps: [
		{
			id: "gap-map-one",
			slug: "gap-map-one",
			label: "Gap map one",
			description: "A configured evidence gap map.",
			sourceUrl: "https://assets.example.org/gapmaps/gap-map-one.html",
			enabled: true,
		},
	],
	exports: {
		ris: "https://exports.example.org/library.ris",
		bibtex: "https://exports.example.org/library.bib",
		atom: "https://exports.example.org/library.atom",
	},
	sources: [
		{
			key: "zotero-maximal",
			writebackEnabled: true,
		},
	],
	services: {
		database: {
			url: "postgresql://library:password@database:5432/library",
		},
		search: {
			host: "https://search.example.org",
			key: "maximal-search-key",
			index: "maximal_library",
		},
		storage: {
			url: "https://storage.example.org",
			serviceRoleKey: "maximal-storage-service-role-key",
			privateBucket: "maximal-private",
			publicBucket: "maximal-public",
			maxPdfBytes: 104_857_600,
		},
		zotero: {
			translationUrl: "http://translation-server:1969",
		},
		publication: {
			crossref: {
				enabled: true,
				environment: "test",
				loginId: "crossref-login",
				depositorName: "Maximal Library",
				email: "doi@example.org",
				password: "crossref-password",
				registrant: "Maximal Evidence Library",
				prefix: "10.5555",
				suffixNamespace: "el.",
			},
			zenodo: {
				enabled: true,
				environment: "sandbox",
				token: "zenodo-sandbox-token",
				defaultIdentifierPolicy: "reuse-crossref",
				accessRight: "open",
				license: "cc-by-4.0",
			},
			worker: {
				batchSize: 25,
				leaseSeconds: 900,
				retryLimit: 8,
				nightlyUtcTime: "02:00",
			},
		},
	},
	ai: {
		providers: [
			{
				provider: "google",
				enabled: true,
				apiKey: "google-api-key",
				defaultModel: "gemini-2.5-flash",
				largeModel: "gemini-2.5-pro",
				smallModel: "gemini-2.5-flash",
			},
		],
		prompts: {
			questions: "Answer the user's question from the supplied evidence.",
			chat: "Discuss the supplied evidence.",
			explain: "Explain the supplied evidence.",
			summarize: "Summarize the supplied evidence.",
		},
	},
	analytics: {
		posthog: {
			host: "https://analytics.example.org",
			key: "phc_1234567890123456",
		},
		google: {
			measurementId: "G-ABCD1234",
		},
		utmDurationSeconds: 2_592_000,
	},
	authentication: {
		adminPassword: "correct horse battery staple",
		google: {
			enabled: true,
			clientId: "google-client-id",
			clientSecret: "google-client-secret-value",
		},
		secret: "12345678901234567890123456789012",
	},
	email: {
		contactRecipient: "contact@example.org",
		takedownRecipient: "takedown@example.org",
		smtp: {
			host: "smtp.example.org",
			port: 587,
			security: "starttls",
			username: "smtp-user",
			password: "smtp-password",
			from: "library@example.org",
		},
	},
	generation: {
		sitemap: true,
		redirects: true,
	},
	processing: {
		structureRules: [
			{
				id: "structure-one",
				priority: 10,
				condition: "has-pdf",
				action: "append-system-instruction",
				value: "Use the configured quotation structure.",
			},
		],
		pdfRules: [
			{
				id: "pdf-one",
				priority: 20,
				condition: "has-pdf",
				action: "append-system-instruction",
				value: "Use stored PDF page numbers.",
			},
		],
		sharedRules: [
			{
				id: "shared-one",
				priority: 30,
				condition: "always",
				action: "append-system-instruction",
				value: "Do not invent evidence.",
			},
		],
	},
} satisfies LibraryConfigInput;

export const invalidLibraryConfig = {
	...minimalLibraryConfig,
	revision: "invalid revision",
};

export function cloneLibraryConfig(
	config: LibraryConfigInput = maximalLibraryConfig,
) {
	return structuredClone(config);
}
