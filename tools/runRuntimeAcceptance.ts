import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	PLATFORM_LOCALES,
	PLATFORM_SEARCH_SCOPE_OPTIONS,
} from "../src/config/library-config/catalogs";
import {
	libraryConfigSchema,
	type LibraryServerConfig,
} from "../src/config/library-config/schema";
import { getRuntimeSearchScopeOptions } from "../src/config/library-config/search";
import {
	formatRgbChannels,
	parseHexColor,
} from "../src/config/library-config/theme";
import { getOrderedRuntimeLocales } from "../src/i18n/runtime";
import {
	localesNames,
	shortLocalesNames,
} from "../src/i18n/routing";

const rootDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const acceptanceDirectory = path.join(
	rootDirectory,
	"tests",
	"acceptance",
);
const composeFile = path.join(acceptanceDirectory, "compose.yaml");
const configDirectory = path.join(acceptanceDirectory, "configs");
const composeProject =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT ??
	`evidence-library-acceptance-${process.pid}-${Date.now()}`;
if (!/^[a-z0-9][a-z0-9_-]*$/.test(composeProject)) {
	throw new Error(
		"EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT must contain only lowercase letters, numbers, hyphens, and underscores",
	);
}
const runtimeDirectory = path.join(
	acceptanceDirectory,
	"runtime",
	composeProject,
);
const image =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE ??
	"evidence-library-acceptance:local";
const meilisearchPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_MEILI_PORT ?? "7712";
const amberPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_PORT ?? "3142";
const indigoPort =
	process.env.EVIDENCE_LIBRARY_ACCEPTANCE_INDIGO_PORT ?? "3143";
const keepRunning = process.argv.includes("--keep");
const skipBuild = process.argv.includes("--skip-build");

const commandEnvironment = {
	...process.env,
	EVIDENCE_LIBRARY_ACCEPTANCE_IMAGE: image,
	EVIDENCE_LIBRARY_ACCEPTANCE_OWNER_PID: String(process.pid),
	EVIDENCE_LIBRARY_ACCEPTANCE_PERSISTENT: String(keepRunning),
	EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR: runtimeDirectory,
};
const ownerLabel =
	"org.opendeved.evidence-library.acceptance.owner-pid";
const persistentLabel =
	"org.opendeved.evidence-library.acceptance.persistent";

type Profile = {
	config: LibraryServerConfig;
	configPath: string;
	name: "amber" | "indigo";
	port: string;
};

type MeilisearchTask = {
	status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
	taskUid: number;
	error?: unknown;
};

function run(command: string, args: string[], environment = commandEnvironment) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: environment,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}`,
		);
	}
}

function capture(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		cwd: rootDirectory,
		env: commandEnvironment,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with status ${result.status}: ${result.stderr}`,
		);
	}
	return result.stdout;
}

function composeForProject(
	project: string,
	projectRuntimeDirectory: string,
	...args: string[]
) {
	run(
		"docker",
		[
			"compose",
			"--file",
			composeFile,
			"--project-name",
			project,
			...args,
		],
		{
			...commandEnvironment,
			EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR:
				projectRuntimeDirectory,
		},
	);
}

function compose(...args: string[]) {
	composeForProject(composeProject, runtimeDirectory, ...args);
}

function processIsAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function reapAbandonedProjects() {
	const rows = capture("docker", [
		"ps",
		"--all",
		"--filter",
		`label=${ownerLabel}`,
		"--format",
		`{{.Label "com.docker.compose.project"}}|{{.Label "${ownerLabel}"}}|{{.Label "${persistentLabel}"}}`,
	]);
	const projects = new Map<
		string,
		{ ownerPid: number; persistent: boolean }
	>();

	for (const row of rows.split("\n").filter(Boolean)) {
		const [project, ownerPid, persistent] = row.split("|");
		if (!project) continue;
		projects.set(project, {
			ownerPid: Number(ownerPid),
			persistent: persistent === "true",
		});
	}

	for (const [project, state] of projects) {
		if (
			state.persistent ||
			(Number.isInteger(state.ownerPid) &&
				processIsAlive(state.ownerPid))
		) {
			if (project === composeProject) {
				throw new Error(
					`Acceptance project ${project} is already in use; choose a different EVIDENCE_LIBRARY_ACCEPTANCE_PROJECT and ports`,
				);
			}
			continue;
		}

		const abandonedRuntimeDirectory = path.join(
			acceptanceDirectory,
			"runtime",
			project,
		);
		console.log(`Removing abandoned acceptance project ${project}`);
		composeForProject(
			project,
			abandonedRuntimeDirectory,
			"down",
			"--volumes",
			"--remove-orphans",
		);
		rmSync(abandonedRuntimeDirectory, {
			recursive: true,
			force: true,
		});
	}
}

function loadProfile(
	name: Profile["name"],
	port: string,
): Profile {
	const configPath = path.join(configDirectory, `${name}.json`);
	const config = libraryConfigSchema.parse(
		JSON.parse(readFileSync(configPath, "utf8")),
	);
	return { config, configPath, name, port };
}

function prepareRuntimeConfig(profile: Profile) {
	const targetDirectory = path.join(runtimeDirectory, profile.name);
	mkdirSync(targetDirectory, { recursive: true });
	copyFileSync(
		profile.configPath,
		path.join(targetDirectory, "library.json"),
	);
}

async function meilisearchRequest<T>(
	pathname: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(
		`http://127.0.0.1:${meilisearchPort}${pathname}`,
		{
			...init,
			headers: {
				Authorization: "Bearer acceptance-master-key",
				"Content-Type": "application/json",
				...init?.headers,
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`Meilisearch ${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`,
		);
	}
	return response.json() as Promise<T>;
}

async function waitForTask(taskUid: number) {
	const deadline = Date.now() + 60_000;

	while (Date.now() < deadline) {
		const task = await meilisearchRequest<MeilisearchTask>(
			`/tasks/${taskUid}`,
		);
		if (task.status === "succeeded") return;
		if (task.status === "failed" || task.status === "canceled") {
			throw new Error(
				`Meilisearch task ${taskUid} ${task.status}: ${JSON.stringify(task.error)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
}

async function enqueue(
	pathname: string,
	method: "POST" | "PATCH",
	body: unknown,
) {
	const task = await meilisearchRequest<MeilisearchTask>(pathname, {
		method,
		body: JSON.stringify(body),
	});
	await waitForTask(task.taskUid);
}

async function seedSearch(profile: Profile) {
	const indexUid = profile.config.services.search.index;
	await enqueue("/indexes", "POST", {
		uid: indexUid,
		primaryKey: "key",
	});
	await enqueue(`/indexes/${indexUid}/settings`, "PATCH", {
		filterableAttributes: [
			"itemType",
			"deleted",
			"tags",
			"institution",
			"country",
			"creators.institutions.country_code",
			"fullNames",
			"collectionsAncestry",
			"datePublished",
		],
		sortableAttributes: ["datePublished", "fullNames", "title"],
		searchableAttributes: ["*"],
	});

	const amber = profile.name === "amber";
	const colorName = amber ? "Amber" : "Indigo";
	const institution = amber ? "Amber Institute" : "Indigo Lab";
	const country = amber ? "Morocco" : "United Kingdom";
	const countryCode = amber ? "MA" : "GB";
	const year = amber ? "2026" : "2025";
	const searchItemKey = amber
		? "AMBER_SEARCH_FIXTURE"
		: "INDIGO_SEARCH_FIXTURE";

	await enqueue(`/indexes/${indexUid}/documents`, "POST", [
		{
			key: searchItemKey,
			id: `${colorName.toUpperCase()}_ACCEPTANCE`,
			title: `${colorName} runtime evidence`,
			shortTitle: `${colorName} proof`,
			abstractNote: `This record proves the ${profile.name} deployment selected its own runtime search index.`,
			itemType: "JournalArticle",
			deleted: 0,
			date: year,
			datePublished: year,
			fullNames: [`${amber ? "Amina" : "Iris"} ${colorName}`],
			creators: [
				{
					firstName: amber ? "Amina" : "Iris",
					lastName: colorName,
					creatorType: "author",
					institutions: [
						{
							display_name: institution,
							country_code: countryCode,
						},
					],
				},
			],
			institution: [institution],
			country: [country],
			tags: [],
			collections: [],
			collectionsAncestry: [],
			url: `https://${profile.name}.example.org/evidence/${profile.name}`,
			citation: `<div>${colorName}, A. (${year}). ${colorName} runtime evidence.</div>`,
		},
	]);
}

async function seedSharedSearchIndexes() {
	for (const index of [
		{ uid: "cache", primaryKey: "id" },
		{ uid: "redirects", primaryKey: "id" },
	]) {
		await enqueue("/indexes", "POST", index);
	}
}

function publicExpectations(profile: Profile) {
	const { config } = profile;
	const messages = JSON.parse(
		readFileSync(
			path.join(
				rootDirectory,
				"src",
				"messages",
				`${config.localization.defaultLocale}.json`,
			),
			"utf8",
		),
	) as {
		scopes: Record<string, string>;
		ui: Record<string, string>;
	};
	const orderedLocales = getOrderedRuntimeLocales(config.localization);
	const alternateLocales = orderedLocales.filter(
		(locale) => locale !== config.localization.defaultLocale,
	);
	const disabledLocale = PLATFORM_LOCALES.find(
		(locale) => !config.localization.locales.includes(locale),
	);
	if (!disabledLocale) {
		throw new Error(`${profile.name} must leave one locale disabled`);
	}
	const scopes = getRuntimeSearchScopeOptions(config.search);
	const defaultScope =
		scopes.find((scope) => scope.key === config.search.defaultScope) ??
		PLATFORM_SEARCH_SCOPE_OPTIONS[0];
	const externalNavigation = config.navigation.links.find(
		(link) => link.href.startsWith("https://"),
	);
	const logoStyleToken = config.identity.assets.logoStyles
		?.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.at(-1);
	const googleFonts = Array.from(
		new Set(
			[
				config.theme.fonts.heading,
				config.theme.fonts.body,
			]
				.filter((font) => font.source === "google")
				.map((font) => font.family),
		),
	);
	const switchLocale = alternateLocales[0];
	const activeTheme =
		config.theme.forcedMode ??
		(config.theme.defaultMode === "system"
			? "light"
			: config.theme.defaultMode);
	const searchItemPrefix =
		profile.name === "amber" ? "Amber" : "Indigo";

	return {
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${profile.port}`,
		PLAYWRIGHT_EXPECTED_CONFIG_REVISION: config.revision,
		PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT: config.updatedAt,
		PLAYWRIGHT_EXPECTED_IDENTITY_NAME: config.identity.name,
		PLAYWRIGHT_EXPECTED_LOGO_URL:
			activeTheme === "dark"
				? config.identity.assets.logoDark
				: config.identity.assets.logoLight,
		PLAYWRIGHT_EXPECTED_LOGO_URLS: [
			config.identity.assets.logoDark,
			config.identity.assets.logoLight,
		].join("|"),
		PLAYWRIGHT_EXPECTED_FAVICON_URL:
			config.identity.assets.favicon,
		PLAYWRIGHT_EXPECTED_LOGO_STYLE_TOKEN: logoStyleToken ?? "",
		PLAYWRIGHT_EXPECTED_ACCENT_RGB: formatRgbChannels(
			parseHexColor(config.theme.colors.accent),
		),
		PLAYWRIGHT_EXPECTED_GOOGLE_FONT_FAMILIES:
			googleFonts.join("|"),
		PLAYWRIGHT_EXPECTED_LOADED_LOGO: "true",
		PLAYWRIGHT_EXPECTED_THEME_CLASS: activeTheme,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY:
			`${searchItemPrefix.toUpperCase()}_SEARCH_FIXTURE`,
		PLAYWRIGHT_EXPECTED_SEARCH_ITEM_TITLE:
			`${searchItemPrefix} runtime evidence`,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY:
			`${searchItemPrefix.toUpperCase()}_DATABASE_FIXTURE`,
		PLAYWRIGHT_EXPECTED_DATABASE_ITEM_TITLE:
			`${searchItemPrefix} database evidence`,
		PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL:
			config.navigation.links[0]?.label ?? "",
		PLAYWRIGHT_EXPECTED_EXTERNAL_NAVIGATION_LABEL:
			externalNavigation?.label ?? "",
		PLAYWRIGHT_EXPECTED_FOOTER_SECTION:
			config.footer.sections[0]?.title ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_EMAIL: config.contact.email ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_PHONE: config.contact.phone ?? "",
		PLAYWRIGHT_EXPECTED_CONTACT_ADDRESS:
			config.contact.address?.split("\n")[0] ?? "",
		PLAYWRIGHT_EXPECTED_FUNDER_NAME:
			config.footer.funders[0]?.name ?? "",
		PLAYWRIGHT_EXPECTED_DISCLAIMER:
			config.footer.disclaimer ?? "",
		PLAYWRIGHT_EXPECTED_ATTRIBUTION:
			config.footer.attribution ?? "",
		PLAYWRIGHT_EXPECTED_DEFAULT_LOCALE:
			config.localization.defaultLocale,
		PLAYWRIGHT_EXPECTED_ENABLED_LOCALES:
			config.localization.locales.join(","),
		PLAYWRIGHT_EXPECTED_DISABLED_LOCALE: disabledLocale,
		PLAYWRIGHT_EXPECTED_DETECTED_LOCALE:
			config.localization.detectLocale
				? (switchLocale ?? "")
				: "",
		PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER: String(
			config.features.languageSwitcher,
		),
		PLAYWRIGHT_EXPECTED_CURRENT_LOCALE_LABEL:
			shortLocalesNames[config.localization.defaultLocale],
		PLAYWRIGHT_EXPECTED_LOCALE_OPTIONS: alternateLocales
			.map((locale) => localesNames[locale])
			.join("|"),
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE: switchLocale ?? "",
		PLAYWRIGHT_EXPECTED_SWITCH_LOCALE_LABEL: switchLocale
			? localesNames[switchLocale]
			: "",
		PLAYWRIGHT_EXPECTED_SWITCH_BACK_LOCALE_LABEL:
			switchLocale
				? localesNames[config.localization.defaultLocale]
				: "",
		PLAYWRIGHT_EXPECTED_CONSENT_DECLINE:
			messages.ui.cookieDecline,
		PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT: String(scopes.length),
		PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL:
			messages.scopes[defaultScope.key] ?? defaultScope.name,
		PLAYWRIGHT_EXPECTED_YEAR_FILTER: String(
			config.filters.years.enabled,
		),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL:
			messages.ui[config.filters.institution.label] ??
			config.filters.institution.label,
		PLAYWRIGHT_EXPECTED_CITATION_URL: String(
			config.citations.showUrl,
		),
		PLAYWRIGHT_EXPECTED_EMBEDDINGS: String(
			config.search.embeddings,
		),
		PLAYWRIGHT_EXPECTED_COUNTRY_FACET: String(
			config.search.country,
		),
		PLAYWRIGHT_EXPECTED_AUTHOR_COUNTRY_FACET: String(
			config.search.authorCountry,
		),
		PLAYWRIGHT_EXPECTED_INSTITUTION_FACET: String(
			config.filters.institution.mode !== "hidden",
		),
		PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH: String(
			config.features.navbarSearch,
		),
		PLAYWRIGHT_EXPECTED_THEME_SWITCHER: String(
			config.features.themeSwitcher,
		),
		PLAYWRIGHT_EXPECTED_LOGIN: String(config.features.login),
		PLAYWRIGHT_EXPECTED_AI: String(config.features.ai),
		PLAYWRIGHT_EXPECTED_AI_SEARCH: String(
			config.features.aiSearch,
		),
		PLAYWRIGHT_EXPECTED_DEEP_RESEARCH: String(
			config.features.deepResearch,
		),
	};
}

function runBrowserSuite(profile: Profile) {
	console.log(`\nRunning ${profile.name} runtime acceptance suite`);
	run(
		"npx",
		["playwright", "test", "tests/e2e/smoke.spec.ts"],
		{
			...commandEnvironment,
			...publicExpectations(profile),
		},
	);
}

async function main() {
	reapAbandonedProjects();
	const profiles = [
		loadProfile("amber", amberPort),
		loadProfile("indigo", indigoPort),
	];

	rmSync(runtimeDirectory, { recursive: true, force: true });
	profiles.forEach(prepareRuntimeConfig);

	try {
		if (!skipBuild) {
			run("docker", ["build", "--tag", image, "."]);
		}
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"postgres",
			"meilisearch",
		);
		await seedSharedSearchIndexes();
		for (const profile of profiles) {
			await seedSearch(profile);
		}
		compose(
			"up",
			"--wait",
			"--wait-timeout",
			"180",
			"amber",
			"indigo",
		);
		profiles.forEach(runBrowserSuite);
		console.log("\nRuntime acceptance passed for Amber and Indigo.");
		if (keepRunning) {
			console.log(
				`Amber: http://127.0.0.1:${amberPort}\nIndigo: http://127.0.0.1:${indigoPort}\nCompose project: ${composeProject}`,
			);
		}
	} catch (error) {
		compose(
			"logs",
			"--no-color",
			"--tail",
			"200",
			"amber",
			"indigo",
			"postgres",
			"meilisearch",
		);
		throw error;
	} finally {
		if (!keepRunning) {
			compose("down", "--volumes", "--remove-orphans");
			rmSync(runtimeDirectory, {
				recursive: true,
				force: true,
			});
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
